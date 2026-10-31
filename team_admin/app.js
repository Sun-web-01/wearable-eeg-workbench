const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  autoRefresh: true,
  refreshTimer: null,
  latest: null,
};

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (days) return `${days}天 ${hours}小时`;
  if (hours) return `${hours}小时 ${minutes}分`;
  return `${minutes}分钟`;
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function statusMeta(status) {
  return {
    completed: ["已完成", "completed"],
    processing: ["处理中", "processing"],
    queued: ["排队中", "queued"],
    failed: ["失败", "failed"],
    starting: ["准备中", "starting"],
    connecting: ["连接中", "connecting"],
    recording: ["采集中", "recording"],
    stopping: ["保存中", "stopping"],
  }[status] || [status || "未知", "queued"];
}

function badge(status, type = "status-badge") {
  const [label, css] = statusMeta(status);
  return `<span class="${type} ${css}"><i></i>${escapeHtml(label)}</span>`;
}

function applyTheme(theme, persist = true) {
  const normalised = theme === "dark" ? "dark" : "light";
  const dark = normalised === "dark";
  document.documentElement.dataset.theme = normalised;
  $("themeToggle").setAttribute("aria-pressed", String(dark));
  $("themeLabel").textContent = dark ? "浅色模式" : "深色模式";
  if (persist) {
    try {
      localStorage.setItem("neuroteam:theme", normalised);
    } catch {
      // Theme remains active for the current page.
    }
  }
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

function setAutoRefresh(enabled) {
  state.autoRefresh = enabled;
  clearInterval(state.refreshTimer);
  if (enabled && state.user) {
    state.refreshTimer = setInterval(loadOverview, 15000);
  }
  $("syncToggle").classList.toggle("on", enabled);
  $("syncToggle").setAttribute("aria-pressed", String(enabled));
  $("syncToggle").querySelector("span").textContent = enabled ? "自动刷新" : "已暂停刷新";
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(data?.detail || data?.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function showLogin(message = "") {
  state.user = null;
  clearInterval(state.refreshTimer);
  $("dashboard").classList.add("hidden");
  $("deniedPanel").classList.add("hidden");
  $("loginPanel").classList.remove("hidden");
  $("loginError").classList.toggle("hidden", !message);
  $("loginError").textContent = message;
}

function showDenied(user, message = "") {
  state.user = user;
  clearInterval(state.refreshTimer);
  $("dashboard").classList.add("hidden");
  $("loginPanel").classList.add("hidden");
  $("deniedPanel").classList.remove("hidden");
  $("deniedMessage").textContent =
    message || `当前账户“${user?.username || "未知"}”没有管理员权限，请返回成员前端。`;
}

function showDashboard(user) {
  state.user = user;
  $("loginPanel").classList.add("hidden");
  $("deniedPanel").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
  setAutoRefresh(state.autoRefresh);
  void loadOverview();
}

function renderUsers(users) {
  $("userCount").textContent = `${users.length} 个账户`;
  $("usersBody").innerHTML = users.length
    ? users.map((user) => `
      <tr>
        <td><span class="cell-main">${escapeHtml(user.username)}</span><span class="cell-sub">ID ${escapeHtml(user.id)}</span></td>
        <td><span class="role-badge ${user.role === "admin" ? "admin" : "member"}">${user.role === "admin" ? "管理员" : "成员"}</span></td>
        <td>${Number(user.job_count || 0)}</td>
        <td>${escapeHtml(formatDateTime(user.created_at))}</td>
      </tr>`).join("")
    : '<tr class="empty-row"><td colspan="4">暂无账户</td></tr>';
}

function renderJobs(jobs) {
  $("jobCount").textContent = `${jobs.length} 条`;
  $("jobsBody").innerHTML = jobs.length
    ? jobs.map((job) => `
      <tr>
        <td><span class="cell-main">${escapeHtml(job.title)}</span><span class="cell-sub">${escapeHtml(job.input_name || job.mode)}</span></td>
        <td>${escapeHtml(job.owner_name)}</td>
        <td>${badge(job.status)}</td>
        <td>${job.quality_grade ? `${escapeHtml(job.quality_grade)} / ${Number(job.quality_score || 0).toFixed(1)}` : "—"}</td>
        <td>${escapeHtml(formatDateTime(job.created_at))}</td>
        <td>${job.has_report ? `<a class="report-link" href="/api/jobs/${encodeURIComponent(job.id)}/view" target="_blank" rel="noreferrer">打开</a>` : "—"}</td>
      </tr>`).join("")
    : '<tr class="empty-row"><td colspan="6">暂无处理任务</td></tr>';
}

function renderAcquisitions(sessions) {
  $("acquisitionCount").textContent = `${sessions.length} 条`;
  $("acquisitionsBody").innerHTML = sessions.length
    ? sessions.map((session) => `
      <tr>
        <td><span class="cell-main">${escapeHtml(session.subject_id || "未命名")} / ${escapeHtml(session.task || "未标记")}</span><span class="cell-sub">${escapeHtml(session.id)}</span></td>
        <td>${escapeHtml(session.profile_label || session.profile_id || "—")}</td>
        <td>${escapeHtml(session.owner_name || "—")}</td>
        <td>${session.sample_rate_hz ? `${Number(session.sample_rate_hz)} Hz` : "—"}</td>
        <td>${badge(session.status)}</td>
        <td>${escapeHtml(formatDateTime(session.created_at))}</td>
      </tr>`).join("")
    : '<tr class="empty-row"><td colspan="6">暂无采集记录</td></tr>';
}

function renderOverview(data) {
  state.latest = data;
  const { service, stats, users, recent_jobs: jobs, recent_acquisitions: sessions } = data;
  $("serviceState").textContent = service.status === "ok" ? "后端服务运行正常" : "后端服务状态异常";
  $("healthOrb").classList.toggle("offline", service.status !== "ok");
  $("serviceSummary").textContent =
    "管理端已完成独立加载；成员前端与管理员数据读取使用同一套会话认证，但管理接口只允许管理员角色。";
  $("serviceVersion").textContent = `v${service.version}`;
  $("serviceUptime").textContent = formatDuration(service.uptime_seconds);
  $("lastUpdated").textContent = formatDateTime(data.generated_at);

  $("metricUsers").textContent = stats.users;
  $("metricJobs").textContent = stats.jobs;
  $("metricProcessing").textContent = stats.jobs_processing;
  $("metricAcquisitions").textContent = stats.acquisitions;
  $("metricActiveAcq").textContent = stats.acquisitions_active;
  $("metricStorage").textContent = formatBytes(stats.storage_bytes);
  $("metricStorageFiles").textContent = `${stats.storage_files} 个文件`;

  $("runtimeApi").textContent = service.status === "ok" ? "ONLINE" : "OFFLINE";
  $("runtimeWorkers").textContent = `${service.workers} 线程`;
  $("runtimeCompleted").textContent = `${stats.jobs_completed} / ${stats.jobs}`;
  $("runtimeFailed").textContent = String(stats.jobs_failed);
  $("runtimeAdmins").textContent = String(stats.admins);
  $("runtimeStorage").textContent = formatBytes(stats.storage_bytes);

  renderUsers(users);
  renderJobs(jobs);
  renderAcquisitions(sessions);
}

async function loadOverview() {
  if (!state.user || state.user.role !== "admin") return;
  try {
    const data = await api("/api/admin/overview");
    renderOverview(data);
  } catch (error) {
    if (error.status === 401) return showLogin("登录状态已失效，请重新登录。");
    if (error.status === 403) return showDenied(state.user, error.message);
    $("serviceState").textContent = "管理数据读取失败";
    $("healthOrb").classList.add("offline");
    $("serviceSummary").textContent = error.message;
  }
}

async function boot() {
  applyTheme(document.documentElement.dataset.theme || "light", false);
  try {
    const data = await api("/api/me");
    if (data.user.role === "admin") showDashboard(data.user);
    else showDenied(data.user);
  } catch {
    showLogin();
  }
}

$("themeToggle").addEventListener("click", toggleTheme);
$("syncToggle").addEventListener("click", () => {
  setAutoRefresh(!state.autoRefresh);
  if (state.autoRefresh) void loadOverview();
});

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("loginError").classList.add("hidden");
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = "正在验证…";
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: $("loginUsername").value.trim(),
        password: $("loginPassword").value,
      }),
    });
    $("loginPassword").value = "";
    if (data.user.role === "admin") showDashboard(data.user);
    else showDenied(data.user);
  } catch (error) {
    $("loginError").textContent = error.message;
    $("loginError").classList.remove("hidden");
  } finally {
    submit.disabled = false;
    submit.textContent = "进入管理端";
  }
});

$("logoutButton").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } finally {
    showLogin();
  }
});

$("switchAccountButton").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } finally {
    showLogin();
  }
});

document.querySelectorAll(".admin-nav a").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".admin-nav a").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
});

boot();
