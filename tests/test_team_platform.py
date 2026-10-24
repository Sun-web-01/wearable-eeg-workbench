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

    def wait_for_acquisition(self, session_id: str, timeout: float = 15.0) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            response = self.client.get(f"/api/acquisitions/{session_id}")
            self.assertEqual(response.status_code, 200, response.text)
            session = response.json()["session"]
            if session["status"] in {"completed", "failed"}:
                return session
            time.sleep(0.15)
        self.fail(f"采集任务 {session_id} 超时未完成")

    def test_health_and_auth_required(self) -> None:
        self.assertEqual(self.client.get("/api/health").status_code, 200)
        page = self.client.get("/")
        self.assertEqual(page.status_code, 200)
        self.assertIn("no-store", page.headers["cache-control"])
        self.client.cookies.clear()
        self.assertEqual(self.client.get("/api/jobs").status_code, 401)

    def test_account_username_and_password_update(self) -> None:
        self.register("account-tester")
        response = self.client.patch(
            "/api/account",
            json={
                "current_password": "strong-password-123",
                "new_username": "account-updated",
                "new_password": "new-password-456",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["user"]["username"], "account-updated")

        self.client.cookies.clear()
        old_login = self.client.post(
            "/api/auth/login",
            json={"username": "account-tester", "password": "strong-password-123"},
        )
        self.assertEqual(old_login.status_code, 401)
        new_login = self.client.post(
            "/api/auth/login",
            json={"username": "account-updated", "password": "new-password-456"},
        )
        self.assertEqual(new_login.status_code, 200, new_login.text)

    def test_username_accepts_any_language_and_symbols(self) -> None:
        original_name = "🌙·Alice / 研究"
        changed_name = "数据&实验 #01 ✨"
        user = self.register(original_name)
        self.assertEqual(user["username"], original_name)
        updated = self.client.patch(
            "/api/account",
            json={
                "current_password": "strong-password-123",
                "new_username": changed_name,
                "new_password": None,
            },
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["user"]["username"], changed_name)
        self.client.cookies.clear()
        login = self.client.post(
            "/api/auth/login",
            json={"username": changed_name, "password": "strong-password-123"},
        )
        self.assertEqual(login.status_code, 200, login.text)

    def test_synthetic_device_acquisition_and_analysis(self) -> None:
        profiles = self.client.get("/api/devices/profiles")
        self.assertEqual(profiles.status_code, 200)
        self.assertIn("synthetic", [item["id"] for item in profiles.json()["profiles"]])

        unconfirmed = self.client.post(
            "/api/acquisitions",
            json={
                "profile_id": "synthetic",
                "address": "",
                "subject_id": "S99",
                "task": "rest",
                "duration_sec": 3,
                "simulation_ack": False,
            },
        )
        self.assertEqual(unconfirmed.status_code, 400)

        response = self.client.post(
            "/api/acquisitions",
            json={
                "profile_id": "synthetic",
                "address": "",
                "subject_id": "S99",
                "task": "rest",
                "duration_sec": 3,
                "simulation_ack": True,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        session = response.json()["session"]
        self.assertTrue(session["csv_name"].startswith("sub-s99_task-rest_acq-synthetic_"))
        active_delete = self.client.delete(f"/api/acquisitions/{session['id']}")
        self.assertEqual(active_delete.status_code, 409, active_delete.text)
        completed = self.wait_for_acquisition(session["id"])
        self.assertEqual(completed["status"], "completed", completed)
        self.assertTrue(completed["edf_name"].endswith(".edf"))

        csv_file = self.client.get(f"/api/acquisitions/{session['id']}/download/csv")
        metadata = self.client.get(f"/api/acquisitions/{session['id']}/download/metadata")
        self.assertEqual(csv_file.status_code, 200)
        self.assertEqual(metadata.status_code, 200)
        self.assertIn("sub-s99_task-rest_acq-synthetic_", metadata.headers["content-disposition"])
        self.assertEqual(metadata.json()["recording"]["files"]["csv"], completed["csv_name"])

        analyzed = self.client.post(f"/api/acquisitions/{session['id']}/analyze")
        self.assertEqual(analyzed.status_code, 200, analyzed.text)
        job = self.wait_for_job(analyzed.json()["job"]["id"])
        self.assertEqual(job["status"], "completed", job)
        deleted = self.client.delete(f"/api/acquisitions/{session['id']}")
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertEqual(deleted.json()["deleted"], [session["id"]])
        self.assertEqual(self.client.get(f"/api/acquisitions/{session['id']}").status_code, 404)
        self.assertEqual(
            self.client.get(f"/api/acquisitions/{session['id']}/download/csv").status_code,
            404,
        )

    def test_custom_brainflow_device_acquisition(self) -> None:
        response = self.client.post(
            "/api/acquisitions",
            json={
                "profile_id": "custom",
                "custom_label": "Lab Custom EEG",
                "custom_board_id": -1,
                "custom_transport": "none",
                "address": "",
                "subject_id": "S96",
                "task": "focused",
                "duration_sec": 3,
                "simulation_ack": False,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        session = response.json()["session"]
        self.assertEqual(session["profile_label"], "Lab Custom EEG")
        self.assertEqual(session["custom_board_id"], -1)
        self.assertTrue(session["csv_name"].startswith("sub-s96_task-focused_acq-lab-custom-eeg_"))
        completed = self.wait_for_acquisition(session["id"])
        self.assertEqual(completed["status"], "completed", completed)
        self.assertTrue(completed["csv_name"].endswith(".csv"))
        deleted = self.client.delete(f"/api/acquisitions/{session['id']}")
        self.assertEqual(deleted.status_code, 200, deleted.text)

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
        self.assertIn("系统合成演示数据", html.text)
        self.assertIn("如何阅读这份报告", html.text)
        self.assertIn("features.csv 字段说明", html.text)

    def test_job_single_and_bulk_delete(self) -> None:
        job_ids = []
        for title in ("待单条删除任务", "待批量删除任务 A", "待批量删除任务 B"):
            response = self.client.post(
                "/api/jobs/demo",
                json={"title": title, "config": {"backend": "baseline"}},
            )
            self.assertEqual(response.status_code, 200, response.text)
            job_id = response.json()["job"]["id"]
            self.wait_for_job(job_id)
            job_ids.append(job_id)

        single = self.client.delete(f"/api/jobs/{job_ids[0]}")
        self.assertEqual(single.status_code, 200, single.text)
        self.assertEqual(single.json()["deleted"], [job_ids[0]])
        self.assertEqual(self.client.get(f"/api/jobs/{job_ids[0]}").status_code, 404)

        bulk = self.client.post("/api/jobs/bulk-delete", json={"ids": job_ids[1:]})
        self.assertEqual(bulk.status_code, 200, bulk.text)
        self.assertCountEqual(bulk.json()["deleted"], job_ids[1:])
        remaining = {job["id"] for job in self.client.get("/api/jobs").json()["jobs"]}
        self.assertFalse(remaining.intersection(job_ids))


if __name__ == "__main__":
    unittest.main()
