let currentAnalysisId = null;

const authStatus = document.getElementById("authStatus");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const fetchLatestBtn = document.getElementById("btn-fetch-latest");
const sourceSubtitle = document.getElementById("sourceSubtitle");
const whatsappStatus = document.getElementById("whatsappStatus");
const whatsappQrImage = document.getElementById("whatsapp-qr-image");
const whatsappHint = document.getElementById("whatsappHint");
const telegramConfigStatus = document.getElementById("telegramConfigStatus");
const telegramTokenInput = document.getElementById("telegramTokenInput");
const telegramChatIdInput = document.getElementById("telegramChatIdInput");
const telegramSaveBtn = document.getElementById("telegramSaveBtn");
const legacyTelegramPreview = document.getElementById("telegramConfigPreview");

if (legacyTelegramPreview) {
  legacyTelegramPreview.remove();
}

const uploadForm = document.getElementById("uploadForm");
const fileInput = document.getElementById("fileInput");
const folderUploadForm = document.getElementById("folderUploadForm");
const folderInput = document.getElementById("folderInput");
const taskTableWrap = document.getElementById("taskTableWrap");

const actionOptions = document.getElementById("actionOptions");
const executeBtn = document.getElementById("executeBtn");
const resultBox = document.getElementById("resultBox");

const toSheets = document.getElementById("toSheets");
const toCalendar = document.getElementById("toCalendar");
const spreadsheetId = document.getElementById("spreadsheetId");
const sheetName = document.getElementById("sheetName");
const calendarId = document.getElementById("calendarId");

const SUPPORTED_FOLDER_EXTENSIONS = ["txt", "md", "json"];
const SQUIRREL_RUNNER = "🐿️";
const LOADING_TRAIL_EMOJIS = ["🦫", "🦎", "🪵", "🥩", "🍯"];
const LOADING_TRAIL_MAX_STEPS = 55;
const SQUIRREL_TICK_MS = 100;
const MAX_LOADING_PERCENT = 99;
const SUCCESS_BOX_MIN_WIDTH = 72;
const SUCCESS_BOX_MAX_WIDTH = 110;
const TRANSCRIPT_ANALYSIS_MIN_LOADING_MS = 3000;
const TELEGRAM_DEFAULT_CHAT_ID = "-1003766186850";
const TELEGRAM_CONFIGURED_TOKEN_PLACEHOLDER = "................";
const TELEGRAM_DEFAULT_TOKEN_PLACEHOLDER = "Telegram Bot Token (from @BotFather)";
const TELEGRAM_DEFAULT_CHAT_PLACEHOLDER = "Preferred Chat ID (optional)";

let resultAnimationId = null;

function getResultCharCapacity() {
  const probe = document.createElement("span");
  probe.textContent = "M";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "pre";
  probe.style.font = window.getComputedStyle(resultBox).font;
  document.body.appendChild(probe);

  const charWidth = probe.getBoundingClientRect().width || 8;
  probe.remove();

  const resultWidth = resultBox.clientWidth || 760;
  return Math.max(60, Math.floor(resultWidth / charWidth));
}

function centerText(text, width) {
  if (text.length >= width) {
    return text.slice(0, width);
  }

  const leftPad = Math.floor((width - text.length) / 2);
  const rightPad = width - text.length - leftPad;
  return `${" ".repeat(leftPad)}${text}${" ".repeat(rightPad)}`;
}

function fitText(text, width) {
  if (text.length <= width) {
    return text.padEnd(width, " ");
  }

  return `${text.slice(0, Math.max(0, width - 3))}...`;
}

function centerOrTrimText(text, width) {
  const value = String(text || "");
  if (value.length > width) {
    return `${value.slice(0, Math.max(0, width - 3))}...`;
  }

  return centerText(value, width);
}

