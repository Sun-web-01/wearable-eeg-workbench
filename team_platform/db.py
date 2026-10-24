from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Database:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self.initialise()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=30, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def initialise(self) -> None:
        with self._lock, self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'member',
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    owner_id INTEGER NOT NULL,
                    owner_name TEXT NOT NULL,
                    title TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    input_name TEXT,
                    input_path TEXT,
                    annotations_path TEXT,
                    input_sha256 TEXT,
                    backend TEXT NOT NULL,
                    config_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    quality_grade TEXT,
                    quality_score REAL,
                    duration_s REAL,
                    error TEXT,
                    output_dir TEXT,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    FOREIGN KEY(owner_id) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS job_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    message TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
                );
                """
            )

    def create_user(self, username: str, password_hash: str) -> dict[str, Any]:
        with self._lock, self.connect() as connection:
            user_count = int(connection.execute("SELECT COUNT(*) FROM users").fetchone()[0])
            role = "admin" if user_count == 0 else "member"
            try:
                cursor = connection.execute(
                    "INSERT INTO users(username, password_hash, role, created_at) VALUES(?,?,?,?)",
                    (username, password_hash, role, utc_now()),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError("用户名已存在。") from exc
            return {
                "id": cursor.lastrowid,
                "username": username,
                "role": role,
            }

    def update_account(self, user_id: int, username: str, password_hash: str) -> dict[str, Any]:
        with self._lock, self.connect() as connection:
            try:
                connection.execute(
                    "UPDATE users SET username = ?, password_hash = ? WHERE id = ?",
                    (username, password_hash, user_id),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError("用户名已存在。") from exc
            connection.execute(
                "UPDATE jobs SET owner_name = ? WHERE owner_id = ?",
                (username, user_id),
            )
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row:
                raise ValueError("账户不存在。")
            return dict(row)

    def get_user_by_name(self, username: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM users WHERE username = ?",
                (username,),
            ).fetchone()
            return dict(row) if row else None

    def get_user(self, user_id: int) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return dict(row) if row else None

    def create_job(
        self,
        job_id: str,
        user: dict[str, Any],
        title: str,
        mode: str,
        backend: str,
        config_json: str,
        input_name: str | None = None,
        input_path: str | None = None,
        annotations_path: str | None = None,
        input_sha256: str | None = None,
        output_dir: str | None = None,
    ) -> None:
        with self._lock, self.connect() as connection:
            connection.execute(
                """
                INSERT INTO jobs(
                    id, owner_id, owner_name, title, mode, input_name, input_path,
                    annotations_path, input_sha256, backend, config_json, status,
                    output_dir, created_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,'queued',?,?)
                """,
                (
                    job_id,
                    int(user["id"]),
                    user["username"],
                    title,
                    mode,
                    input_name,
                    input_path,
                    annotations_path,
                    input_sha256,
                    backend,
                    config_json,
                    output_dir,
                    utc_now(),
                ),
            )

    def update_job(self, job_id: str, **fields: Any) -> None:
        allowed = {
            "status",
            "quality_grade",
            "quality_score",
            "duration_s",
            "error",
            "output_dir",
            "started_at",
            "finished_at",
        }
        updates = {key: value for key, value in fields.items() if key in allowed}
        if not updates:
            return
        assignments = ", ".join(f"{key} = ?" for key in updates)
        with self._lock, self.connect() as connection:
            connection.execute(
                f"UPDATE jobs SET {assignments} WHERE id = ?",
                [*updates.values(), job_id],
            )

    def add_event(self, job_id: str, message: str) -> None:
        with self._lock, self.connect() as connection:
            connection.execute(
                "INSERT INTO job_events(job_id, message, created_at) VALUES(?,?,?)",
                (job_id, message, utc_now()),
            )

    def list_jobs(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [dict(row) for row in rows]

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            return dict(row) if row else None

    def get_events(self, job_id: str) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT message, created_at FROM job_events WHERE job_id = ? ORDER BY id",
                (job_id,),
            ).fetchall()
            return [dict(row) for row in rows]

    def delete_jobs(self, job_ids: list[str]) -> list[dict[str, Any]]:
        unique_ids = list(dict.fromkeys(str(job_id) for job_id in job_ids if job_id))
        if not unique_ids:
            return []
        placeholders = ",".join("?" for _ in unique_ids)
        with self._lock, self.connect() as connection:
            rows = connection.execute(
                f"""
                SELECT * FROM jobs
                WHERE id IN ({placeholders})
                  AND status NOT IN ('queued', 'processing')
                """,
                unique_ids,
            ).fetchall()
            deletable = [dict(row) for row in rows]
            deletable_ids = [str(row["id"]) for row in deletable]
            if deletable_ids:
                delete_placeholders = ",".join("?" for _ in deletable_ids)
                connection.execute(
                    f"DELETE FROM jobs WHERE id IN ({delete_placeholders})",
                    deletable_ids,
                )
            return deletable

    def jobs_to_resume(self) -> list[str]:
        with self._lock, self.connect() as connection:
            rows = connection.execute(
                "SELECT id FROM jobs WHERE status IN ('queued', 'processing') ORDER BY created_at"
            ).fetchall()
            ids = [str(row["id"]) for row in rows]
            connection.execute(
                "UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'processing'"
            )
            return ids

