const $ = (id) => document.getElementById(id);
const customSelects = new Map();

const state = {
  user: null,
  authMode: "login",
  jobs: [],
  selectedFile: null,
  pollTimer: null,
  autoSync: true,
  validationToken: 0,
  trustMode: "trace",
  trustJobId: null,
  deviceProfiles: [],
  acquisitionRecords: [],
  activeAcquisitionId: null,
  acquisitionPollTimer: null,
  jobSelection: new Set(),
  jobSelectionAnchor: null,
  acquisitionSelection: new Set(),
  acquisitionSelectionAnchor: null,
  deleteRequest: null,
  jobDialogId: null,
};

function closeAllCustomSelects(except = null) {
  customSelects.forEach((control, selectId) => {
    if (selectId !== except) {
      control.wrapper.classList.remove("open");
      control.menu.classList.add("hidden");
      control.trigger.setAttribute("aria-expanded", "false");
    }
  });
}

function refreshCustomSelect(selectOrId) {
  const select = typeof selectOrId === "string" ? $(selectOrId) : selectOrId;
  const control = select ? customSelects.get(select.id) : null;
  if (!control) return;
  const { wrapper, trigger, value, menu } = control;
  const selected = select.selectedOptions[0];
  value.textContent = selected?.textContent || "请选择";
  trigger.disabled = select.disabled;
  wrapper.classList.toggle("disabled", select.disabled);
  menu.innerHTML = Array.from(select.options).map((option, index) => `
    <button class="custom-option ${option.selected ? "selected" : ""}" type="button" role="option"
      aria-selected="${option.selected}" data-value="${escapeHtml(option.value)}" ${option.disabled ? "disabled" : ""}>
      <span class="custom-option-index">${String(index + 1).padStart(2, "0")}</span>
      <span class="custom-option-label">${escapeHtml(option.textContent)}</span>
      <span class="custom-option-check">${option.selected ? "✓" : ""}</span>
    </button>`).join("");
  menu.querySelectorAll(".custom-option").forEach((optionButton) => {
    optionButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      select.value = optionButton.dataset.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      refreshCustomSelect(select);
      control.wrapper.classList.remove("open");
      control.menu.classList.add("hidden");
      control.trigger.setAttribute("aria-expanded", "false");
      control.trigger.focus();
    });
  });
}

function initializeCustomSelects() {
  document.querySelectorAll("select[data-custom-select]").forEach((select, selectIndex) => {
    if (customSelects.has(select.id)) return;
    const wrapper = document.createElement("div");
    wrapper.className = "custom-select";
    wrapper.dataset.selectId = select.id;
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "custom-select-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", `${select.id}Menu`);
    const fieldLabel = select.closest("label")?.querySelector(".field-label")?.childNodes[0]?.textContent?.trim();
    trigger.setAttribute("aria-label", fieldLabel || select.id);
    trigger.innerHTML = `
      <span class="custom-select-leading">${escapeHtml(select.dataset.selectCode || String(selectIndex + 1).padStart(2, "0"))}</span>
      <span class="custom-select-value"></span>
      <i class="custom-select-chevron" aria-hidden="true"></i>`;
    const menu = document.createElement("div");
    menu.id = `${select.id}Menu`;
    menu.className = "custom-select-menu hidden";
    menu.setAttribute("role", "listbox");
    wrapper.append(trigger, menu);
    select.insertAdjacentElement("afterend", wrapper);
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    const control = { select, wrapper, trigger, menu, value: trigger.querySelector(".custom-select-value") };
    customSelects.set(select.id, control);

    const open = () => {
      if (trigger.disabled) return;
      closeAllCustomSelects(select.id);
      wrapper.classList.add("open");
      menu.classList.remove("hidden");
      trigger.setAttribute("aria-expanded", "true");
      const selectedOption = menu.querySelector(".custom-option.selected") || menu.querySelector(".custom-option");
      selectedOption?.focus();
    };
    const close = () => {
      wrapper.classList.remove("open");
      menu.classList.add("hidden");
      trigger.setAttribute("aria-expanded", "false");
    };
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (wrapper.classList.contains("open")) close();
      else open();
    });
    trigger.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        open();
      } else if (event.key === "Escape") {
        close();
      }
    });
    menu.addEventListener("keydown", (event) => {
      const options = [...menu.querySelectorAll(".custom-option:not(:disabled)")];
      const current = document.activeElement;
      const index = options.indexOf(current);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        options[Math.min(options.length - 1, index + 1)]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        options[Math.max(0, index - 1)]?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
        trigger.focus();
      } else if (event.key === "Tab") {
        close();
      }
    });
    refreshCustomSelect(select);
  });
}

document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".custom-select")) closeAllCustomSelects();
});

function applyTheme(theme, persist = true) {
  const normalised = theme === "dark" ? "dark" : "light";
  const dark = normalised === "dark";
  document.documentElement.dataset.theme = normalised;
  const button = $("themeToggle");
  if (!button) return;
  button.setAttribute("aria-pressed", String(dark));
  button.setAttribute("aria-label", dark ? "切换到浅色模式" : "切换到深色模式");
  button.title = dark ? "切换到浅色模式" : "切换到深色模式";
  $("themeLabel").textContent = dark ? "浅色模式" : "深色模式";
  if (persist) {
    try {
      localStorage.setItem("neuroteam:theme", normalised);
    } catch {
      // Theme still applies for the current page.
    }
  }
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

function runBootSequence() {
  const overlay = $("bootOverlay");
  if (!overlay) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let played = false;
  try {
    played = sessionStorage.getItem("neuroteam:booted") === "1";
  } catch {
    played = false;
  }
  if (played || reducedMotion) {
    overlay.remove();
    return;
  }

  document.body.classList.add("boot-active");
  const statuses = [
    "建立安全会话",
    "校验 EEG / IMU 通道",
    "加载信号质量规则",
    "准备团队工作区",
  ];
  let statusIndex = 0;
  let finished = false;
  const statusTimer = setInterval(() => {
    statusIndex = Math.min(statusIndex + 1, statuses.length - 1);
    $("bootStatus").textContent = statuses[statusIndex];
  }, 560);

  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(statusTimer);
    document.body.classList.remove("boot-active");
    overlay.classList.add("done");
    try {
      sessionStorage.setItem("neuroteam:booted", "1");
    } catch {
      // Continue without persistence when storage is unavailable.
    }
    setTimeout(() => overlay.remove(), 780);
  };

  overlay.addEventListener("click", finish, { once: true });
  setTimeout(finish, 3300);
}

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
  $("authHeading").textContent = mode === "login" ? "登录团队工作台" : "加入团队工作台";
  $("authDescription").textContent = mode === "login"
    ? "进入后可查看共享任务、提交数据并复核处理报告。"
    : "使用团队邀请码创建个人账户，之后即可查看团队数据和实验记录。";
  $("passwordHint").textContent = mode === "login" ? "请输入账户密码" : "至少 8 位";
  $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("authError").classList.add("hidden");
  $("authError").textContent = "";
}

function showAuth() {
  state.user = null;
  clearInterval(state.pollTimer);
  clearInterval(state.acquisitionPollTimer);
  $("appShell").classList.add("hidden");
  $("authShell").classList.remove("hidden");
  $("password").value = "";
}

function userInitial(name) {
  const value = String(name || "").trim();
  if (!value) return "?";
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const segments = new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(value);
    return segments[Symbol.iterator]().next().value?.segment?.toUpperCase() || "?";
  }
  return Array.from(value)[0]?.toUpperCase() || "?";
}

function showApp(user) {
  state.user = user;
  $("authShell").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  $("currentUser").textContent = user.username;
  $("avatar").textContent = userInitial(user.username);
  $("adminEntry").classList.toggle("hidden", user.role !== "admin");
  setView("jobs");
  loadJobs();
  applyAutoSync(state.autoSync);
}

function updateAccountHeader(user) {
  state.user = user;
  $("currentUser").textContent = user.username;
  $("avatar").textContent = userInitial(user.username);
  $("adminEntry").classList.toggle("hidden", user.role !== "admin");
}

function showAccountMessage(message, error = false) {
  const element = $("accountMessage");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.remove("hidden");
}

function openAccountDialog() {
  if (!state.user) return;
  $("accountUsername").value = state.user.username;
  $("accountCurrentPassword").value = "";
  $("accountNewPassword").value = "";
  $("accountConfirmPassword").value = "";
  $("accountMessage").classList.add("hidden");
  $("accountDialog").showModal();
  $("accountCurrentPassword").focus();
}

function readAutoSyncPreference() {
  try {
    return localStorage.getItem("neuroteam:auto-sync") !== "off";
  } catch {
    return true;
  }
}

function applyAutoSync(enabled) {
  state.autoSync = enabled;
  clearInterval(state.pollTimer);
  if (enabled && state.user) {
    state.pollTimer = setInterval(loadJobs, 3500);
  }
  const toggle = $("syncToggle");
  toggle.classList.toggle("on", enabled);
  toggle.classList.toggle("off", !enabled);
  toggle.setAttribute("aria-pressed", String(enabled));
  toggle.querySelector("span").textContent = enabled ? "自动同步" : "自动同步已关闭";
  toggle.title = enabled ? "点击关闭任务自动刷新" : "点击开启任务自动刷新";
  try {
    localStorage.setItem("neuroteam:auto-sync", enabled ? "on" : "off");
  } catch {
    // Browser privacy settings may disable storage.
  }
}

function showMessage(message, error = false) {
  const element = $("uploadMessage");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.toggle("loading", !error && /正在|上传中/.test(message));
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
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status) {
  return {
    starting: "准备中",
    connecting: "连接中",
    recording: "采集中",
    stopping: "保存中",
    queued: "排队中",
    processing: "处理中",
    completed: "已完成",
    failed: "失败",
  }[status] || status;
}

function backendLabel(backend) {
  return backend === "research" ? "正式科研" : "快速预览";
}

function qualityLabel(grade) {
  return {
    A: "较可靠",
    B: "可用，建议复核",
    C: "偏低，需要复核",
    D: "需重新处理",
  }[grade] || "待评估";
}