function pickNextLoadingEmoji(lastEmoji = "") {
  if (!LOADING_TRAIL_EMOJIS.length) {
    return "";
  }

  if (LOADING_TRAIL_EMOJIS.length === 1) {
    return LOADING_TRAIL_EMOJIS[0];
  }

  let nextEmoji = LOADING_TRAIL_EMOJIS[Math.floor(Math.random() * LOADING_TRAIL_EMOJIS.length)];
  while (nextEmoji === lastEmoji) {
    nextEmoji = LOADING_TRAIL_EMOJIS[Math.floor(Math.random() * LOADING_TRAIL_EMOJIS.length)];
  }

  return nextEmoji;
}

function buildSuccessOutput(message) {
  const terminalWidth = getResultCharCapacity();
  const totalWidth = Math.min(SUCCESS_BOX_MAX_WIDTH, Math.max(SUCCESS_BOX_MIN_WIDTH, terminalWidth - 2));
  const innerWidth = totalWidth - 4;
  const topBottom = `+${"=".repeat(totalWidth - 2)}+`;
  const separator = `+${"-".repeat(totalWidth - 2)}+`;

  return [
    topBottom,
    `| ${centerText("LOAD COMPLETE - BEAVER ARRIVED", innerWidth)} |`,
    `| ${centerText("All operations finished successfully", innerWidth)} |`,
    `| ${centerText("Loading... 100%", innerWidth)} |`,
    separator,
    `| ${centerOrTrimText(message, innerWidth)} |`,
    topBottom,
  ].join("\n");
}

function buildLoadingFrame(message, progressPercent, emojiTrail = "", centerWidth = 80) {
  const centeredSquirrel = centerText(SQUIRREL_RUNNER, centerWidth);
  const centeredMessage = centerText(String(message || ""), centerWidth);
  const loadingLabel = `Loading... ${progressPercent}%`;
  const centeredLoading = centerText(loadingLabel, Math.max(loadingLabel.length + 2, centerWidth));
  const centeredTrail = centerText(String(emojiTrail || ""), centerWidth);

  return `${centeredMessage}\n\n${centeredSquirrel}\n${centeredLoading}\n${centeredTrail}`;
}

function stopResultAnimation() {
  if (resultAnimationId) {
    clearInterval(resultAnimationId);
    resultAnimationId = null;
  }
}

function setResult(payload, isError = false) {
  stopResultAnimation();
  resultBox.textContent = typeof payload === "string" ? payload : "Operation completed.";
  resultBox.classList.remove("loading", "success");
  resultBox.classList.toggle("error", isError);
}

function setLoadingResult(message) {
  stopResultAnimation();
  resultBox.classList.remove("error", "success");
  resultBox.classList.add("loading");

  const terminalWidth = getResultCharCapacity();
  const centerWidth = Math.max(40, terminalWidth - 2);

  let emojiTrail = "";
  let emojiSteps = 0;
  let lastEmoji = "";
  let progressPercent = 0;
  resultBox.textContent = buildLoadingFrame(
    message,
    progressPercent,
    emojiTrail,
    centerWidth
  );

  resultAnimationId = setInterval(() => {
    const nextEmoji = pickNextLoadingEmoji(lastEmoji);
    lastEmoji = nextEmoji;

    if (emojiSteps >= LOADING_TRAIL_MAX_STEPS) {
      emojiTrail = "";
      emojiSteps = 0;
    }

    emojiTrail += nextEmoji;
    emojiSteps += 1;

    if (progressPercent < MAX_LOADING_PERCENT) {
      progressPercent += 1;
    }

    resultBox.textContent = buildLoadingFrame(
      message,
      progressPercent,
      emojiTrail,
      centerWidth
    );
  }, SQUIRREL_TICK_MS);
}

