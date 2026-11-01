from dataclasses import dataclass
from typing import Protocol

import anyio.to_thread
import jwt

from sonora_api.core.errors import UnauthorizedError

GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")


@dataclass(frozen=True, slots=True)
class GoogleIdentity:
    sub: str
    email: str
    email_verified: bool
    name: str | None


class GoogleVerifier(Protocol):
    async def verify(self, id_token: str) -> GoogleIdentity: ...


class GoogleIdTokenVerifier:
    """Verifies Google ID tokens (web GIS and Android Credential Manager) against Google's JWKS.

    Keys are cached by PyJWKClient; the fetch is blocking, so it runs in a worker thread.
    """

    def __init__(self, client_ids: list[str]) -> None:
        self._client_ids = client_ids
        self._jwks = jwt.PyJWKClient(GOOGLE_JWKS_URL, cache_keys=True, lifespan=3600, timeout=5)

    async def verify(self, id_token: str) -> GoogleIdentity:
        if not self._client_ids:
            raise UnauthorizedError("Google sign-in is not configured", code="google_disabled")
        return await anyio.to_thread.run_sync(self._verify_sync, id_token)

    def _verify_sync(self, id_token: str) -> GoogleIdentity:
        try:
            key = self._jwks.get_signing_key_from_jwt(id_token)
            claims = jwt.decode(
                id_token,
                key.key,
                algorithms=["RS256"],
                audience=self._client_ids,
                options={"require": ["exp", "iat", "iss", "sub", "aud"]},
            )
        except (jwt.InvalidTokenError, jwt.PyJWKClientError) as exc:
            raise UnauthorizedError("Invalid Google ID token", code="invalid_google_token") from exc
        if claims.get("iss") not in GOOGLE_ISSUERS or not claims.get("email"):
            raise UnauthorizedError("Invalid Google ID token", code="invalid_google_token")
        return GoogleIdentity(
            sub=str(claims["sub"]),
            email=str(claims["email"]).lower(),
            email_verified=bool(claims.get("email_verified", False)),
            name=claims.get("name"),
        )
