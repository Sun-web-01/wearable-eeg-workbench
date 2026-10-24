const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  authMode: "login",
  jobs: [],
  selectedFile: null,
  pollTimer: null,
};

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  if (response.status === 401) {
    showAuth();
    throw new Error("请重新登录");
  }
  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await response.json() : null;
  if (!response.ok) throw new Error(data?.detail || data?.error || `HTTP ${response.status}`);
  return data;
}

function setAuthMode(mode) {
  state.authMode = mode;
  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authTab === mode);
  });
  document.querySelectorAll(".register-only").forEach((element) => {
    element.classList.toggle("hidden", mode !== "register");
  });
  $("authSubmit").textContent = mode === "login" ? "登录平台" : "注册并加入团队";
  $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("authError").classList.add("hidden");
}

function showAuth() {
  state.user = null;
  clearInterval(state.pollTimer);
  $("appShell").classList.add("hidden");
  $("authShell").classList.remove("hidden");
}

function showApp(user) {
  state.user = user;
  $("authShell").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  $("currentUser").textContent = user.username;
  $("currentRole").textContent = user.role === "admin" ? "团队管理员" : "团队成员";
  $("avatar").textContent = user.username.slice(0, 1).toUpperCase();
  loadJobs();
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(loadJobs, 3500);
}

function showMessage(message, error = false) {
  const element = $("uploadMessage");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.remove("hidden");
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function statusLabel(status) {
  return { queued: "排队中", processing: "处理中", completed: "已完成", failed: "失败" }[status] || status;
}

function renderJobs(data) {
  state.jobs = data.jobs;
  $("statTotal").textContent = data.stats.total;
  $("statCompleted").textContent = data.stats.completed;
  $("statProcessing").textContent = data.stats.processing;
  $("statFailed").textContent = data.stats.failed;

  if (!data.jobs.length) {
    $("jobsBody").innerHTML = '<tr><td colspan="8" class="empty">还没有任务。上传数据或创建一个演示任务。</td></tr>';
    return;
  }
  $("jobsBody").innerHTML = data.jobs.map((job) => `
    <tr>
      <td><span class="task-name">${escapeHtml(job.title)}</span><span class="subline">${escapeHtml(job.input_name || "系统演示数据")}</span></td>
      <td>${escapeHtml(job.owner_name)}</td>
      <td>${escapeHtml(job.input_name || "Synthetic")}</td>
      <td>${job.backend === "research" ? "Research" : "Baseline"}</td>
      <td><span class="badge ${job.status}">${statusLabel(job.status)}</span></td>
      <td>${job.quality_grade ? `<span class="badge ${job.quality_grade}">${job.quality_grade} · ${Number(job.quality_score).toFixed(1)}</span>` : "—"}</td>
      <td>${formatTime(job.created_at)}</td>
      <td><button class="link-button" data-job-id="${job.id}">详情</button></td>
    </tr>`).join("");

  document.querySelectorAll("[data-job-id]").forEach((button) => {
    button.addEventListener("click", () => openJob(button.dataset.jobId));
  });
}

async function loadJobs() {
  if (!state.user) return;
  try {
    renderJobs(await api("/api/jobs"));
  } catch (error) {
    if (error.message !== "请重新登录") showMessage(`任务读取失败：${error.message}`, true);
  }
}

function configFromForm() {
  return {
    backend: $("backend").value,
    target_rate_hz: Number($("targetRate").value),
    low_hz: Number($("lowHz").value),
    high_hz: Number($("highHz").value),
    notch_hz: Number($("notchHz").value),
    motion_threshold_g: Number($("motionThreshold").value),
  };
}

async function openJob(jobId) {
  const dialog = $("jobDialog");
  $("dialogTitle").textContent = "正在读取任务…";
  $("dialogContent").innerHTML = "";
  dialog.showModal();
  try {
    const data = await api(`/api/jobs/${jobId}`);
    const job = data.job;
    $("dialogTitle").textContent = job.title;
    const downloads = job.has_report && job.status === "completed" ? `
      <div class="downloads">
        <a href="/api/jobs/${job.id}/view" target="_blank">打开 HTML 报告</a>
        <a href="/api/jobs/${job.id}/download/report.json">report.json</a>
        <a href="/api/jobs/${job.id}/download/features.csv">features.csv</a>
        <a href="/api/jobs/${job.id}/download/processed.csv">processed.csv</a>
      </div>` : "";
    $("dialogContent").innerHTML = `
      <div class="detail-metrics">
        <div><span>状态</span><strong>${statusLabel(job.status)}</strong></div>
        <div><span>数据时长</span><strong>${job.duration_s ? `${Number(job.duration_s).toFixed(1)}s` : "—"}</strong></div>
        <div><span>质量等级</span><strong>${job.quality_grade || "—"}</strong></div>
        <div><span>提交者</span><strong>${escapeHtml(job.owner_name)}</strong></div>
      </div>
      <p class="subline">输入：${escapeHtml(job.input_name || "系统演示数据")} · SHA-256：${escapeHtml(job.input_sha256 || "N/A")}</p>
      ${job.error ? `<div class="auth-error">${escapeHtml(job.error)}</div>` : ""}
      <h3>任务日志</h3>
      <div class="event-log">${data.events.map((event) => `<div>${escapeHtml(event.message)}<time>${formatTime(event.created_at)}</time></div>`).join("")}</div>
      ${downloads}`;
  } catch (error) {
    $("dialogTitle").textContent = "任务读取失败";
    $("dialogContent").innerHTML = `<div class="auth-error">${escapeHtml(error.message)}</div>`;
  }
}

async function loadDatasets() {
  if (!state.user) return;
  try {
    const data = await api("/api/datasets");
    $("datasetGrid").innerHTML = data.datasets.map((dataset) => `
      <article class="dataset-card">
        <div class="top"><span class="badge ${dataset.priority === "P0" ? "A" : ""}">${dataset.priority}</span><span class="badge">${escapeHtml(dataset.task)}</span></div>
        <h3>${escapeHtml(dataset.name)}</h3>
        <p>${escapeHtml(dataset.first_action)}</p>
        <div class="dataset-meta">
          <span>${escapeHtml(dataset.channels)}</span>
          <span>${dataset.sample_rate_hz ? `${dataset.sample_rate_hz} Hz` : "采样率待确认"}</span>
          <span>${escapeHtml(dataset.access)}</span>
          <span>${escapeHtml(dataset.license)}</span>
        </div>
        ${dataset.official_url ? `<a href="${escapeHtml(dataset.official_url)}" target="_blank" rel="noreferrer">查看官方页面 ↗</a>` : ""}
      </article>`).join("");
  } catch (error) {
    $("datasetGrid").innerHTML = `<div class="auth-error">${escapeHtml(error.message)}</div>`;
  }
}

function setView(view) {
  document.querySelectorAll(".view").forEach((element) => element.classList.add("hidden"));
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $(`${view}View`).classList.remove("hidden");
  const labels = { jobs: ["任务台", "团队任务台"], datasets: ["数据资源", "公开数据集"], protocol: ["团队规范", "数据与实验规范"] };
  $("viewLabel").textContent = labels[view][0];
  $("pageTitle").textContent = labels[view][1];
  if (view === "datasets") loadDatasets();
}

document.querySelectorAll("[data-auth-tab]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.authTab));
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("authError").classList.add("hidden");
  const path = state.authMode === "login" ? "/api/auth/login" : "/api/auth/register";
  try {
    const data = await api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: $("username").value.trim(),
        password: $("password").value,
        invite_code: $("inviteCode").value,
      }),
    });
    showApp(data.user);
  } catch (error) {
    $("authError").textContent = error.message;
    $("authError").classList.remove("hidden");
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  showAuth();
});

