from __future__ import annotations

import os
import tempfile
import time
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from wearable_eeg.synthetic import generate_demo


_TEMP = tempfile.TemporaryDirectory()
os.environ["EEG_DATA_DIR"] = _TEMP.name
os.environ["EEG_INVITE_CODE"] = "test-invite-code"
os.environ["EEG_COOKIE_SECRET"] = "test-secret-that-is-long-enough-for-local-tests"
os.environ["EEG_WORKERS"] = "2"

from team_platform.app import app  # noqa: E402


class TeamPlatformTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.context = TestClient(app)
        cls.client = cls.context.__enter__()
        response = cls.client.post(
            "/api/auth/register",
            json={
                "username": "platform-owner",
                "password": "strong-password-123",
                "invite_code": "test-invite-code",
            },
        )
        assert response.status_code == 200, response.text
        cls.owner = response.json()["user"]

    def setUp(self) -> None:
        response = self.client.post(
            "/api/auth/login",
            json={"username": "platform-owner", "password": "strong-password-123"},
        )
        self.assertEqual(response.status_code, 200, response.text)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.context.__exit__(None, None, None)
        _TEMP.cleanup()

    def register(self, username: str) -> dict:
        response = self.client.post(
            "/api/auth/register",
            json={
                "username": username,
                "password": "strong-password-123",
                "invite_code": "test-invite-code",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["user"]

    def wait_for_job(self, job_id: str, timeout: float = 20.0) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            response = self.client.get(f"/api/jobs/{job_id}")
            self.assertEqual(response.status_code, 200, response.text)
            job = response.json()["job"]
            if job["status"] in {"completed", "failed"}:
                return job
            time.sleep(0.15)
        self.fail(f"任务 {job_id} 超时未完成")

    def test_health_and_auth_required(self) -> None:
        self.assertEqual(self.client.get("/api/health").status_code, 200)
        self.client.cookies.clear()
        self.assertEqual(self.client.get("/api/jobs").status_code, 401)

    def test_team_upload_queue_and_shared_history(self) -> None:
        self.assertEqual(self.owner["role"], "admin")
        alice = self.register("alice")
        self.assertEqual(alice["role"], "member")

        frame = generate_demo(seconds=12, sample_rate=128)
        csv_bytes = frame.to_csv(index=False).encode("utf-8")
        response = self.client.post(
            "/api/jobs/upload",
            files={"file": ("alice-demo.csv", csv_bytes, "text/csv")},
            data={
                "title": "Alice data acceptance",
                "backend": "baseline",
                "target_rate_hz": "128",
                "low_hz": "0.5",
                "high_hz": "45",
                "notch_hz": "50",
                "motion_threshold_g": "0.25",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        job_id = response.json()["job"]["id"]
        completed = self.wait_for_job(job_id)
        self.assertEqual(completed["status"], "completed", completed)
        self.assertIn(completed["quality_grade"], {"A", "B", "C", "D"})

        report = self.client.get(f"/api/jobs/{job_id}/report")
        self.assertEqual(report.status_code, 200)
        self.assertIn("quality", report.json())
        features = self.client.get(f"/api/jobs/{job_id}/download/features.csv")
        self.assertEqual(features.status_code, 200)
        self.assertGreater(len(features.content), 100)
        self.assertIn("filename*=utf-8''", features.headers["content-disposition"])

        bob = self.register("bob")
        self.assertEqual(bob["role"], "member")
        jobs = self.client.get("/api/jobs")
        self.assertEqual(jobs.status_code, 200)
        self.assertTrue(any(job["id"] == job_id for job in jobs.json()["jobs"]))

    def test_demo_job_and_report_view(self) -> None:
        response = self.client.post(
            "/api/jobs/demo",
            json={"title": "Team demo", "config": {"backend": "baseline"}},
        )
        self.assertEqual(response.status_code, 200, response.text)
        job_id = response.json()["job"]["id"]
        completed = self.wait_for_job(job_id)
        self.assertEqual(completed["status"], "completed", completed)
        html = self.client.get(f"/api/jobs/{job_id}/view")
        self.assertEqual(html.status_code, 200)
        self.assertIn("EEG/IMU 数据质量报告", html.text)


if __name__ == "__main__":
    unittest.main()