function setSuccessResult(message) {
  stopResultAnimation();
  resultBox.classList.remove("error", "loading");
  resultBox.classList.add("success");
  resultBox.textContent = buildSuccessOutput(message);
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

async function refreshAuthStatus() {
  try {
    const data = await fetchJson("/api/auth-status");
    authStatus.textContent = data.connected ? "Connected" : "Not connected";
    authStatus.style.background = data.connected ? "#dcfce7" : "#fee2e2";
  } catch (error) {
    authStatus.textContent = "Auth check failed";
  }
}

async function refreshTelegramConfigStatus() {
  if (!telegramConfigStatus) {
    return;
  }

  try {
    const config = await fetchJson("/api/telegram/runtime-config");
    const chatId = String(config.chatId || "").trim() || TELEGRAM_DEFAULT_CHAT_ID;

    if (config.configured) {
      telegramConfigStatus.textContent = "Configured";
      telegramConfigStatus.style.background = "#dcfce7";
      if (telegramTokenInput) {
        telegramTokenInput.placeholder = TELEGRAM_CONFIGURED_TOKEN_PLACEHOLDER;
      }
      if (telegramChatIdInput) {
        telegramChatIdInput.placeholder = chatId;
      }
    } else {
      telegramConfigStatus.textContent = "Not configured";
      telegramConfigStatus.style.background = "#fee2e2";
      if (telegramTokenInput) {
        telegramTokenInput.placeholder = TELEGRAM_DEFAULT_TOKEN_PLACEHOLDER;
      }
      if (telegramChatIdInput) {
        telegramChatIdInput.placeholder = TELEGRAM_DEFAULT_CHAT_PLACEHOLDER;
      }
    }
  } catch {
    telegramConfigStatus.textContent = "Status failed";
    telegramConfigStatus.style.background = "#fee2e2";
    if (telegramTokenInput) {
      telegramTokenInput.placeholder = TELEGRAM_DEFAULT_TOKEN_PLACEHOLDER;
    }
    if (telegramChatIdInput) {
      telegramChatIdInput.placeholder = TELEGRAM_DEFAULT_CHAT_PLACEHOLDER;
    }
  }
}
async function refreshWhatsAppStatus() {
  try {
    const status = await fetchJson("/api/whatsapp/status");

    if (status.startupError) {
      whatsappStatus.textContent = "WhatsApp Start Failed";
      whatsappStatus.style.background = "#fee2e2";
      whatsappQrImage.classList.add("hidden");
      whatsappQrImage.removeAttribute("src");
      whatsappHint.textContent = `Server error: ${status.startupError}`;
      return;
    }

    if (status.isConnected) {
      whatsappStatus.textContent = "WhatsApp Connected";
      whatsappStatus.style.background = "#dcfce7";
      whatsappQrImage.classList.add("hidden");
      whatsappQrImage.removeAttribute("src");
      whatsappHint.textContent = "Connected. Send /summarize in WhatsApp to trigger analysis.";
      return;
    }

    if (status.qrCodeUrl) {
      whatsappStatus.textContent = "Scan QR Code";
      whatsappStatus.style.background = "#fef3c7";
      whatsappQrImage.src = status.qrCodeUrl;
      whatsappQrImage.classList.remove("hidden");
      whatsappHint.textContent = "Open WhatsApp > Linked Devices > Link a Device, then scan this QR.";
      return;
    }

    whatsappStatus.textContent = "Waiting for QR...";
    whatsappStatus.style.background = "#e5e7eb";
    whatsappQrImage.classList.add("hidden");
    whatsappQrImage.removeAttribute("src");
    whatsappHint.textContent = "WhatsApp is starting. QR code will appear here soon.";
  } catch (error) {
    whatsappStatus.textContent = "Status check failed";
    whatsappStatus.style.background = "#fee2e2";
    whatsappQrImage.classList.add("hidden");
    whatsappQrImage.removeAttribute("src");
    whatsappHint.textContent = "Could not load WhatsApp status from server.";
  }
}

function normalizeItemType(task = {}) {
  if (task.itemType === "event") {
    return "event";
  }
  if (task.itemType === "task") {
    return "task";
  }
  if (task.startTime || task.endTime) {
    return "event";
  }
  return "task";
}

function renderItemTypeBadge(itemType) {
  const label = itemType === "event" ? "Event" : "Task";
  const hint =
    itemType === "event"
      ? "Will execute as Google Calendar Event"
      : "Will execute as Google Calendar Task";

  return `<span class="item-type-badge item-type-${itemType}" title="${hint}">${label}</span>`;
}

function displayDashValue(value) {
  const normalized = String(value ?? "").trim();
  return normalized || "-";
}

function cleanDashValue(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized === "-" || normalized === "--") {
    return "";
  }

  return normalized;
}

