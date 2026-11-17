from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from shift_scheduler.api.auth.oidc import OIDCError, OIDCProvider
from shift_scheduler.api.auth.settings import OIDCSettings
from shift_scheduler.api.main import app


def test_cookie_origin_garbage_authorization_and_logout_replay():
    with TestClient(app, base_url="https://localhost:8000") as client:
        response = client.post(
            "/auth/login", json={"username": "admin", "password": "pass-admin"}
        )
        token = response.json()["access_token"]
        assert (
            client.post(
                "/auth/logout", headers={"Origin": "https://attacker.invalid"}
            ).status_code
            == 403
        )
        assert (
            client.post(
                "/auth/logout",
                headers={
                    "Origin": "https://attacker.invalid",
                    "Authorization": "Basic malformed",
                },
            ).status_code
            == 403
        )
        # Header failures cannot fall back to a valid session cookie.
        assert (
            client.get(
                "/planning/scopes", headers={"Authorization": "Basic malformed"}
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/auth/logout", headers={"Origin": "https://localhost:3000"}
            ).status_code
            == 204
        )
        assert (
            client.get(
                "/planning/scopes", headers={"Authorization": "Bearer " + token}
            ).status_code
            == 401
        )


@pytest.mark.asyncio
async def test_signed_oidc_claim_positive_and_negative_controls():
    from shift_scheduler.api.auth.models import AppRole

    settings = OIDCSettings(
        metadata_url="https://issuer.invalid/.well-known/openid-configuration",
        client_id="client",
        client_secret="synthetic-test-only",
        redirect_uri="https://app.invalid/callback",
        scopes=("openid",),
        role_claim="roles",
        admin_roles=("admin",),
        developer_roles=(),
        leader_roles=(),
        pharmacist_roles=(),
        default_role=AppRole.PHARMACIST,
        user_id_claims=("sub",),
        email_claims=("email",),
        name_claims=("name",),
        state_cookie_name="state",
        state_ttl_seconds=300,
        jwks_cache_seconds=3600,
        http_timeout=1,
    )
    provider = OIDCProvider(settings)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    provider._metadata = {"issuer": "https://issuer.invalid"}
    provider._jwks = {
        "test-key": jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key(), as_dict=True)
    }
    provider._jwks_refreshed_at = datetime.now(UTC)
    claims = {
        "iss": "https://issuer.invalid",
        "sub": "stable-person",
        "aud": "client",
        "iat": datetime.now(UTC),
        "exp": datetime.now(UTC) + timedelta(minutes=5),
        "nonce": "expected",
    }

    def signed(values):
        return jwt.encode(values, key, algorithm="RS256", headers={"kid": "test-key"})

    assert (await provider.verify_id_token(signed(claims), "expected"))[
        "sub"
    ] == "stable-person"
    for name in ("exp", "iat", "iss", "sub", "aud"):
        invalid = {k: v for k, v in claims.items() if k != name}
        with pytest.raises(OIDCError):
            await provider.verify_id_token(signed(invalid), "expected")
    for override in (
        {"aud": "other"},
        {"iss": "https://other.invalid"},
        {"nonce": "other"},
        {"exp": datetime.now(UTC) - timedelta(minutes=5)},
        {"azp": "other"},
        {"sub": ""},
    ):
        with pytest.raises(OIDCError):
            await provider.verify_id_token(signed({**claims, **override}), "expected")
    provider._metadata = {}
    with pytest.raises(OIDCError):
        await provider.verify_id_token(signed(claims), "expected")
