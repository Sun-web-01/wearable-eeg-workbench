from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    invite_code: str
    cookie_secret: str
    cookie_name: str
    allow_registration: bool
    max_upload_mb: int
    workers: int


def load_settings() -> Settings:
    data_dir = Path(os.getenv("EEG_DATA_DIR", "team_data")).resolve()
    invite_code = os.getenv("EEG_INVITE_CODE", "eeg-team-2026")
    cookie_secret = os.getenv("EEG_COOKIE_SECRET") or secrets.token_hex(32)
    return Settings(
        data_dir=data_dir,
        invite_code=invite_code,
        cookie_secret=cookie_secret,
        cookie_name="eeg_team_session",
        allow_registration=os.getenv("EEG_ALLOW_REGISTRATION", "1") not in {"0", "false", "False"},
        max_upload_mb=int(os.getenv("EEG_MAX_UPLOAD_MB", "200")),
        workers=max(1, min(4, int(os.getenv("EEG_WORKERS", "2")))),
    )

