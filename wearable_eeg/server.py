from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .io import DataFormatError, load_csv_text
from .pipeline import PipelineConfig, process_dataframe
from .report import jsonable, render_html
from .synthetic import generate_demo


WEB_ROOT = Path(__file__).resolve().parent.parent / "web"
MAX_BODY_BYTES = 20 * 1024 * 1024


def _pipeline_config(payload: dict[str, Any]) -> PipelineConfig:
    raw = payload.get("config", {})
    notch = raw.get("notch_hz", 50.0)
    return PipelineConfig(
        backend=str(raw.get("backend", "baseline")),
        target_rate_hz=float(raw.get("target_rate_hz", 128.0)),
        low_hz=float(raw.get("low_hz", 0.5)),
        high_hz=float(raw.get("high_hz", 45.0)),
        notch_hz=None if notch is None or float(notch) <= 0 else float(notch),
        motion_threshold_g=float(raw.get("motion_threshold_g", 0.25)),
    )


def _process_csv(
    csv_text: str,
    source_name: str,
    sample_rate: float | None,
    config: PipelineConfig,
) -> dict[str, Any]:
    frame = load_csv_text(csv_text, sample_rate=sample_rate)
    report, _ = process_dataframe(
        frame,
        config=config,
        source_name=source_name,
        metadata={"source_format": "csv", "web_upload": True},
    )
    return {
        "report": jsonable(report),
        "html_report": render_html(report),
    }


class AppHandler(BaseHTTPRequestHandler):
    server_version = "WearableEEGWorkbench/0.1"

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(jsonable(payload), ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _static(self, relative: str | None = None) -> None:
        relative = "index.html" if not relative or relative == "/" else relative.lstrip("/")
        allowed = {"index.html", "app.js", "styles.css"}
        if relative not in allowed:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        path = WEB_ROOT / relative
        if not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
        }.get(path.suffix, "application/octet-stream")
        body = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            self._json(HTTPStatus.OK, {"status": "ok", "version": "0.1.0"})
            return
        self._static(path)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "无效的 Content-Length"})
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self._json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {"error": "请求必须包含数据且不得超过 20 MB。"},
            )
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("请求体必须是 JSON 对象。")
            config = _pipeline_config(payload)
            if path == "/api/process":
                csv_text = payload.get("csv_text")
                if not isinstance(csv_text, str) or not csv_text.strip():
                    raise ValueError("缺少 csv_text。")
                sample_rate = payload.get("sample_rate")
                result = _process_csv(
                    csv_text,
                    str(payload.get("filename") or "uploaded.csv"),
                    float(sample_rate) if sample_rate not in (None, "") else None,
                    config,
                )
            elif path == "/api/demo":
                seconds = min(600.0, max(10.0, float(payload.get("seconds", 90.0))))
                frame = generate_demo(seconds=seconds)
                report, _ = process_dataframe(
                    frame,
                    config=config,
                    source_name="demo_input.csv",
                    metadata={"source_format": "synthetic", "purpose": "pipeline_acceptance"},
                )
                result = {"report": jsonable(report), "html_report": render_html(report)}
            else:
                self._json(HTTPStatus.NOT_FOUND, {"error": "接口不存在。"})
                return
            self._json(HTTPStatus.OK, result)
        except (DataFormatError, ValueError, TypeError, json.JSONDecodeError) as exc:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception as exc:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"处理失败：{exc}"})

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[web] {self.address_string()} {fmt % args}")


def serve(host: str = "127.0.0.1", port: int = 8000) -> None:
    server = ThreadingHTTPServer((host, port), AppHandler)
    print(f"EEG/IMU Data Lab: http://{host}:{port}")
    print("按 Ctrl+C 停止服务。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。")
    finally:
        server.server_close()

