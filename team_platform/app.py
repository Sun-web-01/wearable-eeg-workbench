from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import uuid
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from wearable_eeg.pipeline import PipelineConfig

from .auth import (
    create_session,
    hash_password,
    parse_session,
    validate_credentials,
    verify_password,
)
from .config import Settings, load_settings
from .db import Database, utc_now
from .worker import JobRunner


settings = load_settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
(settings.data_dir / "uploads").mkdir(exist_ok=True)
(settings.data_dir / "jobs").mkdir(exist_ok=True)
database = Database(settings.data_dir / "team.db")
runner = JobRunner(database, workers=settings.workers)
WEB_ROOT = Path(__file__).resolve().parent.parent / "team_web"


@asynccontextmanager
async def lifespan(_: FastAPI):
    runner.resume_pending()
    yield
    runner.shutdown()


app = FastAPI(
    title="可穿戴脑电团队协作平台",
    version="0.2.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
)


class AuthPayload(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    invite_code: str | None = None


class DemoPayload(BaseModel):
    title: str = "90 秒团队演示"
    config: dict[str, Any] = Field(default_factory=dict)


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user["id"],
        "username": user["username"],
        "role": user["role"],
        "created_at": user.get("created_at"),
    }


def public_job(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": job["id"],
        "owner_name": job["owner_name"],
        "title": job["title"],
        "mode": job["mode"],
        "input_name": job["input_name"],
        "input_sha256": job["input_sha256"],
        "backend": job["backend"],
        "config": json.loads(job["config_json"]),
        "status": job["status"],
        "quality_grade": job["quality_grade"],
        "quality_score": job["quality_score"],
        "duration_s": job["duration_s"],
        "error": job["error"],
        "created_at": job["created_at"],
        "started_at": job["started_at"],
        "finished_at": job["finished_at"],
        "has_report": bool(job["output_dir"]),
    }


def current_user(request: Request) -> dict[str, Any]:
    token = request.cookies.get(settings.cookie_name)
    payload = parse_session(token, settings.cookie_secret) if token else None
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    user = database.get_user(int(payload["uid"]))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号不存在")
    return user


def set_session(response: JSONResponse, user: dict[str, Any]) -> None:
    token = create_session(user, settings.cookie_secret)
    response.set_cookie(
        key=settings.cookie_name,
        value=token,
        max_age=7 * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=os.getenv("EEG_COOKIE_SECURE", "0") in {"1", "true", "True"},
        path="/",
    )


def safe_filename(filename: str) -> str:
    name = Path(filename).name.strip()
    name = re.sub(r"[\x00-\x1f]", "_", name)
    if not name:
        raise ValueError("文件名无效。")
    return name[:180]


def artifact_download_name(job: dict[str, Any], artifact: str) -> str:
    labels = {
        "report.html": "质量报告.html",
        "report.json": "分析报告.json",
        "features.csv": "窗口特征.csv",
        "processed.csv": "处理后数据.csv",
    }
    base = safe_filename(str(job.get("title") or "EEG任务"))
    base = re.sub(r"\.(csv|edf)$", "", base, flags=re.IGNORECASE)
    base = re.sub(r'[<>:"/\\|?*]', "_", base).strip(" ._")[:80] or "EEG任务"
    date = str(job.get("created_at") or "")[:10] or "未注明日期"
    return f"{base}_{date}_{str(job['id'])[:6]}_{labels[artifact]}"


async def save_upload(upload: UploadFile, destination: Path, max_bytes: int) -> tuple[int, str]:
    hasher = hashlib.sha256()
    total = 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as target:
        while chunk := await upload.read(1024 * 1024):
            total += len(chunk)
            if total > max_bytes:
                target.close()
                destination.unlink(missing_ok=True)
                raise ValueError(f"文件超过 {max_bytes // (1024 * 1024)} MB 上限。")
            hasher.update(chunk)
            target.write(chunk)
    if total == 0:
        destination.unlink(missing_ok=True)
        raise ValueError("上传文件为空。")
    return total, hasher.hexdigest()