function animateMetric(id, value) {
  const element = $(id);
  const target = Number(value) || 0;
  const current = Number(element.textContent) || 0;
  if (current === target) return;
  const started = performance.now();
  const duration = 320;
  const draw = (now) => {
    const progress = Math.min((now - started) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = Math.round(current + (target - current) * eased);
    if (progress < 1) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

function isJobDeletable(job) {
  return !["queued", "processing"].includes(job.status);
}

function isAcquisitionDeletable(session) {
  return !["starting", "connecting", "recording", "stopping"].includes(session.status);
}

function applyRangeSelection(selection, orderedIds, itemId, shiftKey, anchorId, shouldSelect) {
  const anchorIndex = orderedIds.indexOf(anchorId);
  const itemIndex = orderedIds.indexOf(itemId);
  if (shiftKey && anchorIndex >= 0 && itemIndex >= 0) {
    const start = Math.min(anchorIndex, itemIndex);
    const end = Math.max(anchorIndex, itemIndex);
    orderedIds.slice(start, end + 1).forEach((id) => {
      if (shouldSelect) selection.add(id);
      else selection.delete(id);
    });
    return anchorId;
  }
  if (shouldSelect) selection.add(itemId);
  else selection.delete(itemId);
  return itemId;
}

function pruneSelection(selection, eligibleIds) {
  const allowed = new Set(eligibleIds);
  Array.from(selection).forEach((id) => {
    if (!allowed.has(id)) selection.delete(id);
  });
}

function syncJobSelection() {
  const eligible = state.jobs.filter(isJobDeletable);
  const eligibleIds = new Set(eligible.map((job) => job.id));
  pruneSelection(state.jobSelection, eligibleIds);
  if (!eligibleIds.has(state.jobSelectionAnchor)) state.jobSelectionAnchor = null;
  document.querySelectorAll("[data-job-check]").forEach((checkbox) => {
    const checked = state.jobSelection.has(checkbox.dataset.jobCheck);
    checkbox.checked = checked;
    checkbox.closest("tr")?.classList.toggle("selected-row", checked);
  });
  const count = state.jobSelection.size;
  const selectedAll = eligible.length > 0 && count === eligible.length;
  const selectAll = $("jobsSelectAll");
  selectAll.disabled = eligible.length === 0;
  selectAll.checked = selectedAll;
  selectAll.indeterminate = count > 0 && !selectedAll;
  $("jobsSelectionCount").textContent = count ? `已选 ${count} 条任务` : "未选择任务";
  $("clearJobSelection").disabled = count === 0;
  $("deleteSelectedJobs").disabled = count === 0;
}

function syncAcquisitionSelection() {
  const eligible = state.acquisitionRecords.filter(isAcquisitionDeletable);
  const eligibleIds = new Set(eligible.map((session) => session.id));
  pruneSelection(state.acquisitionSelection, eligibleIds);
  if (!eligibleIds.has(state.acquisitionSelectionAnchor)) state.acquisitionSelectionAnchor = null;
  document.querySelectorAll("[data-acquisition-check]").forEach((checkbox) => {
    const checked = state.acquisitionSelection.has(checkbox.dataset.acquisitionCheck);
    checkbox.checked = checked;
    checkbox.closest("tr")?.classList.toggle("selected-row", checked);
  });
  const count = state.acquisitionSelection.size;
  const selectedAll = eligible.length > 0 && count === eligible.length;
  const selectAll = $("acquisitionsSelectAll");
  selectAll.disabled = eligible.length === 0;
  selectAll.checked = selectedAll;
  selectAll.indeterminate = count > 0 && !selectedAll;
  $("acquisitionsSelectionCount").textContent = count ? `已选 ${count} 条采集` : "未选择采集";
  $("clearAcquisitionSelection").disabled = count === 0;
  $("deleteSelectedAcquisitions").disabled = count === 0;
}

function renderJobs(data) {
  state.jobs = data.jobs;
  pruneSelection(state.jobSelection, data.jobs.filter(isJobDeletable).map((job) => job.id));
  animateMetric("statTotal", data.stats.total);
  animateMetric("statCompleted", data.stats.completed);
  animateMetric("statProcessing", data.stats.processing);
  animateMetric("statFailed", data.stats.failed);

  if (!data.jobs.length) {
    $("jobsBody").innerHTML = '<tr><td colspan="9" class="empty">还没有任务。上传数据或创建一个演示任务。</td></tr>';
    syncJobSelection();
    return;
  }

  $("jobsBody").innerHTML = data.jobs.map((job) => {
    const deletable = isJobDeletable(job);
    return `
    <tr data-job-row="${escapeHtml(job.id)}">
      <td class="select-cell"><input class="record-check" type="checkbox" data-job-check="${escapeHtml(job.id)}"
        aria-label="选择任务 ${escapeHtml(job.title)}" ${deletable ? "" : 'disabled title="任务处理中，暂不可删除"'}></td>
      <td>
        <span class="task-name">${escapeHtml(job.title)}</span>
        <span class="subline">${escapeHtml(job.input_name || "系统演示数据")}</span>
      </td>
      <td>${escapeHtml(job.owner_name)}</td>
      <td>${escapeHtml(job.input_name || "系统演示数据")}</td>
      <td>${backendLabel(job.backend)}</td>
      <td><span class="badge ${job.status}">${statusLabel(job.status)}</span></td>
      <td>${job.quality_grade
        ? `<span class="badge ${job.quality_grade}" title="${qualityLabel(job.quality_grade)}">${job.quality_grade} · ${Number(job.quality_score).toFixed(1)}</span>`
        : "—"}</td>
      <td>${formatTime(job.created_at)}</td>
      <td><div class="row-actions">
        <button class="link-button" data-job-id="${escapeHtml(job.id)}">详情</button>
        <button class="link-button destructive" data-delete-job="${escapeHtml(job.id)}" ${deletable ? "" : "disabled"}>删除</button>
      </div></td>
    </tr>`;
  }).join("");

  document.querySelectorAll("[data-job-id]").forEach((button) => {
    button.addEventListener("click", () => openJob(button.dataset.jobId));
  });
  document.querySelectorAll("[data-job-check]").forEach((checkbox) => {
    checkbox.addEventListener("click", (event) => {
      if (checkbox.disabled) return;
      const orderedIds = state.jobs.filter(isJobDeletable).map((job) => job.id);
      state.jobSelectionAnchor = applyRangeSelection(
        state.jobSelection,
        orderedIds,
        checkbox.dataset.jobCheck,
        event.shiftKey,
        state.jobSelectionAnchor,
        checkbox.checked,
      );
      syncJobSelection();
    });
  });
  document.querySelectorAll("[data-delete-job]").forEach((button) => {
    button.addEventListener("click", () => requestRecordDeletion("jobs", [button.dataset.deleteJob]));
  });
  syncJobSelection();
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

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRatio(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : "—";
}

function formatSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number < 1 ? `${(number * 1000).toFixed(1)} ms` : `${number.toFixed(2)} s`;
}

function scoreNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : "—";
}

function qualityDescription(grade) {
  return {
    A: "整体信号较稳定，可进入后续特征提取与模型对照；仍建议结合通道和运动伪迹明细检查。",
    B: "数据总体可用，但存在需要人工确认的片段。建议先复核异常窗口，再进入模型训练。",
    C: "信号质量偏低，可能有较多噪声、缺口或运动伪迹。建议调整采集或处理参数后重试。",
    D: "当前数据不适合直接进入模型，请检查通道、时间轴、采样率和运动伪迹后重新处理。",
  }[grade] || "报告尚未生成或质量等级不可用。";
}

function sourceFormatLabel(value) {
  return {
    synthetic: "系统合成演示数据",
    csv: "CSV 表格数据",
    edf: "EDF 生理信号",
  }[String(value || "").toLowerCase()] || value || "已上传文件";
}

function downloadFileName(job, label, extension) {
  let base = String(job.title || "EEG任务")
    .replace(/\.(csv|edf)$/i, "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/^[ ._]+|[ ._]+$/g, "")
    .slice(0, 80) || "EEG任务";
  const date = String(job.created_at || "").slice(0, 10) || "未注明日期";
  return `${base}_${date}_${String(job.id).slice(0, 6)}_${label}.${extension}`;
}

async function openJob(jobId) {
  const dialog = $("jobDialog");
  state.jobDialogId = jobId;
  $("dialogTitle").textContent = "正在读取任务…";
  $("dialogContent").innerHTML = "";
  dialog.showModal();
  try {
    const data = await api(`/api/jobs/${jobId}`);
    const job = data.job;
    let report = null;
    if (job.has_report && job.status === "completed") {
      try {
        report = await api(`/api/jobs/${job.id}/report`);
      } catch {
        report = null;
      }
    }

    $("dialogTitle").textContent = job.title;
    const overview = report?.overview || {};
    const alignment = report?.alignment?.processed || report?.alignment || {};
    const overall = report?.quality?.overall || {};
    const motion = report?.quality?.motion || {};
    const epochs = report?.epochs || {};
    const dataOrigin = report?.data_origin || {};
    const config = job.config || {};
    const channels = Array.isArray(report?.quality?.channels) ? report.quality.channels : [];
    const issues = Array.isArray(overall.issues) ? overall.issues : [];
    const grade = job.quality_grade || overall.grade || "—";
    const scoreValue = Number(overall.score ?? job.quality_score);
    const score = Number.isFinite(scoreValue) ? Math.max(0, Math.min(100, scoreValue)) : 0;
    const eegChannels = Array.isArray(overview.eeg_channels) ? overview.eeg_channels : [];
    const imuChannels = Array.isArray(overview.imu_channels) ? overview.imu_channels : [];
    const keptWindows = Number(epochs.kept_windows ?? 0);
    const totalWindows = Number(epochs.total_windows ?? 0);
    const artifactRatio = overall.motion_artifact_ratio ?? motion.artifact_ratio;
    const completed = job.status === "completed" && report;
    const sourceFormat = sourceFormatLabel(
      overview.source_format || report?.source?.format || (job.mode === "demo" ? "synthetic" : "已上传文件"),
    );
    const reportLink = completed
      ? `<a class="ghost small" href="/api/jobs/${job.id}/view" target="_blank" rel="noreferrer">在线查看质量报告</a>`
      : "";
    const demoNotice = job.mode === "demo" || dataOrigin.kind === "synthetic" ? `
      <div class="demo-data-notice">
        <span class="demo-data-tag">系统演示数据</span>
        <div>
          <strong>程序合成，不对应真实受试者</strong>
          <p>${escapeHtml(dataOrigin.summary || "由平台内置程序生成 90 秒、128 Hz、2 路 EEG 和 3 轴 IMU 测试信号，并加入三次模拟头动。")}
          ${escapeHtml(dataOrigin.purpose || "仅用于验证读取、滤波、质量检查和报告流程，不能用于真实脑状态或模型效果判断。")}</p>
        </div>
      </div>` : "";
    const reportGuide = completed ? `
      <div class="report-guide">
        <div><b>01 · 总评</b><span>先看 A–D 质量和主要问题。</span></div>
        <div><b>02 · 伪迹</b><span>再看 IMU 判断出的头动比例。</span></div>
        <div><b>03 · 通道</b><span>检查平直、削顶和高频噪声。</span></div>
        <div><b>04 · 窗口</b><span>确认有多少片段能进入模型。</span></div>
      </div>` : "";
    const channelRows = channels.map((channel) => `
      <tr>
        <td><span class="task-name">${escapeHtml(channel.channel)}</span></td>
        <td>${formatRatio(channel.valid_ratio)}</td>
        <td>${formatRatio(channel.flat_ratio)}</td>
        <td>${formatRatio(channel.clipping_ratio)}</td>
        <td>${formatRatio(channel.high_frequency_ratio)}</td>
        <td>${Number.isFinite(Number(channel.rms_uv)) ? `${Number(channel.rms_uv).toFixed(2)} μV` : "—"}</td>
        <td><span class="badge ${escapeHtml(channel.grade || "")}">${escapeHtml(channel.grade || "—")}</span></td>
      </tr>`).join("");
    const artifacts = [
      ["report.html", "质量报告", "html", "适合在浏览器中阅读和归档"],
      ["report.json", "分析报告", "json", "包含参数与质量结果，适合程序读取"],
      ["features.csv", "窗口特征", "csv", "每个时间窗口的频带功率与质量指标"],
      ["processed.csv", "处理后数据", "csv", "完成滤波、重采样和标记后的信号"],
    ];
    const downloadCards = completed ? artifacts.map(([artifact, label, extension, description]) => {
      const filename = downloadFileName(job, label, extension);
      return `
        <a class="download-card" href="/api/jobs/${job.id}/download/${artifact}" download="${escapeHtml(filename)}">
          <span class="download-format">${extension.toUpperCase()}</span>
          <span class="download-copy"><strong>${label}</strong><small>${escapeHtml(filename)}</small><em>${description}</em></span>
          <b aria-hidden="true">↓</b>
        </a>`;
    }).join("") : "";
    $("dialogContent").innerHTML = `
      <div class="detail-summary">
        <div class="quality-gauge grade-${escapeHtml(grade)}" style="--quality-score:${score}">
          <div><strong>${escapeHtml(grade)}</strong><span>${score ? score.toFixed(1) : "—"}</span><small>质量分</small></div>
        </div>
        <div class="detail-summary-copy">
          <div class="detail-status-line">
            <span class="badge ${job.status}">${statusLabel(job.status)}</span>
            <span class="detail-mode">${backendLabel(job.backend)}</span>
            <span class="detail-id">任务 ${escapeHtml(job.id)}</span>
          </div>
          <h3>${grade === "—" ? "等待质量报告" : `信号质量 ${grade} · ${qualityLabel(grade)}`}</h3>
          <p>${qualityDescription(grade)}</p>
          <div class="detail-inline">
            <span>提交者 ${escapeHtml(job.owner_name)}</span>
            <span>创建于 ${formatDateTime(job.created_at)}</span>
          </div>
        </div>
        ${reportLink}
      </div>

      ${demoNotice}
      ${reportGuide}

      <div class="detail-metric-grid">
        <div><span>数据时长</span><strong>${job.duration_s ? `${Number(job.duration_s).toFixed(1)} 秒` : "—"}</strong><small>连续记录长度，不等于可直接训练的有效样本量</small></div>
        <div><span>目标采样率</span><strong>${Number(overview.processed_sample_rate_hz || config.target_rate_hz || 0).toFixed(0)} Hz</strong><small>每秒保留的数据点；Hz 是采样频率单位</small></div>
        <div><span>通道数量</span><strong>${eegChannels.length} EEG / ${imuChannels.length} IMU</strong><small>EEG 是脑电，IMU 是加速度等运动信号</small></div>
        <div><span>可用窗口</span><strong>${keptWindows} / ${totalWindows}</strong><small>已通过运动门控并成功提取特征的窗口数</small></div>
        <div><span>运动伪迹</span><strong>${formatRatio(artifactRatio)}</strong><small>被 IMU 标记为头动或剧烈运动的采样比例</small></div>
        <div><span>输入规模</span><strong>${Number(overview.input_rows || 0).toLocaleString("zh-CN")}</strong><small>CSV/EDF 展开后参与处理的总采样行数</small></div>
      </div>

      ${job.error ? `<div class="auth-error">${escapeHtml(job.error)}</div>` : ""}

      <div class="detail-section-grid">
        <section class="detail-card">
          <span class="eyebrow">输入与身份</span>
          <h3>数据来源</h3>
          <dl class="detail-list">
            <div><dt>输入文件</dt><dd>${escapeHtml(job.input_name || "系统演示数据")}</dd></div>
            <div><dt>数据格式</dt><dd>${escapeHtml(sourceFormat)}<small>CSV 适合表格时间序列；EDF 更适合正式生理信号记录。</small></dd></div>
            <div><dt>处理完成</dt><dd>${formatDateTime(job.finished_at)}<small>这是本次报告生成前完成质量分析的时间。</small></dd></div>
            <div><dt>文件指纹</dt><dd class="hash-value">${escapeHtml(job.input_sha256 || "未记录")}</dd></div>
          </dl>
          <p class="detail-card-note">${escapeHtml(dataOrigin.summary || "报告结论只对本次输入文件和当前处理参数负责。")}</p>
        </section>

        <section class="detail-card">
          <span class="eyebrow">参数快照</span>
          <h3>处理参数</h3>
          <dl class="detail-list">
            <div><dt>处理模式</dt><dd>${backendLabel(job.backend)}<small>${job.backend === "research" ? "使用 MNE 与 SciPy，适合正式实验。" : "使用基础处理，适合快速检查流程。"}</small></dd></div>
            <div><dt>带通滤波</dt><dd>${config.low_hz ?? "—"}–${config.high_hz ?? "—"} Hz<small>只保留主要脑电频段，减少慢漂移和高频噪声。</small></dd></div>
            <div><dt>工频陷波</dt><dd>${config.notch_hz ? `${config.notch_hz} Hz` : "关闭"}<small>专门压低电网产生的固定频率干扰。</small></dd></div>
            <div><dt>运动阈值</dt><dd>${config.motion_threshold_g ?? "—"} g<small>加速度超过阈值时，该片段可能被标记为运动伪迹。</small></dd></div>
            <div><dt>窗口设置</dt><dd>${config.window_sec ?? "—"} 秒窗 / ${config.step_sec ?? "—"} 秒步长<small>每段分析数据的长度，以及相邻窗口向前移动的时间。</small></dd></div>
          </dl>
        </section>

        <section class="detail-card">
          <span class="eyebrow">时间与完整性</span>
          <h3>对齐检查</h3>
          <dl class="detail-list">
            <div><dt>EEG–IMU 时间轴</dt><dd>${alignment.eeg_imu_common_timebase ? "已对齐" : "未确认"}<small>表示两类信号能按同一时间基准合并分析。</small></dd></div>
            <div><dt>最大时间缺口</dt><dd>${formatSeconds(alignment.max_gap_s)}<small>相邻采样点之间最长的中断时间。</small></dd></div>
            <div><dt>估计缺失比例</dt><dd>${formatRatio(alignment.estimated_missing_ratio)}<small>按理论采样率估算出的遗漏数据比例。</small></dd></div>
            <div><dt>窗口拒绝数</dt><dd>${epochs.rejected_windows ?? "—"}<small>因运动比例过高等原因未进入特征提取的窗口。</small></dd></div>
          </dl>
        </section>

        <section class="detail-card">
          <span class="eyebrow">质量提示</span>
          <h3>需要关注的信号</h3>
          <p class="detail-note">${overall.manual_review_required ? "报告建议人工复核以下内容。" : "未要求强制人工复核，仍建议结合原始波形确认。"}</p>
          <ul class="issue-list">${(issues.length ? issues : ["未报告明显全段质量问题。"]).map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>
        </section>
      </div>

      ${channels.length ? `
        <section class="detail-card channel-section">
          <div class="section-heading"><div><span class="eyebrow">逐通道检查</span><h3>通道质量</h3></div><p>有效比例越高、平坦和削顶比例越低，通常越适合进入建模。</p></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>通道</th><th>有效比例</th><th>平直比例</th><th>削顶比例</th><th>高频噪声</th><th>RMS 幅度</th><th>等级</th></tr></thead>
              <tbody>${channelRows}</tbody>
            </table>
          </div>
          <div class="channel-legend">
            <span>有效比例：非空数据占比</span>
            <span>平直比例：信号长期不变化的程度</span>
            <span>削顶比例：超出记录范围的程度</span>
            <span>高频噪声：可能是肌电或设备干扰</span>
            <span>RMS：同一设备和通道下的整体幅度参考</span>
          </div>
        </section>` : ""}

      ${completed ? `
        <section class="detail-card downloads-section">
          <div class="section-heading"><div><span class="eyebrow">结果交付</span><h3>下载处理结果</h3></div><p>文件名包含任务名称、日期和文件用途，方便直接归档。</p></div>
          <div class="download-grid">${downloadCards}</div>
        </section>` : `<div class="detail-empty">${job.status === "failed" ? "任务失败，暂无结果文件。" : "报告仍在生成，完成后再下载结果。"}</div>`}

      <section class="detail-card timeline-section">
        <span class="eyebrow">过程记录</span>
        <h3>事件时间线</h3>
        <p class="detail-note">按顺序记录文件上传、排队、读取、质量评估和完成状态；失败时会显示原因。</p>
        <div class="detail-timeline">
          ${data.events.map((event, index) => `<div><i>${String(index + 1).padStart(2, "0")}</i><p>${escapeHtml(event.message)}<time>${formatDateTime(event.created_at)}</time></p></div>`).join("")}
        </div>
      </section>

      <section class="detail-card detail-danger-zone">
        <div>
          <span class="eyebrow">记录清理</span>
          <h3>删除这个任务</h3>
          <p>会同时删除数据库记录、上传的原始文件以及本次生成的报告和特征文件。该操作不可撤销。</p>
          ${isJobDeletable(job) ? "" : '<small class="danger-hint">任务仍在排队或处理中，完成后才能删除。</small>'}
        </div>
        <button class="danger-button compact" type="button" data-delete-job-detail="${escapeHtml(job.id)}"
          ${isJobDeletable(job) ? "" : "disabled"}>删除此任务</button>
      </section>`;
    const detailDeleteButton = $("dialogContent").querySelector("[data-delete-job-detail]");
    detailDeleteButton?.addEventListener("click", () => requestRecordDeletion("jobs", [job.id]));
  } catch (error) {
    $("dialogTitle").textContent = "任务读取失败";
    $("dialogContent").innerHTML = `<div class="auth-error">${escapeHtml(error.message)}</div>`;
  }
}

const datasetTaskLabels = {
  sleep_staging: "睡眠分期",
  sleep_staging_multimodal: "多模态睡眠分期",
  sleep_multimodal: "可穿戴睡眠多模态",
  workload_relaxed_vs_task: "认知负荷识别",
  drowsiness_grading: "嗜睡分级",
  motion_artifact_benchmark: "运动伪迹基准",
  eeg_imu_synchronisation: "EEG–IMU 同步",
};

const datasetAccessLabels = {
  open_download: "开放下载",
  restricted_health_data: "受限数据",
  request_from_source: "向来源申请",
  request_from_lab: "向实验室申请",
  verify_from_primary_source: "需核对原始来源",
};

const datasetModalityLabels = {
  EEG: "EEG 脑电",
  EOG: "EOG 眼电",
  EMG: "EMG 肌电",
  ECG: "ECG 心电",
  IMU: "IMU 运动",
  ACC: "ACC 加速度",
  PPG: "PPG 脉搏波",
  EDA: "EDA 皮肤电",
  temperature: "皮肤温度",
  derived_HR: "心率",
  KSS: "KSS 嗜睡评分",
  NASA_TLX_like_scores: "主观负荷评分",
  first_person_video: "第一视角视频",
  wearable_EEG_label_source: "可穿戴 EEG 标签源",
  dry_electrode_EEG: "干电极 EEG",
};

const datasetGuidance = {
  sleep_edf_expanded: "先核对许可和样本清单，再下载单个受试者完成预处理验收。",
  hmc_sleep: "适合在基线稳定后作为异质人群的验证数据。",
  bidsleep: "先下载一名受试者，确认加速度采样率和是否包含原始脑电波形。",
  dreamt: "尽早申请访问权限；原始受限数据不得重新分发。",
  stew: "先确认数据申请方式和许可条款，再开展认知负荷实验。",
  drozy: "先确认嗜睡评分与标签映射，再向实验室申请数据。",
  wearbci: "从论文和原始来源核对下载方式、许可、IMU 通道及采样率。",
  physionet_multimodal_gait: "找到准确的 PhysioNet 页面并记录许可后再下载。",
};

const datasetLicenseLabels = {
  "ODC-BY-1.0": "ODC-BY-1.0（开放数据署名许可）",
  "CC-BY-4.0": "CC BY 4.0（署名许可）",
  "PhysioNet Restricted Health Data License 1.5.0": "PhysioNet 受限数据许可 1.5.0",
  verify_before_use: "使用前核对许可",
};

const datasetChannelLabels = {
  "2 EEG: Fpz-Cz, Pz-Oz": "2 路 EEG：Fpz-Cz、Pz-Oz",
  "4 EEG plus EOG/EMG/ECG": "4 路 EEG + 眼电/肌电/心电",
  "Dreem 2 labels; Apple Watch 3-axis ACC and HR": "Dreem 2 睡眠标签；Apple Watch 三轴加速度与心率",
  "Empatica E4 multi-stream plus PSG-derived sleep labels": "Empatica E4 多路信号 + PSG 派生睡眠标签",
  "14 EEG, Emotiv EPOC layout": "14 路 EEG，Emotiv EPOC 布局",
  "5 EEG": "5 路 EEG",
  "see dataset documentation": "见数据集说明",
  "EEG plus 17 IMUs": "EEG + 17 个 IMU",
};

async function loadDatasets() {
  if (!state.user) return;
  try {
    const data = await api("/api/datasets");
    $("datasetGrid").innerHTML = data.datasets.map((dataset) => {
      const task = datasetTaskLabels[dataset.task] || dataset.task;
      const access = datasetAccessLabels[dataset.access] || dataset.access;
      const guidance = datasetGuidance[dataset.id] || dataset.first_action;
      const priority = dataset.priority === "P0" ? "优先验证" : "备选资源";
      const license = datasetLicenseLabels[dataset.license] || dataset.license;
      const channels = datasetChannelLabels[dataset.channels] || dataset.channels;
      const modalities = (dataset.modalities || [])
        .map((item) => `<span>${escapeHtml(datasetModalityLabels[item] || item)}</span>`)
        .join("");
      return `
        <article class="dataset-card">
          <div class="top">
            <span class="badge ${dataset.priority === "P0" ? "A" : ""}">${escapeHtml(dataset.priority)} · ${priority}</span>
            <span class="badge">${escapeHtml(task)}</span>
          </div>
          <h3>${escapeHtml(dataset.name)}</h3>
          <p>${escapeHtml(guidance)}</p>
          <div class="modality-list">${modalities}</div>
          <div class="dataset-meta">
            <span>通道：${escapeHtml(channels)}</span>
            <span>${dataset.sample_rate_hz ? `${dataset.sample_rate_hz} Hz` : "采样率待确认"}</span>
            <span>${escapeHtml(access)}</span>
            <span>${escapeHtml(license)}</span>
          </div>
          ${dataset.official_url
            ? `<a href="${escapeHtml(dataset.official_url)}" target="_blank" rel="noreferrer">打开官方数据页 ↗</a>`
            : ""}
        </article>`;
    }).join("");
  } catch (error) {
    $("datasetGrid").innerHTML = `<div class="auth-error">${escapeHtml(error.message)}</div>`;
  }
}

function setArchitectureState(elementId, online, label) {
  const element = $(elementId);
  element.classList.remove("online", "offline", "pending");
  element.classList.add(online === null ? "pending" : online ? "online" : "offline");
  element.innerHTML = `<i></i>${escapeHtml(label)}`;
}

async function loadArchitectureStatus() {
  if (!state.user) return;
  setArchitectureState("frontendArchitectureStatus", true, "页面在线");
  setArchitectureState("backendArchitectureStatus", null, "检测中");
  $("architectureVersion").textContent = "检测中";
  $("architectureWorkers").textContent = "检测中";
  $("architectureLatency").textContent = "检测中";
  $("architectureRoundtrip").textContent = "正在检测后端";

  const started = performance.now();
  try {
    const response = await fetch("/api/health", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const latency = Math.max(1, Math.round(performance.now() - started));
    setArchitectureState("backendArchitectureStatus", true, "服务正常");
    $("architectureVersion").textContent = `v${data.version || "未知"}`;
    $("architectureWorkers").textContent = `${Number(data.workers || 0)} 个处理线程`;
    $("architectureLatency").textContent = `${latency} ms`;
    $("architectureRoundtrip").textContent = `API 响应 ${latency} ms`;
  } catch (error) {
    setArchitectureState("backendArchitectureStatus", false, "连接失败");
    $("architectureVersion").textContent = "无法读取";
    $("architectureWorkers").textContent = "无法读取";
    $("architectureLatency").textContent = error.message;
    $("architectureRoundtrip").textContent = "后端未响应";
  }
  $("architectureUpdated").textContent = formatDateTime(new Date().toISOString());
}

const trustModeLabels = {
  trace: ["可追溯", "来源记录"],
  review: ["可复核", "质量复核"],
  reproduce: ["可复现", "复现清单"],
};

function completedJobs() {
  return state.jobs.filter((job) => job.status === "completed");
}

function populateTrustJobs() {
  const jobs = completedJobs();
  const select = $("trustJobSelect");
  select.innerHTML = jobs.length
    ? jobs.map((job) => `<option value="${escapeHtml(job.id)}">${escapeHtml(job.title)} · ${formatTime(job.created_at)}</option>`).join("")
    : "<option>暂无已完成任务</option>";
  select.disabled = jobs.length === 0;
  if (!jobs.some((job) => job.id === state.trustJobId)) {
    state.trustJobId = jobs[0]?.id || null;
  }
  if (state.trustJobId) select.value = state.trustJobId;
  refreshCustomSelect(select);
}

function downloadObjectFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function openTrustDialog(mode) {
  state.trustMode = mode;
  const [title, badge] = trustModeLabels[mode];
  $("trustTitle").textContent = title;
  $("trustModeBadge").textContent = badge;
  populateTrustJobs();
  $("trustDialog").showModal();
  await loadTrustView();
}

async function loadTrustView() {
  const content = $("trustContent");
  if (!state.trustJobId) {
    content.innerHTML = '<div class="trust-empty">还没有已完成任务。运行一个演示任务或上传数据后，这里会提供追溯、复核和复现信息。</div>';
    return;
  }
  content.innerHTML = '<div class="trust-empty">正在读取报告与运行信息…</div>';
  try {
    const jobResponse = await api(`/api/jobs/${state.trustJobId}`);
    const job = jobResponse.job;
    let report = null;
    try {
      report = await api(`/api/jobs/${job.id}/report`);
    } catch {
      report = null;
    }
    const origin = report?.data_origin || {};
    const config = job.config || {};
    const overall = report?.quality?.overall || {};
    const channels = report?.quality?.channels || [];
    const environment = report?.environment || {};
    const manifest = {
      schema_version: "1.0",
      task: {
        id: job.id,
        title: job.title,
        owner_name: job.owner_name,
        status: job.status,
        created_at: job.created_at,
        started_at: job.started_at,
        finished_at: job.finished_at,
        input_name: job.input_name,
        input_sha256: job.input_sha256,
        mode: job.mode,
      },
      data_origin: origin,
      config,
      environment,
      quality: overall,
      method_notes: report?.method_notes || [],
      outputs: ["report.html", "report.json", "features.csv", "processed.csv"],
    };
    const traceActions = `
      <div class="trust-actions">
        <button class="accent" type="button" data-trust-action="download">下载追溯清单 JSON</button>
        <button type="button" data-trust-action="detail">打开任务详情</button>
      </div>`;
    const reviewActions = `
      <div class="trust-actions">
        <a class="accent" href="/api/jobs/${job.id}/view" target="_blank" rel="noreferrer">打开完整质量报告</a>
        <button type="button" data-trust-action="detail">查看任务详情</button>
      </div>`;
    const reproduceActions = `
      <div class="trust-actions">
        <button class="accent" type="button" data-trust-action="download">下载复现清单 JSON</button>
        <button type="button" data-trust-action="detail">查看处理参数</button>
      </div>`;

    if (state.trustMode === "trace") {
      content.innerHTML = `
        <div class="trust-intro"><strong>可追溯：确认这份结果从哪里来</strong>记录输入文件、文件指纹、提交者、处理时间和生成参数。只要文件指纹或参数变化，就不应当作同一次实验。</div>
        <div class="trust-grid">
          <section class="trust-card"><h3>任务与来源</h3><dl class="trust-list">
            <div><dt>任务名称</dt><dd>${escapeHtml(job.title)}</dd></div>
            <div><dt>任务编号</dt><dd>${escapeHtml(job.id)}</dd></div>
            <div><dt>提交者</dt><dd>${escapeHtml(job.owner_name)}</dd></div>
            <div><dt>数据来源</dt><dd>${escapeHtml(origin.label || (job.mode === "demo" ? "系统合成演示数据" : "用户上传文件"))}</dd></div>
            <div><dt>说明</dt><dd>${escapeHtml(origin.summary || "本报告仅对应本次任务输入。")}</dd></div>
          </dl></section>
          <section class="trust-card"><h3>文件与时间</h3><dl class="trust-list">
            <div><dt>输入文件</dt><dd>${escapeHtml(job.input_name || "系统生成数据")}</dd></div>
            <div><dt>创建时间</dt><dd>${formatDateTime(job.created_at)}</dd></div>
            <div><dt>完成时间</dt><dd>${formatDateTime(job.finished_at)}</dd></div>
            <div><dt>SHA-256</dt><dd class="trust-hash">${escapeHtml(job.input_sha256 || "演示任务未使用外部文件")}</dd></div>
          </dl></section>
        </div>
        ${traceActions}`;
    } else if (state.trustMode === "review") {
      const issueItems = (overall.issues || []).map((issue) => `<li>${escapeHtml(issue)}</li>`).join("") || "<li>未报告明显全段问题。</li>";
      const channelRows = channels.map((channel) => `
        <tr><td>${escapeHtml(channel.channel)}</td><td>${formatRatio(channel.valid_ratio)}</td><td>${formatRatio(channel.flat_ratio)}</td><td>${formatRatio(channel.high_frequency_ratio)}</td><td><span class="badge ${escapeHtml(channel.grade || "")}">${escapeHtml(channel.grade || "—")}</span></td></tr>
      `).join("");
      content.innerHTML = `
        <div class="trust-intro"><strong>可复核：确认数据是否值得进入模型</strong>先看质量等级和问题说明，再检查各通道的有效比例、平直段和高频噪声。质量分不是模型准确率。</div>
        <div class="trust-grid">
          <section class="trust-card"><h3>质量结论</h3><dl class="trust-list">
            <div><dt>质量等级</dt><dd>${escapeHtml(overall.grade || job.quality_grade || "—")} · ${escapeHtml(qualityLabel(overall.grade || job.quality_grade))}</dd></div>
            <div><dt>质量分数</dt><dd>${scoreNumber(overall.score ?? job.quality_score)} / 100</dd></div>
            <div><dt>人工复核</dt><dd>${overall.manual_review_required ? "建议复核" : "未强制要求，仍建议抽查"}</dd></div>
            <div><dt>运动伪迹</dt><dd>${formatRatio(overall.motion_artifact_ratio)}</dd></div>
          </dl><ul class="issue-list">${issueItems}</ul></section>
          <section class="trust-card"><h3>通道检查</h3>${channels.length ? `<div class="table-wrap"><table class="trust-channel-table"><thead><tr><th>通道</th><th>有效</th><th>平直</th><th>高频</th><th>等级</th></tr></thead><tbody>${channelRows}</tbody></table></div>` : "<p class=\"trust-review-note\">当前报告没有逐通道明细。</p>"}<p class="trust-review-note">复核建议：查看原始波形、确认电极接触和运动片段，再决定是否重采或调整参数。</p></section>
        </div>
        ${reviewActions}`;
    } else {
      const configRows = [
        ["处理模式", backendLabel(job.backend)],
        ["目标采样率", `${config.target_rate_hz ?? "—"} Hz`],
        ["带通范围", `${config.low_hz ?? "—"}–${config.high_hz ?? "—"} Hz`],
        ["工频陷波", config.notch_hz ? `${config.notch_hz} Hz` : "关闭"],
        ["运动阈值", `${config.motion_threshold_g ?? "—"} g`],
        ["窗口 / 步长", `${config.window_sec ?? "—"} 秒 / ${config.step_sec ?? "—"} 秒`],
      ];
      const envRows = Object.entries(environment).map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value ?? "—")}</dd></div>`).join("");
      content.innerHTML = `
        <div class="trust-intro"><strong>可复现：用同一输入和参数得到同一处理流程</strong>这里汇总数据指纹、处理参数和软件版本。下载清单后，应与报告文件一起保存。</div>
        <div class="trust-grid">
          <section class="trust-card"><h3>处理参数</h3><dl class="trust-list">${configRows.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></section>
          <section class="trust-card"><h3>软件环境</h3><dl class="trust-list">${envRows || "<div><dt>环境版本</dt><dd>报告中尚未记录</dd></div>"}</dl></section>
        </div>
        <section class="trust-card" style="margin-top:9px"><h3>方法说明</h3><ul class="issue-list">${(report?.method_notes || ["尚未生成方法说明。"]).map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul></section>
        ${reproduceActions}`;
    }

    content.querySelectorAll('[data-trust-action="download"]').forEach((button) => {
      button.addEventListener("click", () => {
        const suffix = state.trustMode === "trace" ? "追溯清单" : "复现清单";
        downloadObjectFile(downloadFileName(job, suffix, "json"), manifest);
      });
    });
    content.querySelectorAll('[data-trust-action="detail"]').forEach((button) => {
      button.addEventListener("click", () => {
        $("trustDialog").close();
        void openJob(job.id);
      });
    });
  } catch (error) {
    content.innerHTML = `<div class="auth-error">${escapeHtml(error.message)}</div>`;
  }
}

const acquisitionTaskLabels = {
  state_a: "状态 A（待确定）",
  state_b: "状态 B（待确定）",
  rest: "静息基线",
  focused: "专注",
  relaxed: "放松",
  fatigued: "疲劳",
  sleep: "睡眠",
  other: "其他",
};

const CUSTOM_TRANSPORT_LABELS = {
  serial: "串口 / USB Dongle",
  bluetooth: "蓝牙",
  ip: "网络 IP",
  none: "无需地址",
};

function selectedDeviceProfile() {
  return state.deviceProfiles.find((profile) => profile.id === $("deviceProfile").value) || null;
}

function updateAcquisitionFileName() {
  const profile = selectedDeviceProfile();
  const subject = ($("acquisitionSubject").value || "S01").replace(/[^A-Za-z0-9_-]/g, "").toLowerCase() || "s01";
  const task = $("acquisitionTask").value || "other";
  const customSlug = ($("customDeviceName").value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 32) || "custom";
  const deviceSlug = profile?.id === "custom" ? customSlug : profile?.id;
  $("fileNamePreview").textContent = profile
    ? `sub-${subject}_task-${task}_acq-${deviceSlug}_YYYYMMDD-HHMMSS.csv`
    : "选择设备后生成标准文件名";
}

function updateStartAvailability() {
  const profile = selectedDeviceProfile();
  const needsSimulationAck = profile?.id === "synthetic" && !$("simulationConsent").checked;
  const boardIdText = $("customBoardId").value.trim();
  const customReady = profile?.id !== "custom" || (
    Boolean($("customDeviceName").value.trim())
    && boardIdText !== ""
    && Number.isInteger(Number(boardIdText))
    && Boolean($("customTransport").value)
    && ($("customTransport").value === "none" || Boolean($("deviceAddress").value.trim()))
  );
  $("startAcquisitionBtn").disabled = !profile || needsSimulationAck || !customReady || Boolean(state.activeAcquisitionId);
}

function renderDeviceProfile() {
  const profile = selectedDeviceProfile();
  const customFields = document.querySelectorAll(".custom-device-field");
  const custom = profile?.id === "custom";
  customFields.forEach((field) => field.classList.toggle("hidden", !custom));
  $("customDeviceName").required = custom;
  $("customBoardId").required = custom;
  $("customTransport").required = custom;
  if (!profile) {
    $("deviceAddress").disabled = true;
    $("deviceAddress").placeholder = "请先选择设备类型";
    $("deviceAddressHint").textContent = "选择设备后填写";
    $("deviceProfileInfo").textContent = "请选择上方设备类型，或先扫描已开启的蓝牙/串口设备。";
    $("simulationConsentWrap").classList.add("hidden");
    $("simulationConsent").checked = false;
    updateAcquisitionFileName();
    updateStartAvailability();
    return;
  }
  const addressInput = $("deviceAddress");
  const simulated = profile.id === "synthetic";
  if (custom) {
    const transport = $("customTransport").value;
    const placeholders = {
      serial: "串口，例如 COM3",
      bluetooth: "蓝牙 MAC 地址或设备序列号",
      ip: "设备 IP，例如 192.168.1.20",
      none: "无需地址",
    };
    addressInput.disabled = !transport || transport === "none";
    addressInput.placeholder = placeholders[transport] || "请先选择连接方式";
    $("deviceAddressHint").textContent = transport === "none"
      ? "无需连接地址"
      : (placeholders[transport] || "选择连接方式后填写");
    const name = $("customDeviceName").value.trim() || "待填写设备名称";
    const boardId = $("customBoardId").value.trim() || "待填写";
    $("deviceProfileInfo").innerHTML = `<b>${escapeHtml(name)}</b> · <strong>自定义 BrainFlow 设备</strong> · Board ID ${escapeHtml(boardId)} · ${escapeHtml(transport ? CUSTOM_TRANSPORT_LABELS[transport] : "待选择连接方式")}<br><span>${escapeHtml(profile.description)}</span>`;
  } else {
    addressInput.disabled = !profile.address_field;
    addressInput.placeholder = profile.address_field ? profile.address_label : "模拟设备无需填写";
    $("deviceAddressHint").textContent = profile.address_field ? profile.address_label : "模拟设备无需填写";
    $("deviceProfileInfo").innerHTML = `<b>${escapeHtml(profile.label)}</b>${simulated ? " · <strong>模拟数据，不是真实设备</strong>" : ""} · ${escapeHtml(profile.transport)} · ${profile.sample_rate_hz ?? "—"} Hz · EEG ${profile.eeg_channel_count} 通道 · IMU ${profile.imu_channel_count} 通道<br><span>${escapeHtml(profile.description)}</span>`;
  }
  $("simulationConsentWrap").classList.toggle("hidden", !simulated);
  if (!simulated) $("simulationConsent").checked = false;
  updateAcquisitionFileName();
  updateStartAvailability();
}

function renderScanResults(data) {
  const container = $("deviceScanResults");
  const devices = [...(data.serial_ports || []), ...(data.bluetooth || [])];
  const warnings = data.warnings || [];
  if (!devices.length && !warnings.length) {
    container.innerHTML = "<span>未发现已开启的蓝牙或串口 EEG 设备。请检查设备电源、配对和 USB 接收器。</span>";
    return;
  }
  const items = devices.map((device) => `
    <button class="scan-device ${device.supported ? "" : "unsupported"}" type="button"
      data-device-address="${escapeHtml(device.address)}" data-device-name="${escapeHtml(device.name || device.description || "")}">
      ${escapeHtml(device.name || device.description || device.address)} · ${escapeHtml(device.address)}
    </button>`).join("");
  container.innerHTML = `${items || ""}${warnings.map((warning) => `<span>${escapeHtml(warning)}</span>`).join("")}`;
  container.querySelectorAll("[data-device-address]").forEach((button) => {
    button.addEventListener("click", () => {
      $("deviceAddress").value = button.dataset.deviceAddress;
      const label = button.dataset.deviceName.toLowerCase();
      if ($("deviceProfile").value !== "custom") {
        if (label.includes("muse s")) $("deviceProfile").value = "muse_s";
        else if (label.includes("muse")) $("deviceProfile").value = "muse2";
        else if (label.includes("cyton") || label.includes("openbci")) $("deviceProfile").value = "cyton";
      }
      refreshCustomSelect($("deviceProfile"));
      renderDeviceProfile();
    });
  });
}

async function loadDeviceProfiles() {
  try {
    const data = await api("/api/devices/profiles");
    state.deviceProfiles = data.profiles || [];
    const select = $("deviceProfile");
    const previous = select.value;
    const orderedProfiles = [
      ...state.deviceProfiles.filter((profile) => !["custom", "synthetic"].includes(profile.id)),
      ...state.deviceProfiles.filter((profile) => profile.id === "custom"),
      ...state.deviceProfiles.filter((profile) => profile.id === "synthetic"),
    ];
    select.innerHTML = '<option value="">请选择设备类型</option>' + orderedProfiles.map((profile) =>
      `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.label)} · ${escapeHtml(profile.transport)}${profile.id === "synthetic" ? " · 仅测试" : ""}</option>`
    ).join("");
    if (state.deviceProfiles.some((profile) => profile.id === previous)) select.value = previous;
    refreshCustomSelect(select);
    renderDeviceProfile();
  } catch (error) {
    $("deviceProfileInfo").innerHTML = `<span>${escapeHtml(error.message)}</span>`;
  }
}

async function scanDevices() {
  const button = $("deviceScanBtn");
  button.disabled = true;
  button.textContent = "正在扫描…";
  $("deviceScanResults").innerHTML = "<span>正在检查蓝牙设备和串口，请确保设备已开机并进入配对状态。</span>";
  try {
    renderScanResults(await api("/api/devices/scan"));
  } catch (error) {
    $("deviceScanResults").innerHTML = `<span>扫描失败：${escapeHtml(error.message)}</span>`;
  } finally {
    button.disabled = false;
    button.textContent = "扫描蓝牙与串口";
  }
}

function renderAcquisition(session) {
  const statusMap = {
    starting: ["正在准备", "正在创建采集目录"],
    connecting: ["正在连接", "等待设备建立连接"],
    recording: ["正在采集", "保持设备连接和佩戴状态"],
    stopping: ["正在保存", "停止数据流并生成文件"],
    completed: ["采集完成", "CSV、EDF 和元数据已保存"],
    failed: ["采集失败", session.error || "请检查设备连接"],
  };
  const [title, detail] = statusMap[session.status] || ["等待设备", "选择设备后开始采集"];
  $("acquisitionStatusTitle").textContent = title;
  $("acquisitionStatusDetail").textContent = detail;
  $("acquisitionSeconds").textContent = `${Number(session.captured_seconds || 0).toFixed(1)} s`;
  $("acquisitionSamples").textContent = Number(session.samples || 0).toLocaleString("zh-CN");
  $("acquisitionRate").textContent = session.sample_rate_hz ? `${session.sample_rate_hz} Hz` : "—";
  $("acquisitionSessionId").textContent = session.id || "—";
  const progress = Math.max(0, Math.min(100, Number(session.captured_seconds || 0) / Math.max(1, Number(session.duration_sec || 1)) * 100));
  $("acquisitionProgress").style.width = `${progress}%`;
  const orbit = $("deviceOrbit");
  orbit.className = `device-orbit ${session.status}`;
  const active = ["starting", "connecting", "recording", "stopping"].includes(session.status);
  $("startAcquisitionBtn").disabled = active;
  $("stopAcquisitionBtn").classList.toggle("hidden", !["starting", "connecting", "recording"].includes(session.status));
  state.activeAcquisitionId = active ? session.id : null;
  updateStartAvailability();
}

async function pollAcquisition() {
  if (!state.activeAcquisitionId) return;
  try {
    const data = await api(`/api/acquisitions/${state.activeAcquisitionId}`);
    renderAcquisition(data.session);
    if (!["starting", "connecting", "recording", "stopping"].includes(data.session.status)) {
      clearInterval(state.acquisitionPollTimer);
      state.acquisitionPollTimer = null;
      await loadAcquisitions();
    }
  } catch (error) {
    $("acquisitionStatusTitle").textContent = "状态读取失败";
    $("acquisitionStatusDetail").textContent = error.message;
    clearInterval(state.acquisitionPollTimer);
    state.acquisitionPollTimer = null;
  }
}

function watchAcquisition(session) {
  renderAcquisition(session);
  clearInterval(state.acquisitionPollTimer);
  state.acquisitionPollTimer = setInterval(pollAcquisition, 1000);
}

async function startAcquisition(event) {
  event.preventDefault();
  const profile = selectedDeviceProfile();
  if (!profile) return;
  if (profile.id === "synthetic" && !$("simulationConsent").checked) {
    $("acquisitionMessage").textContent = "请先勾选“我确认这是模拟数据”，再启动模拟采集。";
    $("acquisitionMessage").classList.remove("hidden");
    $("acquisitionMessage").classList.add("error");
    return;
  }
  const button = $("startAcquisitionBtn");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "正在启动…";
  $("acquisitionMessage").classList.remove("error");
  $("acquisitionMessage").classList.add("hidden");
  try {
    const data = await api("/api/acquisitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile_id: profile.id,
        address: $("deviceAddress").value.trim(),
        subject_id: $("acquisitionSubject").value.trim(),
        task: $("acquisitionTask").value,
        duration_sec: Number($("acquisitionDuration").value),
        simulation_ack: profile.id === "synthetic" ? $("simulationConsent").checked : false,
        custom_label: profile.id === "custom" ? $("customDeviceName").value.trim() : null,
        custom_board_id: profile.id === "custom" ? Number($("customBoardId").value) : null,
        custom_transport: profile.id === "custom" ? $("customTransport").value : null,
      }),
    });
    watchAcquisition(data.session);
    $("acquisitionMessage").textContent = `采集已启动：${data.session.csv_name}`;
    $("acquisitionMessage").classList.remove("hidden");
  } catch (error) {
    $("acquisitionMessage").textContent = `启动失败：${error.message}`;
    $("acquisitionMessage").classList.remove("hidden");
    $("acquisitionMessage").classList.add("error");
  } finally {
    button.textContent = original;
    button.disabled = Boolean(state.activeAcquisitionId);
  }
}

async function stopAcquisition() {
  if (!state.activeAcquisitionId) return;
  try {
    const data = await api(`/api/acquisitions/${state.activeAcquisitionId}/stop`, { method: "POST" });
    $("acquisitionMessage").classList.remove("error");
    renderAcquisition(data.session);
  } catch (error) {
    $("acquisitionMessage").classList.remove("error");
    $("acquisitionMessage").textContent = `停止失败：${error.message}`;
    $("acquisitionMessage").classList.remove("hidden");
    $("acquisitionMessage").classList.add("error");
  }
}

async function analyzeAcquisition(sessionId) {
  try {
    const data = await api(`/api/acquisitions/${sessionId}/analyze`, { method: "POST" });
    $("acquisitionMessage").classList.remove("error");
    $("acquisitionMessage").textContent = `已提交分析任务：${data.job.id}`;
    $("acquisitionMessage").classList.remove("hidden");
    await loadAcquisitions();
    loadJobs();
  } catch (error) {
    $("acquisitionMessage").classList.remove("error");
    $("acquisitionMessage").textContent = `提交分析失败：${error.message}`;
    $("acquisitionMessage").classList.remove("hidden");
    $("acquisitionMessage").classList.add("error");
  }
}

async function loadAcquisitions() {
  try {
    const data = await api("/api/acquisitions");
    state.acquisitionRecords = data.sessions;
    pruneSelection(
      state.acquisitionSelection,
      data.sessions.filter(isAcquisitionDeletable).map((session) => session.id),
    );
    if (!data.sessions.length) {
      $("acquisitionBody").innerHTML = '<tr><td colspan="10" class="empty">还没有采集记录。连接设备或使用模拟设备开始第一次采集。</td></tr>';
      syncAcquisitionSelection();
      return;
    }
    $("acquisitionBody").innerHTML = data.sessions.map((session) => {
      const simulated = session.simulated ?? session.profile_id === "synthetic";
      const deletable = isAcquisitionDeletable(session);
      const files = session.status === "completed" ? `
        <div class="file-links">
          <a href="/api/acquisitions/${session.id}/download/csv" download="${escapeHtml(session.csv_name || "")}">CSV</a>
          ${session.edf_name ? `<a href="/api/acquisitions/${session.id}/download/edf" download="${escapeHtml(session.edf_name)}">EDF</a>` : ""}
          <a href="/api/acquisitions/${session.id}/download/metadata" download="${escapeHtml(session.manifest_name || "")}">元数据</a>
        </div>` : "—";
      const analysis = session.status !== "completed"
        ? "—"
        : session.analysis_job_id
          ? `<button class="link-button" data-open-acquisition-job="${escapeHtml(session.analysis_job_id)}">查看分析</button>`
          : `<button class="link-button" data-analyze-acquisition="${escapeHtml(session.id)}">提交分析</button>`;
      return `<tr data-acquisition-row="${escapeHtml(session.id)}">
        <td class="select-cell"><input class="record-check" type="checkbox" data-acquisition-check="${escapeHtml(session.id)}"
          aria-label="选择采集记录 ${escapeHtml(session.csv_name || session.id)}"
          ${deletable ? "" : 'disabled title="采集仍在进行，暂不可删除"'}></td>
        <td>
          <span class="task-name">${escapeHtml(session.csv_name || session.id)}</span>
          <span class="subline">${escapeHtml(session.id)}</span>
          ${simulated ? '<span class="badge simulated">模拟数据</span>' : ""}
        </td>
        <td>${escapeHtml(session.subject_id)} · ${escapeHtml(acquisitionTaskLabels[session.task] || session.task)}</td>
        <td>${escapeHtml(session.profile_label)}</td>
        <td>${Number(session.captured_seconds || 0).toFixed(1)} s</td>
        <td><span class="badge ${escapeHtml(session.status)}">${statusLabel(session.status)}</span></td>
        <td>${formatTime(session.created_at)}</td>
        <td>${files}</td>
        <td><div class="row-actions">
          ${analysis}
          <button class="link-button destructive" data-delete-acquisition="${escapeHtml(session.id)}"
            ${deletable ? "" : "disabled"}>删除</button>
        </div></td>
      </tr>`;
    }).join("");
    document.querySelectorAll("[data-analyze-acquisition]").forEach((button) => {
      button.addEventListener("click", () => void analyzeAcquisition(button.dataset.analyzeAcquisition));
    });
    document.querySelectorAll("[data-open-acquisition-job]").forEach((button) => {
      button.addEventListener("click", () => void openJob(button.dataset.openAcquisitionJob));
    });
    document.querySelectorAll("[data-acquisition-check]").forEach((checkbox) => {
      checkbox.addEventListener("click", (event) => {
        if (checkbox.disabled) return;
        const orderedIds = state.acquisitionRecords.filter(isAcquisitionDeletable).map((session) => session.id);
        state.acquisitionSelectionAnchor = applyRangeSelection(
          state.acquisitionSelection,
          orderedIds,
          checkbox.dataset.acquisitionCheck,
          event.shiftKey,
          state.acquisitionSelectionAnchor,
          checkbox.checked,
        );
        syncAcquisitionSelection();
      });
    });
    document.querySelectorAll("[data-delete-acquisition]").forEach((button) => {
      button.addEventListener("click", () => requestRecordDeletion("acquisitions", [button.dataset.deleteAcquisition]));
    });
    syncAcquisitionSelection();
  } catch (error) {
    $("acquisitionBody").innerHTML = `<tr><td colspan="10" class="empty">${escapeHtml(error.message)}</td></tr>`;
    syncAcquisitionSelection();
  }
}

function showRecordFeedback(kind, message, error = false) {
  const element = kind === "jobs" ? $("uploadMessage") : $("acquisitionMessage");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.remove("hidden");
}

function requestRecordDeletion(kind, ids) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const records = kind === "jobs"
    ? state.jobs.filter((job) => uniqueIds.includes(job.id))
    : state.acquisitionRecords.filter((session) => uniqueIds.includes(session.id));
  const deletable = records.filter(kind === "jobs" ? isJobDeletable : isAcquisitionDeletable);
  if (!deletable.length) {
    showRecordFeedback(kind, "当前记录仍在处理中或已经不存在，暂时不能删除。", true);
    return;
  }

  state.deleteRequest = { kind, ids: deletable.map((record) => record.id) };
  const noun = kind === "jobs" ? "任务" : "采集记录";
  $("deleteSummary").textContent = `将永久删除 ${deletable.length} 条${noun}`;
  $("deleteExplanation").textContent = kind === "jobs"
    ? "数据库记录、上传原始文件、处理报告和特征文件会一起清理。"
    : "数据库清单、CSV、EDF 和元数据文件会一起清理。已生成的分析任务不会自动删除。";
  $("deletePreview").innerHTML = deletable.slice(0, 6).map((record, index) => {
    const title = kind === "jobs" ? record.title : (record.csv_name || record.id);
    const meta = kind === "jobs"
      ? `${record.owner_name} · ${formatDateTime(record.created_at)}`
      : `${record.subject_id || "—"} · ${record.profile_label || "—"} · ${formatDateTime(record.created_at)}`;
    return `<div class="delete-preview-item">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta)}</small></div>
    </div>`;
  }).join("") + (deletable.length > 6
    ? `<p class="delete-more">另有 ${deletable.length - 6} 条记录将一并删除。</p>`
    : "");
  $("deleteMessage").textContent = "";
  $("deleteMessage").classList.add("hidden");
  $("confirmDeleteBtn").disabled = false;
  $("confirmDeleteBtn").textContent = "确认删除";
  $("deleteDialog").showModal();
}

function closeDeleteDialog(clearSelection = true) {
  const request = state.deleteRequest;
  state.deleteRequest = null;
  if (clearSelection && request?.kind === "jobs") {
    state.jobSelection.clear();
    state.jobSelectionAnchor = null;
    syncJobSelection();
  } else if (clearSelection && request?.kind === "acquisitions") {
    state.acquisitionSelection.clear();
    state.acquisitionSelectionAnchor = null;
    syncAcquisitionSelection();
  }
  if ($("deleteDialog").open) $("deleteDialog").close();
}

async function confirmRecordDeletion() {
  const request = state.deleteRequest;
  if (!request) return;
  const button = $("confirmDeleteBtn");
  button.disabled = true;
  button.textContent = "正在删除…";
  $("deleteMessage").classList.add("hidden");
  try {
    const data = await api(
      request.kind === "jobs" ? "/api/jobs/bulk-delete" : "/api/acquisitions/bulk-delete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: request.ids }),
      },
    );
    const deleted = new Set(data.deleted || []);
    const skipped = data.skipped || [];
    closeDeleteDialog();

    if (request.kind === "jobs") {
      state.jobSelection.clear();
      state.jobSelectionAnchor = null;
      if (deleted.has(state.jobDialogId) && $("jobDialog").open) {
        $("jobDialog").close();
        state.jobDialogId = null;
      }
      await loadJobs();
    } else {
      state.acquisitionSelection.clear();
      state.acquisitionSelectionAnchor = null;
      await loadAcquisitions();
    }

    const warningText = data.warnings?.length ? ` 文件清理提示：${data.warnings.join("；")}` : "";
    if (skipped.length) {
      const firstReason = skipped[0]?.reason || "未知原因";
      showRecordFeedback(
        request.kind,
        `已删除 ${deleted.size} 条，${skipped.length} 条未删除。${firstReason}${warningText}`,
        true,
      );
    } else {
      showRecordFeedback(request.kind, `已删除 ${deleted.size} 条记录，相关文件已清理。${warningText}`);
    }
  } catch (error) {
    $("deleteMessage").textContent = `删除失败：${error.message}`;
    $("deleteMessage").classList.remove("hidden");
    $("deleteMessage").classList.add("error");
    button.disabled = false;
    button.textContent = "确认删除";
  }
}

async function loadDeviceView() {
  await loadDeviceProfiles();
  await loadAcquisitions();
}

function setView(view) {
  document.querySelectorAll(".view").forEach((element) => element.classList.add("hidden"));
  document.querySelectorAll(".nav-item").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    button.toggleAttribute("aria-current", active);
  });
  $(`${view}View`).classList.remove("hidden");
  const labels = {
    jobs: ["任务工作台", "两类状态数据从这里进入流程", "上传 EEG/IMU 数据，完成质量检查、预处理与可追溯报告，为单模态和融合建模提供统一输入。"],
    devices: ["设备采集", "连接设备并采集原始数据", "通过 BrainFlow 连接 EEG/IMU 设备，按标准命名保存并提交分析。"],
    datasets: ["数据资源", "两类状态候选数据", "核对来源、许可、样本规模、标签质量和 EEG/IMU 可用性。"],
    protocol: ["团队规范", "双状态与跨个体实验约定", "让两类状态、运动条件、数据划分和处理参数都可以被复核。"],
  };
  $("viewLabel").textContent = labels[view][0];
  $("pageTitle").textContent = labels[view][1];
  $("pageSubtitle").textContent = labels[view][2];
  if (view === "datasets") loadDatasets();
  if (view === "devices") void loadDeviceView();
}

document.querySelectorAll("[data-auth-tab]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.authTab));
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

$("themeToggle").addEventListener("click", toggleTheme);

document.querySelectorAll("[data-trust-view]").forEach((button) => {
  button.addEventListener("click", () => void openTrustDialog(button.dataset.trustView));
});

$("trustJobSelect").addEventListener("change", () => {
  state.trustJobId = $("trustJobSelect").value || null;
  void loadTrustView();
});

$("closeTrustDialog").addEventListener("click", () => $("trustDialog").close());
$("trustDialog").addEventListener("click", (event) => {
  if (event.target === $("trustDialog")) $("trustDialog").close();
});

$("deviceProfile").addEventListener("change", renderDeviceProfile);
$("customTransport").addEventListener("change", renderDeviceProfile);
["customDeviceName", "customBoardId"].forEach((id) => {
  $(id).addEventListener("input", renderDeviceProfile);
});
$("deviceAddress").addEventListener("input", updateStartAvailability);
$("simulationConsent").addEventListener("change", updateStartAvailability);
$("acquisitionSubject").addEventListener("input", updateAcquisitionFileName);
$("acquisitionTask").addEventListener("change", updateAcquisitionFileName);
$("deviceScanBtn").addEventListener("click", () => void scanDevices());
$("refreshAcquisitionsBtn").addEventListener("click", () => void loadAcquisitions());
$("acquisitionForm").addEventListener("submit", (event) => void startAcquisition(event));
$("stopAcquisitionBtn").addEventListener("click", () => void stopAcquisition());

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
    $("password").value = "";
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

$("accountBtn").addEventListener("click", openAccountDialog);
$("closeAccountDialog").addEventListener("click", () => $("accountDialog").close());
$("cancelAccountBtn").addEventListener("click", () => $("accountDialog").close());
$("accountDialog").addEventListener("click", (event) => {
  if (event.target === $("accountDialog")) $("accountDialog").close();
});

$("accountForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const newUsername = $("accountUsername").value.trim();
  const currentPassword = $("accountCurrentPassword").value;
  const newPassword = $("accountNewPassword").value;
  const confirmPassword = $("accountConfirmPassword").value;
  if (newPassword !== confirmPassword) {
    showAccountMessage("两次输入的新密码不一致。", true);
    return;
  }
  const originalText = $("saveAccountBtn").textContent;
  $("saveAccountBtn").disabled = true;
  $("saveAccountBtn").textContent = "正在保存…";
  try {
    const data = await api("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: currentPassword,
        new_username: newUsername,
        new_password: newPassword || null,
      }),
    });
    updateAccountHeader(data.user);
    $("accountUsername").value = data.user.username;
    $("accountCurrentPassword").value = "";
    $("accountNewPassword").value = "";
    $("accountConfirmPassword").value = "";
    showAccountMessage("账户设置已保存，下次登录请使用新的用户名和密码。");
    loadJobs();
  } catch (error) {
    showAccountMessage(error.message, true);
  } finally {
    $("saveAccountBtn").disabled = false;
    $("saveAccountBtn").textContent = originalText;
  }
});

$("syncToggle").addEventListener("click", () => {
  const enabled = !state.autoSync;
  applyAutoSync(enabled);
  if (enabled) loadJobs();
});

const timeHeaderNames = new Set(["time_s", "timestamp", "timestamp_s", "time", "lsl_time", "seconds"]);
const eegHeaderNames = new Set([
  "fpz", "pz", "c3", "c4", "f3", "f4", "o1", "o2", "cz", "af3", "af4",
  "f7", "f8", "fc5", "fc6", "t7", "t8", "p7", "p8",
]);

function parseCsvHeader(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  cells.push(value.trim());
  return cells;
}

function setValidationItem(id, status, text) {
  const element = $(id);
  element.classList.remove("pass", "warn", "pending");
  element.classList.add(status);
  element.querySelector("strong").textContent = text;
}

function resetValidationPanel() {
  $("validationState").className = "validation-state pending";
  $("validationState").textContent = "等待选择文件";
  setValidationItem("checkFormat", "pending", "待检查");
  setValidationItem("checkSize", "pending", "待检查");
  setValidationItem("checkContent", "pending", "待检查");
  $("validationNote").textContent = "选择文件后会先检查格式、大小和 CSV 表头；EDF 将由服务端 MNE 进一步解析。";
}

function markServerValidationPending() {
  $("validationState").className = "validation-state pending";
  $("validationState").textContent = "服务端校验中";
  setValidationItem("checkContent", "pending", "正在解析");
  $("validationNote").textContent = "上传成功。服务端正在使用 Pandas/MNE 检查通道、时间轴、采样率和信号质量，结果会写入任务详情。";
}

async function updateFileValidation(file, token) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  setValidationItem("checkFormat", "pass", extension === "edf" ? "EDF 生理信号" : "CSV 表格");
  setValidationItem("checkSize", "pass", `${(file.size / 1024 / 1024).toFixed(2)} MB`);
  $("validationState").className = "validation-state pending";
  $("validationState").textContent = "预检中";

  if (extension === "edf") {
    setValidationItem("checkContent", "pending", "待服务端 MNE 校验");
    $("validationState").textContent = "等待服务端校验";
    $("validationNote").textContent = "EDF 文件格式和大小已通过。服务端会用 MNE 读取导联、采样率、时间轴和标注，完整检查在任务处理阶段完成。";
    return;
  }

  try {
    const text = await file.slice(0, 64 * 1024).text();
    if (token !== state.validationToken) return;
    const firstLine = text.split(/\r?\n/, 1)[0]?.replace(/^\uFEFF/, "") || "";
    const headers = parseCsvHeader(firstLine);
    const normalised = headers.map((header) => header.trim().toLowerCase().replace(/[-\s]+/g, "_"));
    const hasTime = normalised.some((header) => timeHeaderNames.has(header));
    const eegChannels = normalised.filter((header) => header.startsWith("eeg") || header.endsWith("_eeg") || eegHeaderNames.has(header));
    const imuChannels = normalised.filter((header) => /acc|gyro|imu/.test(header));
    if (hasTime && eegChannels.length) {
      setValidationItem("checkContent", "pass", `${eegChannels.length} EEG / ${imuChannels.length} IMU`);
      $("validationState").className = "validation-state pass";
      $("validationState").textContent = "预检通过";
      $("validationNote").textContent = "表头已识别时间列、EEG 通道和可选 IMU 通道。提交后服务端还会检查空值、重复时间点、采样率、缺口和信号质量。";
    } else {
      setValidationItem("checkContent", "warn", hasTime ? "未识别 EEG 列" : "未识别时间列");
      $("validationState").className = "validation-state warn";
      $("validationState").textContent = "建议检查表头";
      $("validationNote").textContent = hasTime
        ? "未找到 eeg_*、Fpz、Pz、C3 等 EEG 通道名。服务端可能拒绝处理，请检查 CSV 表头。"
        : "未找到 time_s、time、timestamp 等时间列。当前上传接口需要时间列，请补充后再提交。";
    }
  } catch {
    if (token !== state.validationToken) return;
    setValidationItem("checkContent", "warn", "表头读取失败");
    $("validationState").className = "validation-state warn";
    $("validationState").textContent = "需要检查";
    $("validationNote").textContent = "浏览器无法读取 CSV 表头，可能是编码或文件权限问题；仍可在提交后查看服务端校验结果。";
  }
}

const dropzone = $("teamDropzone");
let dragDepth = 0;
dropzone.addEventListener("click", () => $("dataFile").click());
dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    $("dataFile").click();
  }
});
dropzone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  dropzone.classList.add("dragging");
});
dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
dropzone.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropzone.classList.remove("dragging");
});
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove("dragging");
  if (event.dataTransfer.files[0]) void setDataFile(event.dataTransfer.files[0]);
});
$("dataFile").addEventListener("change", () => {
  if ($("dataFile").files[0]) void setDataFile($("dataFile").files[0]);
});

async function setDataFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["csv", "edf"].includes(extension)) {
    resetDataFile();
    setValidationItem("checkFormat", "warn", "格式不支持");
    $("validationState").className = "validation-state warn";
    $("validationState").textContent = "需要检查";
    showMessage("文件格式不支持，请选择 CSV 或 EDF 文件。", true);
    return;
  }
  if (file.size > 200 * 1024 * 1024) {
    resetDataFile();
    setValidationItem("checkFormat", "pass", extension === "edf" ? "EDF 生理信号" : "CSV 表格");
    setValidationItem("checkSize", "warn", "超过 200 MB");
    $("validationState").className = "validation-state warn";
    $("validationState").textContent = "文件过大";
    showMessage("文件超过 200 MB 上限，请压缩或拆分后再上传。", true);
    return;
  }
  state.selectedFile = file;
  state.validationToken += 1;
  $("uploadMessage").classList.add("hidden");
  $("dropTitle").textContent = "文件已准备好";
  $("dataFileName").textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  $("dropBrowse").textContent = "点击更换文件";
  dropzone.classList.add("selected");
  if (!$("jobTitle").value) $("jobTitle").value = file.name.replace(/\.[^.]+$/, "");
  await updateFileValidation(file, state.validationToken);
}

function resetDataFile() {
  state.selectedFile = null;
  state.validationToken += 1;
  $("dataFile").value = "";
  $("dropTitle").textContent = "拖拽 EEG/IMU 数据到这里";
  $("dataFileName").textContent = "支持 CSV 时间序列表格与 EDF 生理信号文件";
  $("dropBrowse").textContent = "或点击选择本地文件";
  dropzone.classList.remove("selected", "dragging");
  resetValidationPanel();
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
  const originalText = $("uploadBtn").textContent;
  $("uploadBtn").disabled = true;
  $("uploadBtn").textContent = "正在上传…";
  showMessage("正在上传并创建处理任务…");
  try {
    const data = await api("/api/jobs/upload", { method: "POST", body: form });
    showMessage(`上传成功：${data.job.id}。服务端正在校验通道、时间轴和信号质量。`);
    resetDataFile();
    markServerValidationPending();
    loadJobs();
  } catch (error) {
    showMessage(`提交失败：${error.message}`, true);
  } finally {
    $("uploadBtn").disabled = false;
    $("uploadBtn").textContent = originalText;
  }
});

$("demoBtn").addEventListener("click", async () => {
  const originalText = $("demoBtn").textContent;
  $("demoBtn").disabled = true;
  $("demoBtn").textContent = "正在创建…";
  try {
    showMessage("正在创建团队演示任务…");
    const data = await api("/api/jobs/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "团队演示 · 正式科研模式",
        config: configFromForm(),
      }),
    });
    showMessage(`演示任务已提交：${data.job.id}`);
    loadJobs();
  } catch (error) {
    showMessage(`创建失败：${error.message}`, true);
  } finally {
    $("demoBtn").disabled = false;
    $("demoBtn").textContent = originalText;
  }
});

$("refreshBtn").addEventListener("click", loadJobs);
$("closeDialog").addEventListener("click", () => $("jobDialog").close());
$("jobDialog").addEventListener("click", (event) => {
  if (event.target === $("jobDialog")) $("jobDialog").close();
});
$("jobDialog").addEventListener("close", () => {
  state.jobDialogId = null;
});

$("jobsSelectAll").addEventListener("change", () => {
  const eligibleIds = state.jobs.filter(isJobDeletable).map((job) => job.id);
  state.jobSelection.clear();
  if ($("jobsSelectAll").checked) eligibleIds.forEach((id) => state.jobSelection.add(id));
  state.jobSelectionAnchor = null;
  syncJobSelection();
});
$("clearJobSelection").addEventListener("click", () => {
  state.jobSelection.clear();
  state.jobSelectionAnchor = null;
  syncJobSelection();
});
$("deleteSelectedJobs").addEventListener("click", () => {
  requestRecordDeletion("jobs", Array.from(state.jobSelection));
});

$("acquisitionsSelectAll").addEventListener("change", () => {
  const eligibleIds = state.acquisitionRecords
    .filter(isAcquisitionDeletable)
    .map((session) => session.id);
  state.acquisitionSelection.clear();
  if ($("acquisitionsSelectAll").checked) {
    eligibleIds.forEach((id) => state.acquisitionSelection.add(id));
  }
  state.acquisitionSelectionAnchor = null;
  syncAcquisitionSelection();
});
$("clearAcquisitionSelection").addEventListener("click", () => {
  state.acquisitionSelection.clear();
  state.acquisitionSelectionAnchor = null;
  syncAcquisitionSelection();
});
$("deleteSelectedAcquisitions").addEventListener("click", () => {
  requestRecordDeletion("acquisitions", Array.from(state.acquisitionSelection));
});

$("closeDeleteDialog").addEventListener("click", closeDeleteDialog);
$("cancelDeleteDialog").addEventListener("click", closeDeleteDialog);
$("confirmDeleteBtn").addEventListener("click", () => void confirmRecordDeletion());
$("deleteDialog").addEventListener("click", (event) => {
  if (event.target === $("deleteDialog")) closeDeleteDialog();
});

async function boot() {
  applyTheme(document.documentElement.dataset.theme || "light", false);
  initializeCustomSelects();
  resetValidationPanel();
  state.autoSync = readAutoSyncPreference();
  applyAutoSync(state.autoSync);
  setAuthMode("login");
  try {
    const data = await api("/api/me");
    showApp(data.user);
  } catch {
    showAuth();
  }
}

runBootSequence();
boot();
