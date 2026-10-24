from __future__ import annotations

import json
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

import numpy as np
import pandas as pd

from wearable_eeg.io import DataFormatError, load_csv_text
from wearable_eeg.labels import LabelInterval, canonical_sleep_stage, labels_at_times
from wearable_eeg.pipeline import PipelineConfig, process_dataframe
from wearable_eeg.report import jsonable
from wearable_eeg.server import AppHandler
from wearable_eeg.synthetic import generate_demo


class PipelineTests(unittest.TestCase):
    def test_demo_runs_end_to_end(self) -> None:
        frame = generate_demo(seconds=20, sample_rate=128)
        report, processed = process_dataframe(frame, source_name="demo.csv")

        self.assertEqual(report["overview"]["eeg_channels"], ["eeg_fpz", "eeg_pz"])
        self.assertEqual(report["overview"]["imu_channels"], ["acc_x_g", "acc_y_g", "acc_z_g"])
        self.assertGreater(report["quality"]["overall"]["score"], 80)
        self.assertGreater(report["quality"]["motion"]["artifact_ratio"], 0)
        self.assertGreater(report["features"]["rows"].__len__(), 0)
        self.assertIn("_motion_artifact", processed.columns)
        json.dumps(jsonable(report), ensure_ascii=False, allow_nan=False)

    def test_time_column_can_be_generated_from_sample_rate(self) -> None:
        csv_text = "\n".join(
            [
                "eeg_fpz,eeg_pz,acc_x_g,acc_y_g,acc_z_g,state_label",
                "1,2,0,0,1,relaxed",
                "1.1,2.1,0,0,1,focused",
                "0.9,1.9,0,0,1,relaxed",
                "1.2,2.2,0,0,1,fatigued",
            ]
        )
        frame = load_csv_text(csv_text, sample_rate=128)
        self.assertEqual(frame["_time_s"].iloc[0], 0.0)
        self.assertTrue(np.allclose(np.diff(frame["_time_s"]), 1 / 128))
        self.assertEqual(frame["state_label"].iloc[0], "relaxed")

    def test_gap_is_reported(self) -> None:
        frame = generate_demo(seconds=20)
        frame = pd.concat([frame.iloc[:500], frame.iloc[900:]], ignore_index=True)
        report, _ = process_dataframe(frame)
        self.assertGreater(report["alignment"]["estimated_missing_ratio"], 0)

    def test_missing_eeg_column_is_rejected(self) -> None:
        csv_text = "time_s,acc_x,acc_y,acc_z\n0,0,0,1\n0.1,0,0,1"
        with self.assertRaises(DataFormatError):
            load_csv_text(csv_text)

    def test_sleep_stage_mapping_and_interval_alignment(self) -> None:
        self.assertEqual(canonical_sleep_stage("Sleep stage W"), "wake")
        self.assertEqual(canonical_sleep_stage("Sleep stage 2"), "n2")
        self.assertEqual(canonical_sleep_stage("Sleep stage R"), "rem")
        labels = labels_at_times(
            np.array([0.0, 29.9, 30.0, 59.9, 60.0]),
            [
                LabelInterval(0, 30, "wake", "Sleep stage W"),
                LabelInterval(30, 30, "n2", "Sleep stage 2"),
            ],
        )
        self.assertEqual(labels.tolist(), ["wake", "wake", "n2", "n2", "unknown"])

    def test_target_rate_must_be_positive(self) -> None:
        with self.assertRaises(ValueError):
            process_dataframe(
                generate_demo(seconds=10),
                PipelineConfig(target_rate_hz=0),
            )

    def test_research_backend_if_available(self) -> None:
        try:
            import mne  # noqa: F401
            import scipy  # noqa: F401
        except ImportError:
            self.skipTest("研究依赖未安装")
        report, _ = process_dataframe(
            generate_demo(seconds=12),
            PipelineConfig(backend="research"),
        )
        self.assertEqual(report["config"]["backend"], "research")
        self.assertIsNotNone(report["environment"]["mne"])
        self.assertGreater(report["quality"]["overall"]["score"], 70)


class WebApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), AppHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def post(self, path: str, payload: dict) -> dict:
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))

    def test_health_and_demo_api(self) -> None:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{self.port}/api/health", timeout=5
        ) as response:
            self.assertEqual(json.loads(response.read())["status"], "ok")
        result = self.post("/api/demo", {"seconds": 12, "config": {"target_rate_hz": 128}})
        self.assertIn("report", result)
        self.assertIn("<html", result["html_report"])
        self.assertGreater(len(result["report"]["preview"]["eeg"]), 0)


if __name__ == "__main__":
    unittest.main()