def config_from_mapping(data: dict[str, Any]) -> PipelineConfig:
    backend = str(data.get("backend", "research"))
    if backend not in {"baseline", "research"}:
        raise ValueError("处理后端必须是 baseline 或 research。")
    config = PipelineConfig(
        backend=backend,
        target_rate_hz=float(data.get("target_rate_hz", 128)),
        low_hz=float(data.get("low_hz", 0.5)),
        high_hz=float(data.get("high_hz", 45)),
        notch_hz=(
            None
            if data.get("notch_hz") in {None, "", 0, "0"}
            else float(data.get("notch_hz"))
        ),
        motion_threshold_g=float(data.get("motion_threshold_g", 0.25)),
        window_sec=float(data.get("window_sec", 4)),
        step_sec=float(data.get("step_sec", 2)),
    )
    if not 0 <= config.low_hz < config.high_hz:
        raise ValueError("带通范围无效。")
    if config.high_hz <= 0 or config.target_rate_hz <= 0:
        raise ValueError("频率和采样率必须大于零。")
    return config


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "version": "0.2.0",
        "registration": settings.allow_registration,
        "workers": settings.workers,
    }


@app.post("/api/auth/register")
def register(payload: AuthPayload) -> JSONResponse:
    if not settings.allow_registration:
        raise HTTPException(status_code=403, detail="当前未开放注册")
    if not payload.invite_code or payload.invite_code != settings.invite_code:
        raise HTTPException(status_code=403, detail="邀请码不正确")
    try:
        username, password = validate_credentials(payload.username, payload.password)
        user = database.create_user(username, hash_password(password))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    response = JSONResponse({"user": public_user(user)})
    set_session(response, user)
    return response


@app.post("/api/auth/login")
def login(payload: AuthPayload) -> JSONResponse:
    user = database.get_user_by_name(payload.username.strip())
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    response = JSONResponse({"user": public_user(user)})
    set_session(response, user)
    return response


@app.post("/api/auth/logout")
def logout() -> JSONResponse:
    response = JSONResponse({"ok": True})
    response.delete_cookie(settings.cookie_name, path="/")
    return response


@app.get("/api/me")
def me(user: Annotated[dict[str, Any], Depends(current_user)]) -> dict[str, Any]:
    return {"user": public_user(user)}


@app.get("/api/jobs")
def list_jobs(user: Annotated[dict[str, Any], Depends(current_user)]) -> dict[str, Any]:
    jobs = [public_job(job) for job in database.list_jobs()]
    return {
        "jobs": jobs,
        "stats": {
            "total": len(jobs),
            "completed": sum(job["status"] == "completed" for job in jobs),
            "processing": sum(job["status"] in {"queued", "processing"} for job in jobs),
            "failed": sum(job["status"] == "failed" for job in jobs),
        },
        "viewer": public_user(user),
    }


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str, _: Annotated[dict[str, Any], Depends(current_user)]) -> dict[str, Any]:
    job = database.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {
        "job": public_job(job),
        "events": database.get_events(job_id),
    }


@app.get("/api/jobs/{job_id}/report")
def get_report(job_id: str, _: Annotated[dict[str, Any], Depends(current_user)]):
    job = database.get_job(job_id)
    if not job or not job["output_dir"]:
        raise HTTPException(status_code=404, detail="任务结果不存在")
    path = Path(job["output_dir"]) / "report.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="报告尚未生成")
    return JSONResponse(json.loads(path.read_text(encoding="utf-8")))


@app.get("/api/jobs/{job_id}/view", response_class=HTMLResponse)
def view_report(job_id: str, _: Annotated[dict[str, Any], Depends(current_user)]):
    job = database.get_job(job_id)
    if not job or not job["output_dir"]:
        raise HTTPException(status_code=404, detail="任务结果不存在")
    path = Path(job["output_dir"]) / "report.html"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="报告尚未生成")
    return HTMLResponse(path.read_text(encoding="utf-8"))


@app.get("/api/jobs/{job_id}/download/{artifact}")
def download_artifact(
    job_id: str,
    artifact: str,
    _: Annotated[dict[str, Any], Depends(current_user)],
):
    allowed = {
        "report.json": "report.json",
        "report.html": "report.html",
        "features.csv": "features.csv",
        "processed.csv": "processed.csv",
    }
    if artifact not in allowed:
        raise HTTPException(status_code=404, detail="文件不存在")
    job = database.get_job(job_id)
    if not job or not job["output_dir"]:
        raise HTTPException(status_code=404, detail="任务结果不存在")
    path = Path(job["output_dir"]) / allowed[artifact]
    if not path.is_file():
        raise HTTPException(status_code=404, detail="文件尚未生成")
    return FileResponse(path, filename=artifact_download_name(job, artifact))


