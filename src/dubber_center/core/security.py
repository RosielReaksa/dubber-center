"""Password and API-key hashing (project plan step 4).

Keys look like `dk_live_<random>`. We store only a SHA-256 hash — an API key is a
high-entropy random token, so a fast hash is appropriate and keeps lookups O(1).
Passwords use PBKDF2 (stdlib) instead, since they are low-entropy.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import string

KEY_PREFIX = "dk_live_"
_VISIBLE_PREFIX_LEN = len(KEY_PREFIX) + 8
_ALPHABET = string.ascii_letters + string.digits
_PBKDF2_ROUNDS = 260_000


def generate_api_key() -> str:
    return KEY_PREFIX + "".join(secrets.choice(_ALPHABET) for _ in range(40))


def hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def key_prefix(key: str) -> str:
    """The part shown in UIs after creation: `dk_live_ab12cd34`."""
    return key[:_VISIBLE_PREFIX_LEN]


def keys_match(raw_key: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_api_key(raw_key), stored_hash)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${_PBKDF2_ROUNDS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        algorithm, rounds, salt, digest = stored.split("$")
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    expected = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(rounds))
    return hmac.compare_digest(expected.hex(), digest)


def sign_payload(secret: str, payload: bytes) -> str:
    """HMAC-SHA256 for webhook signatures: `sha256=<hex>`."""
    return "sha256=" + hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


def verify_signature(secret: str, payload: bytes, signature: str) -> bool:
    return hmac.compare_digest(sign_payload(secret, payload), signature)