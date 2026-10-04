"""OIDC client helper for Azure AD / generic OpenID Providers."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import secrets
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, cast

import httpx
import jwt
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from jwt.algorithms import RSAAlgorithm

from shift_scheduler.api.auth.models import AppRole, UserPrincipal
from shift_scheduler.api.auth.settings import (
    OIDCSettings,
    SessionSettings,
    get_oidc_settings,
    get_session_settings,
)


class OIDCError(Exception):
    """Raised when an unrecoverable OIDC error occurs."""


@dataclass(frozen=True)
class OIDCLoginState:
    """State persisted between authorize and callback."""

    state: str
    nonce: str
    code_verifier: str
    redirect_to: str


class OIDCStateManager:
    """Serializes OIDCLoginState to signed cookies."""

    def __init__(
        self,
        session_settings: SessionSettings,
        state_cookie_name: str,
        ttl_seconds: int,
    ) -> None:
        self.cookie_name = state_cookie_name
        self.ttl_seconds = ttl_seconds
        self._serializer = URLSafeTimedSerializer(
            secret_key=session_settings.secret, salt="pharmshift-oidc"
        )

    def encode(self, payload: OIDCLoginState) -> str:
        return self._serializer.dumps(payload.__dict__)

    def decode(self, value: str) -> OIDCLoginState:
        try:
            data: dict[str, Any] = self._serializer.loads(
                value, max_age=self.ttl_seconds
            )
        except SignatureExpired as exc:  # pragma: no cover - defensive branch
            raise OIDCError("OIDC state expired") from exc
        except BadSignature as exc:  # pragma: no cover - defensive branch
            raise OIDCError("Invalid OIDC state signature") from exc
        return OIDCLoginState(**data)


class OIDCProvider:
    """Fetches metadata/JWKS and validates tokens."""

    def __init__(self, settings: OIDCSettings) -> None:
        self._settings = settings
        self._metadata: dict[str, Any] | None = None
        self._jwks: dict[str, dict[str, Any]] = {}
        self._jwks_refreshed_at: datetime | None = None
        self._lock = asyncio.Lock()

    def _http_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=self._settings.http_timeout)

    async def _ensure_metadata(self) -> dict[str, Any]:
        if self._metadata is not None:
            return self._metadata
        async with self._lock:
            if self._metadata is not None:
                return self._metadata
            async with self._http_client() as client:
                response = await client.get(self._settings.metadata_url)
                response.raise_for_status()
                metadata_raw = response.json()
            if not isinstance(
                metadata_raw, Mapping
            ):  # pragma: no cover - defensive guard
                raise OIDCError("Invalid metadata payload")
            typed_metadata = cast(Mapping[str, Any], metadata_raw)
            self._metadata = dict(typed_metadata)
        metadata = self._metadata
        assert metadata is not None  # pragma: no cover - defensive guard
        return metadata

    async def _ensure_jwks(self) -> dict[str, dict[str, Any]]:
        now = datetime.now(UTC)
        if (
            self._jwks
            and self._jwks_refreshed_at
            and (now - self._jwks_refreshed_at).total_seconds()
            < self._settings.jwks_cache_seconds
        ):
            return self._jwks
        metadata = await self._ensure_metadata()
        async with self._lock:
            if (
                self._jwks
                and self._jwks_refreshed_at
                and (now - self._jwks_refreshed_at).total_seconds()
                < self._settings.jwks_cache_seconds
            ):
                return self._jwks
            jwks_uri_raw = metadata.get("jwks_uri")
            if not isinstance(jwks_uri_raw, str):
                raise OIDCError("Provider metadata missing jwks_uri")
            jwks_uri = jwks_uri_raw
            async with self._http_client() as client:
                response = await client.get(jwks_uri)
                response.raise_for_status()
                body_raw = response.json()
            if not isinstance(
                body_raw, Mapping
            ):  # pragma: no cover - provider bug guard
                raise OIDCError("Invalid JWKS response payload")
            body = cast(Mapping[str, Any], body_raw)
            keys_payload_raw = body.get("keys")
            if not isinstance(
                keys_payload_raw, list
            ):  # pragma: no cover - provider bug guard
                raise OIDCError("Invalid JWKS payload")
            keys_payload = keys_payload_raw
            processed_keys: dict[str, dict[str, Any]] = {}
            for raw_entry in keys_payload:
                if isinstance(raw_entry, dict) and "kid" in raw_entry:
                    typed_entry = cast(dict[str, Any], raw_entry)
                    kid = str(typed_entry["kid"])
                    processed_keys[kid] = dict(typed_entry)
            self._jwks = processed_keys
            self._jwks_refreshed_at = now
        return self._jwks

    def _build_code_challenge(self, verifier: str) -> str:
        digest = hashlib.sha256(verifier.encode("ascii")).digest()
        return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")

    async def build_authorization_url(self, login_state: OIDCLoginState) -> str:
        metadata = await self._ensure_metadata()
        authorize_raw = metadata.get("authorization_endpoint")
        if not isinstance(authorize_raw, str):
            raise OIDCError("Provider metadata missing authorization_endpoint")
        authorize = authorize_raw
        challenge = self._build_code_challenge(login_state.code_verifier)
        params = {
            "client_id": self._settings.client_id,
            "response_type": "code",
            "redirect_uri": self._settings.redirect_uri,
            "scope": " ".join(self._settings.scopes),
            "state": login_state.state,
            "nonce": login_state.nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            # Shared terminals: the identity provider asks for credentials again,
            # so signing in after a sign-out never continues the previous person's
            # provider session (OpenID Connect Core 3.1.2.1).
            "prompt": "login",
        }
        query = httpx.QueryParams(params)
        return f"{authorize}?{query}"

    async def exchange_code(self, code: str, code_verifier: str) -> dict[str, Any]:
        metadata = await self._ensure_metadata()
        token_endpoint_raw = metadata.get("token_endpoint")
        if not isinstance(token_endpoint_raw, str):
            raise OIDCError("Provider metadata missing token_endpoint")
        token_endpoint = token_endpoint_raw
        payload = {
            "client_id": self._settings.client_id,
            "client_secret": self._settings.client_secret,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self._settings.redirect_uri,
            "code_verifier": code_verifier,
        }
        async with self._http_client() as client:
            response = await client.post(token_endpoint, data=payload)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:  # pragma: no cover - upstream error guard
            raise OIDCError(
                "Token endpoint rejected the authentication exchange"
            ) from exc
        payload = response.json()
        if not isinstance(payload, dict):
            raise OIDCError("Token response must be an object")
        return cast(dict[str, Any], payload)

    async def verify_id_token(self, id_token: str, nonce: str) -> Mapping[str, Any]:
        metadata = await self._ensure_metadata()
        issuer = metadata.get("issuer")
        if not isinstance(issuer, str) or not issuer.startswith("https://"):
            raise OIDCError("Provider metadata requires a trusted HTTPS issuer")
        jwks = await self._ensure_jwks()
        try:
            header = jwt.get_unverified_header(id_token)
        except jwt.PyJWTError as exc:
            raise OIDCError("Malformed ID token") from exc
        kid = header.get("kid")
        alg = header.get("alg")
        if not kid or alg != "RS256":
            raise OIDCError("Only RS256 signed ID tokens are accepted")
        jwk_entry = jwks.get(kid)
        if jwk_entry is None:
            self._jwks = {}
            jwks = await self._ensure_jwks()
            jwk_entry = jwks.get(kid)
        if jwk_entry is None:
            raise OIDCError("Unable to resolve signing key")
        public_key: Any = RSAAlgorithm.from_jwk(json.dumps(jwk_entry))
        try:
            claims = cast(
                Mapping[str, Any],
                jwt.decode(
                    id_token,
                    key=public_key,
                    algorithms=["RS256"],
                    options={"require": ["exp", "iat", "sub", "iss", "aud"]},
                    audience=self._settings.client_id,
                    issuer=issuer,
                ),
            )
        except (
            jwt.PyJWTError
        ) as exc:  # pragma: no cover - signature/claim failure guard
            raise OIDCError("Failed to verify id_token") from exc
        if not isinstance(claims.get("sub"), str) or not claims["sub"]:
            raise OIDCError("Missing subject")
        if (
            isinstance(claims.get("aud"), list)
            and len(claims["aud"]) > 1
            and claims.get("azp") != self._settings.client_id
        ):
            raise OIDCError("Authorized party mismatch")
        if claims.get("azp") is not None and claims["azp"] != self._settings.client_id:
            raise OIDCError("Authorized party mismatch")
        token_nonce = str(claims.get("nonce")) if "nonce" in claims else None
        if token_nonce != nonce:
            raise OIDCError("Nonce mismatch")
        return claims

    def build_principal(self, claims: Mapping[str, Any]) -> UserPrincipal:
        role = self._determine_role(claims)
        user_id = hashlib.sha256(
            json.dumps([claims.get("iss"), claims.get("sub")]).encode()
        ).hexdigest()
        display_name = self._extract_claim(claims, self._settings.name_claims)
        email = self._extract_claim(claims, self._settings.email_claims)
        oid = str(claims.get("oid")) if claims.get("oid") else None
        return UserPrincipal(
            user_id=user_id,
            role=role,
            display_name=display_name,
            email=email,
            oid=oid,
            claims={
                key: claims[key] for key in ("iss", "sub", "auth_time") if key in claims
            },
        )

    def _determine_role(self, claims: Mapping[str, Any]) -> AppRole:
        role_values = claims.get(self._settings.role_claim)
        observed = self._normalize_claim_values(role_values)
        if self._match_role(observed, self._settings.admin_roles):
            return AppRole.ADMIN
        if self._match_role(observed, self._settings.developer_roles):
            return AppRole.DEVELOPER
        if self._match_role(observed, self._settings.leader_roles):
            return AppRole.LEADER
        if self._match_role(observed, self._settings.pharmacist_roles):
            return AppRole.PHARMACIST
        return self._settings.default_role

    def _normalize_claim_values(self, value: Any) -> set[str]:
        if isinstance(value, str):
            return {value}
        if isinstance(value, list):
            normalized: set[str] = set()
            typed_values = value
            for entry in typed_values:
                if isinstance(entry, str) and entry:
                    normalized.add(entry)
            return normalized
        return set()

    def _match_role(self, observed: set[str], targets: tuple[str, ...]) -> bool:
        return any(target in observed for target in targets)

    def _extract_claim(
        self, claims: Mapping[str, Any], candidates: tuple[str, ...]
    ) -> str | None:
        for key in candidates:
            value = claims.get(key)
            if isinstance(value, str) and value:
                return value
        return None


_provider: OIDCProvider | None = None
_state_manager: OIDCStateManager | None = None


def get_oidc_provider() -> OIDCProvider:
    global _provider
    settings = get_oidc_settings()
    if settings is None:
        raise RuntimeError("OIDC settings not configured")
    if _provider is None:
        _provider = OIDCProvider(settings)
    return _provider


def get_oidc_state_manager() -> OIDCStateManager:
    global _state_manager
    auth_settings = get_session_settings()
    oidc_settings = get_oidc_settings()
    if oidc_settings is None:
        raise RuntimeError("OIDC settings not configured")
    if _state_manager is None:
        _state_manager = OIDCStateManager(
            auth_settings,
            oidc_settings.state_cookie_name,
            oidc_settings.state_ttl_seconds,
        )
    return _state_manager


def build_login_state(redirect_to: str) -> OIDCLoginState:
    state = secrets.token_urlsafe(16)
    nonce = secrets.token_urlsafe(16)
    code_verifier = secrets.token_urlsafe(64)
    return OIDCLoginState(
        state=state, nonce=nonce, code_verifier=code_verifier, redirect_to=redirect_to
    )


__all__ = [
    "OIDCError",
    "OIDCLoginState",
    "OIDCProvider",
    "OIDCStateManager",
    "build_login_state",
    "get_oidc_provider",
    "get_oidc_state_manager",
]
