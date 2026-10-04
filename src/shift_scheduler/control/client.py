"""No cached permission: unavailable or unverifiable authority blocks access."""

import os
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from shift_scheduler.db.restore_lock import RestoreUnavailable
from shift_scheduler.domain.planning import content_hash


class AuthorityClient:
    def __init__(
        self,
        url: str,
        client_id: str,
        token: str,
        public_key: str,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if (
            urlsplit(url).scheme != "https"
            and os.getenv("PHARMSHIFT_ENV") == "production"
        ):
            raise ValueError("Production authority requires authenticated TLS")
        self.url, self.client_id, self.token = url, client_id, token
        self.public_key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_key))
        self.transport = transport

    def request(self, method: str, path: str, body: Any = None) -> Any:
        nonce = uuid4().hex
        try:
            with httpx.Client(
                base_url=self.url, timeout=5, transport=self.transport
            ) as http:
                response = http.request(
                    method,
                    path,
                    json=body,
                    headers={
                        "Authorization": "Bearer " + self.token,
                        "X-Control-Client": self.client_id,
                        "X-Control-Nonce": nonce,
                    },
                )
                response.raise_for_status()
                envelope = response.json()
            payload = envelope["payload"]
            self.public_key.verify(
                bytes.fromhex(envelope["signature"]),
                bytes.fromhex(content_hash(payload)),
            )
            if payload["nonce"] != nonce or payload["client_id"] != self.client_id:
                raise ValueError("Authority response is not bound to this request")
            return payload["body"]
        except Exception as error:
            raise RestoreUnavailable(
                "Independent control authority unavailable, stale or unverified"
            ) from error

    def require_access(self) -> Any:
        status = self.request("GET", "/status")
        if not status["allowed"]:
            raise RestoreUnavailable("Independent control blocks personal-data access")
        return status


def configured_client() -> AuthorityClient | None:
    url = os.getenv("PHARMSHIFT_CONTROL_URL")
    if not url:
        if os.getenv("PHARMSHIFT_ENV") == "production":
            raise RestoreUnavailable("Independent control configuration is required")
        return None  # Compatibility only for explicitly non-production development.
    try:
        return AuthorityClient(
            url,
            os.environ["PHARMSHIFT_CONTROL_NODE"],
            os.environ["PHARMSHIFT_CONTROL_TOKEN"],
            os.environ["PHARMSHIFT_CONTROL_PUBLIC_KEY"],
        )
    except (KeyError, ValueError) as error:
        raise RestoreUnavailable(
            "Independent control configuration is incomplete"
        ) from error


def require_access() -> Any:
    client = configured_client()
    return client.require_access() if client else None