function makeTaskRow(task, index) {
  const itemType = normalizeItemType(task);

  return `
    <tr data-index="${index}" data-item-type="${itemType}" data-task-id="${task.id || ""}">
      <td><input type="checkbox" class="approve" checked /></td>
      <td class="item-type-cell">${renderItemTypeBadge(itemType)}</td>
      <td><input type="text" class="title" value="${displayDashValue(task.title)}" /></td>
      <td><input type="text" class="owner" value="${displayDashValue(task.owner)}" /></td>
      <td><input type="text" class="dueDate" value="${displayDashValue(task.dueDate)}" /></td>
      <td><input type="text" class="dueTime" value="${displayDashValue(task.dueTime)}" /></td>
      <td><input type="text" class="location" value="${displayDashValue(task.location)}" /></td>
      <td><input type="text" class="meetingLink" value="${displayDashValue(task.meetingLink)}"/></td>
      <td><input type="text" class="googleDriveAttachment" value="${displayDashValue(task.googleDriveAttachment)}"/></td>
      <td><input type="text" class="notes" value="${displayDashValue(task.notes)}" /></td>
    </tr>
  `;
}

function getExtension(fileName) {
  const index = fileName.lastIndexOf(".");
  if (index < 0) {
    return "";
  }
  return fileName.slice(index + 1).toLowerCase();
}

function isSupportedFolderFile(file) {
  const extension = getExtension(file.name || "");
  return SUPPORTED_FOLDER_EXTENSIONS.includes(extension);
}

function updateSourceSubtitle(data = {}) {
  if (!sourceSubtitle) {
    return;
  }

  const sourceName =
    (typeof data.fileName === "string" && data.fileName.trim()) ||
    (typeof data.parsedSourceFile === "string" && data.parsedSourceFile.trim()) ||
    "Unknown meeting source";

  sourceSubtitle.textContent = `Source: ${sourceName}`;
}

function renderAnalysisResult(data) {
  currentAnalysisId = data.analysisId;
  updateSourceSubtitle(data);

  const eventCount = (data.tasks || []).filter((task) => normalizeItemType(task) === "event").length;
  const taskCount = (data.tasks || []).length - eventCount;

  renderTaskTable(data.tasks || []);
  setSuccessResult(`Analysis complete. ${data.tasks.length} item(s) are ready for review.`);
}

async function submitAnalysis(url, formData, progressMessage) {
  setLoadingResult(progressMessage);

  const data = await fetchJson(url, {
    method: "POST",
    body: formData,
  });

  renderAnalysisResult(data);
}

