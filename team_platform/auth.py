from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any


def validate_credentials(username: str, password: str) -> tuple[str, str]:
    username = username.strip()
    if not username:
        raise ValueError("用户名不能为空。")
    if len(username) > 32:
        raise ValueError("用户名不能超过 32 位字符。")
    if any(ord(char) < 32 or ord(char) == 127 for char in username):
        raise ValueError("用户名不能包含换行或控制字符。")
    if len(password) < 8:
        raise ValueError("密码至少 8 位。")
    if len(password) > 128:
        raise ValueError("密码不能超过 128 位。")
    return username, password


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or os_urandom(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=2**14,
        r=8,
        p=1,
        dklen=32,
    )
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, salt_hex, digest_hex = encoded.split("$", 2)
        if scheme != "scrypt":
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=2**14,
            r=8,
            p=1,
            dklen=len(expected),
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def os_urandom(size: int) -> bytes:
    import os

    return os.urandom(size)


def _sign(payload: bytes, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def create_session(user: dict[str, Any], secret: str, max_age_seconds: int = 7 * 24 * 3600) -> str:
    payload = json.dumps(
        {
            "uid": int(user["id"]),
            "username": user["username"],
            "role": user["role"],
            "exp": int(time.time()) + max_age_seconds,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    encoded = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
    return f"{encoded}.{_sign(payload, secret)}"


def parse_session(token: str, secret: str) -> dict[str, Any] | None:
    try:
        encoded, signature = token.rsplit(".", 1)
        padding = "=" * (-len(encoded) % 4)
        payload = base64.urlsafe_b64decode(encoded + padding)
        if not hmac.compare_digest(_sign(payload, secret), signature):
            return None
        data = json.loads(payload.decode("utf-8"))
        if int(data.get("exp", 0)) < int(time.time()):
            return None
        return data
    except (ValueError, TypeError, json.JSONDecodeError):
        return None