const dropzone = $("teamDropzone");
dropzone.addEventListener("click", () => $("dataFile").click());
dropzone.addEventListener("dragover", (event) => event.preventDefault());
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  if (event.dataTransfer.files[0]) setDataFile(event.dataTransfer.files[0]);
});
$("dataFile").addEventListener("change", () => {
  if ($("dataFile").files[0]) setDataFile($("dataFile").files[0]);
});

function setDataFile(file) {
  state.selectedFile = file;
  $("dataFileName").textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  if (!$("jobTitle").value) $("jobTitle").value = file.name.replace(/\.[^.]+$/, "");
}

$("uploadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selectedFile) {
    showMessage("请先选择 CSV 或 EDF 文件。", true);
    return;
  }
  const form = new FormData();
  form.append("file", state.selectedFile);
  if ($("annotationFile").files[0]) form.append("annotations", $("annotationFile").files[0]);
  form.append("title", $("jobTitle").value);
  Object.entries(configFromForm()).forEach(([key, value]) => form.append(key, String(value)));
  $("uploadBtn").disabled = true;
  showMessage("正在上传并创建任务…");
  try {
    const data = await api("/api/jobs/upload", { method: "POST", body: form });
    showMessage(`任务已进入队列：${data.job.id}`);
    state.selectedFile = null;
    $("dataFile").value = "";
    $("dataFileName").textContent = "CSV 或 EDF，默认上限 200 MB";
    loadJobs();
  } catch (error) {
    showMessage(`提交失败：${error.message}`, true);
  } finally {
    $("uploadBtn").disabled = false;
  }
});

$("demoBtn").addEventListener("click", async () => {
  try {
    showMessage("正在创建团队演示任务…");
    const data = await api("/api/jobs/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "团队演示 · Research 后端", config: configFromForm() }),
    });
    showMessage(`演示任务已提交：${data.job.id}`);
    loadJobs();
  } catch (error) {
    showMessage(`创建失败：${error.message}`, true);
  }
});

$("refreshBtn").addEventListener("click", loadJobs);
$("closeDialog").addEventListener("click", () => $("jobDialog").close());
$("jobDialog").addEventListener("click", (event) => {
  if (event.target === $("jobDialog")) $("jobDialog").close();
});

async function boot() {
  setAuthMode("login");
  try {
    const data = await api("/api/me");
    showApp(data.user);
  } catch {
    showAuth();
  }
}

boot();