function setAnalysisIdInUrl(analysisId) {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set("analysisId", analysisId);
  window.history.pushState({}, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
}

async function loadAnalysisById(analysisId, loadingMessage = "Loading shared analysis...") {
  setLoadingResult(loadingMessage);
  const data = await fetchJson(`/api/analysis/${encodeURIComponent(analysisId)}`);
  renderAnalysisResult(data);
  setAnalysisIdInUrl(analysisId);
}

async function loadAnalysisFromQueryParam() {
  const params = new URLSearchParams(window.location.search);
  const analysisId = params.get("analysisId");
  if (!analysisId) {
    return;
  }

  try {
    await loadAnalysisById(analysisId, "Loading shared analysis...");
  } catch (error) {
    setResult(`Failed to load shared analysis: ${error.message}`, true);
  }
}

async function fetchLatestAnalysis() {
  if (!fetchLatestBtn) {
    return;
  }

  const defaultText = fetchLatestBtn.dataset.defaultText || fetchLatestBtn.textContent || "I finished a meeting";
  fetchLatestBtn.dataset.defaultText = defaultText;
  fetchLatestBtn.disabled = true;
  fetchLatestBtn.textContent = "Fetching...";

  try {
    let nextAnalysisId = "";

    try {
      const latest = await fetchJson("/api/analyses/latest");
      nextAnalysisId = latest?.analysisId || "";
    } catch (error) {
      const message = String(error?.message || "");
      const canFallback = message.includes("No recent meetings found") || message.includes("Request failed: 404");
      if (!canFallback) {
        throw error;
      }
    }

    if (!nextAnalysisId) {
      setLoadingResult("Analyzing transcript.json...");
      const [analysis] = await Promise.all([
        fetchJson("/api/analyses/from-hardcoded-transcript", {
          method: "POST",
        }),
        new Promise((resolve) => setTimeout(resolve, TRANSCRIPT_ANALYSIS_MIN_LOADING_MS)),
      ]);

      nextAnalysisId = analysis?.analysisId || "";
      if (!nextAnalysisId) {
        throw new Error("Transcript analysis response is missing analysisId.");
      }
    }

    await loadAnalysisById(nextAnalysisId, "Fetching latest meeting...");
  } catch (error) {
    setResult(error.message, true);
  } finally {
    fetchLatestBtn.disabled = false;
    fetchLatestBtn.textContent = defaultText;
  }
}

function renderTaskTable(tasks) {
  const html = `
    <table>
      <thead>
        <tr>
          <th>Approve</th>
          <th>Item Type</th>
          <th>Task</th>
          <th>PIC</th>
          <th>Due Date</th>
          <th>Due Time</th>
          <th>Location</th>
          <th>Meeting Link</th>
          <th>Google Drive Attachment</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        ${tasks.map((task, index) => makeTaskRow(task, index)).join("")}
      </tbody>
    </table>
  `;

  taskTableWrap.innerHTML = html;
  taskTableWrap.classList.remove("hidden");
  actionOptions.classList.remove("hidden");
}

function collectApprovedTasks() {
  const rows = [...taskTableWrap.querySelectorAll("tbody tr")];

  return rows
    .filter((row) => row.querySelector(".approve")?.checked)
    .map((row) => {
      const title = cleanDashValue(row.querySelector(".title")?.value);
      const owner = cleanDashValue(row.querySelector(".owner")?.value);
      const dueDate = cleanDashValue(row.querySelector(".dueDate")?.value);
      const dueTime = cleanDashValue(row.querySelector(".dueTime")?.value);
      const location = cleanDashValue(row.querySelector(".location")?.value);
      const meetingLink = cleanDashValue(row.querySelector(".meetingLink")?.value);
      const googleDriveAttachment = cleanDashValue(row.querySelector(".googleDriveAttachment")?.value);
      const notes = cleanDashValue(row.querySelector(".notes")?.value);

      return {
        id: row.dataset.taskId?.trim() || "",
        sourceIndex: Number(row.dataset.index || -1),
        itemType: row.dataset.itemType || "task",
        title,
        owner: owner || "Unassigned",
        dueDate,
        dueTime,
        location,
        meetingLink,
        googleDriveAttachment,
        notes,
        sourceSnippet: "",
      };
    })
    .filter((task) => task.title.length > 0);
}

function summarizeExecutionResult(data, options = {}) {
  const parts = [`Executed ${data?.executedTaskCount || 0} item(s).`];

  if (options.includeSheets) {
    const sheetCount = data?.results?.sheets?.appendedCount || 0;
    parts.push(`Sheets synced: ${sheetCount}.`);
  }

  if (options.includeCalendar) {
    const eventCount = data?.results?.calendar?.events?.created?.length || 0;
    const taskCount = data?.results?.calendar?.tasks?.created?.length || 0;
    const driveCount = data?.results?.calendar?.drive?.createdFiles?.length || 0;
    parts.push(`Calendar events: ${eventCount}.`);
    parts.push(`Calendar tasks: ${taskCount}.`);
    if (driveCount > 0) {
      parts.push(`Drive files linked: ${driveCount}.`);
    }
  }

  return parts.join(" ");
}

connectBtn.addEventListener("click", () => {
  window.location.href = "/auth/google/start";
});

disconnectBtn.addEventListener("click", async () => {
  try {
    await fetchJson("/auth/google/disconnect", { method: "POST" });
    await refreshAuthStatus();
    setResult("Disconnected from Google.");
  } catch (error) {
    setResult(error.message, true);
  }
});

if (telegramSaveBtn) {
  telegramSaveBtn.addEventListener("click", async () => {
    const botToken = telegramTokenInput?.value?.trim() || "";
    const chatId = telegramChatIdInput?.value?.trim() || "";

    if (!botToken) {
      setResult("Please paste your Telegram bot token from @BotFather.", true);
      return;
    }

    const defaultText = telegramSaveBtn.dataset.defaultText || telegramSaveBtn.textContent || "Save Telegram Config";
    telegramSaveBtn.dataset.defaultText = defaultText;
    telegramSaveBtn.disabled = true;
    telegramSaveBtn.textContent = "Saving...";

    try {
      await fetchJson("/api/telegram/runtime-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken, chatId }),
      });

      if (telegramTokenInput) {
        telegramTokenInput.value = "";
      }

      await refreshTelegramConfigStatus();
      setResult("Telegram bot config updated.");
    } catch (error) {
      setResult(error.message, true);
    } finally {
      telegramSaveBtn.disabled = false;
      telegramSaveBtn.textContent = defaultText;
    }
  });
}