@app.post("/api/jobs/demo")
def create_demo_job(
    payload: DemoPayload,
    user: Annotated[dict[str, Any], Depends(current_user)],
) -> dict[str, Any]:
    config = config_from_mapping(payload.config)
    job_id = uuid.uuid4().hex[:12]
    output_dir = settings.data_dir / "jobs" / job_id
    database.create_job(
        job_id=job_id,
        user=user,
        title=payload.title.strip()[:120] or "团队演示",
        mode="demo",
        backend=config.backend,
        config_json=json.dumps(asdict(config), ensure_ascii=False),
        output_dir=str(output_dir),
    )
    database.add_event(job_id, "任务已进入队列")
    runner.submit(job_id)
    return {"job": public_job(database.get_job(job_id))}


@app.post("/api/jobs/upload")
async def upload_job(
    user: Annotated[dict[str, Any], Depends(current_user)],
    file: Annotated[UploadFile, File(...)],
    annotations: Annotated[UploadFile | None, File()] = None,
    title: Annotated[str, Form()] = "",
    backend: Annotated[str, Form()] = "research",
    target_rate_hz: Annotated[float, Form()] = 128,
    low_hz: Annotated[float, Form()] = 0.5,
    high_hz: Annotated[float, Form()] = 45,
    notch_hz: Annotated[float | None, Form()] = 50,
    motion_threshold_g: Annotated[float, Form()] = 0.25,
) -> dict[str, Any]:
    input_name = safe_filename(file.filename or "")
    suffix = Path(input_name).suffix.lower()
    if suffix not in {".csv", ".edf"}:
        raise HTTPException(status_code=400, detail="仅支持 CSV 或 EDF")

    config = config_from_mapping(
        {
            "backend": backend,
            "target_rate_hz": target_rate_hz,
            "low_hz": low_hz,
            "high_hz": high_hz,
            "notch_hz": notch_hz,
            "motion_threshold_g": motion_threshold_g,
        }
    )
    job_id = uuid.uuid4().hex[:12]
    upload_dir = settings.data_dir / "uploads" / job_id
    input_path = upload_dir / input_name
    annotation_path: Path | None = None
    annotations_name: str | None = None
    try:
        _, digest = await save_upload(
            file,
            input_path,
            settings.max_upload_mb * 1024 * 1024,
        )
        if annotations and annotations.filename:
            annotations_name = safe_filename(annotations.filename)
            if Path(annotations_name).suffix.lower() != ".edf":
                raise ValueError("睡眠标注文件必须是 EDF。")
            annotation_path = upload_dir / f"annotations-{annotations_name}"
            await save_upload(
                annotations,
                annotation_path,
                settings.max_upload_mb * 1024 * 1024,
            )
    except ValueError as exc:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    output_dir = settings.data_dir / "jobs" / job_id
    database.create_job(
        job_id=job_id,
        user=user,
        title=(title.strip() or Path(input_name).stem)[:120],
        mode="upload",
        backend=config.backend,
        config_json=json.dumps(asdict(config), ensure_ascii=False),
        input_name=input_name,
        input_path=str(input_path),
        annotations_path=str(annotation_path) if annotation_path else None,
        input_sha256=digest,
        output_dir=str(output_dir),
    )
    database.add_event(job_id, f"已上传 {input_name}")
    database.add_event(job_id, "任务已进入队列")
    runner.submit(job_id)
    return {"job": public_job(database.get_job(job_id))}


@app.get("/api/datasets")
def datasets(_: Annotated[dict[str, Any], Depends(current_user)]) -> dict[str, Any]:
    path = Path(__file__).resolve().parent.parent / "data" / "datasets.json"
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/")
def index():
    return FileResponse(WEB_ROOT / "index.html")


app.mount("/assets", StaticFiles(directory=WEB_ROOT), name="assets")


def run() -> None:
    import uvicorn

    uvicorn.run(
        "team_platform.app:app",
        host=os.getenv("EEG_HOST", "0.0.0.0"),
        port=int(os.getenv("EEG_PORT", "8000")),
        reload=False,
    )