if (fetchLatestBtn) {
  fetchLatestBtn.addEventListener("click", fetchLatestAnalysis);
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!fileInput.files?.length) {
    setResult("Please choose a file first.", true);
    return;
  }

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);
  try {
    await submitAnalysis("/api/upload-analyze", formData, "Analyzing file...");
  } catch (error) {
    setResult(error.message, true);
  }
});

folderUploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const allFiles = Array.from(folderInput.files || []);
  if (!allFiles.length) {
    setResult("Please choose a folder first.", true);
    return;
  }

  const supportedFiles = allFiles.filter(isSupportedFolderFile);
  if (!supportedFiles.length) {
    setResult("No supported chat files found in selected folder. Expected .txt, .md, or .json.", true);
    return;
  }

  const formData = new FormData();
  supportedFiles.forEach((file) => {
    const fileName = file.webkitRelativePath || file.name;
    formData.append("files", file, fileName);
  });

  try {
    await submitAnalysis(
      "/api/upload-analyze-folder",
      formData,
      `Analyzing folder with ${supportedFiles.length} supported files...`
    );
  } catch (error) {
    setResult(error.message, true);
  }
});

executeBtn.addEventListener("click", async () => {
  const shouldSyncSheets = Boolean(toSheets?.checked);
  const shouldSyncCalendar = toCalendar ? Boolean(toCalendar.checked) : true;

  if (!currentAnalysisId) {
    setResult("No analysis loaded.", true);
    return;
  }

  if (!shouldSyncSheets && !shouldSyncCalendar) {
    setResult("Select at least one destination: Google Sheets or Google Calendar.", true);
    return;
  }

  try {
    const auth = await fetchJson("/api/auth-status");
    if (!auth.connected) {
      setResult("Google account not connected. Click Connect Google before executing actions.", true);
      return;
    }
  } catch (error) {
    setResult(`Could not verify Google auth status: ${error.message}`, true);
    return;
  }

  const tasks = collectApprovedTasks();
  if (!tasks.length) {
    setResult("No approved tasks selected.", true);
    return;
  }

  const payload = {
    analysisId: currentAnalysisId,
    tasks,
    options: {
      toSheets: shouldSyncSheets,
      toCalendar: shouldSyncCalendar,
      spreadsheetId: spreadsheetId?.value?.trim() || "",
      sheetName: sheetName?.value?.trim() || "Tasks",
      calendarId: calendarId?.value?.trim() || "primary",
    },
  };

  setLoadingResult("Executing approved actions...");

  try {
    const data = await fetchJson("/api/actions/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSuccessResult(
      summarizeExecutionResult(data, {
        includeSheets: shouldSyncSheets,
        includeCalendar: shouldSyncCalendar,
      })
    );
  } catch (error) {
    setResult(error.message, true);
  }
});

refreshAuthStatus();
refreshTelegramConfigStatus();
refreshWhatsAppStatus();
setInterval(refreshWhatsAppStatus, 3000);
loadAnalysisFromQueryParam();
