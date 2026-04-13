let currentAnalysisId = null;

const authStatus = document.getElementById("authStatus");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");

const uploadForm = document.getElementById("uploadForm");
const fileInput = document.getElementById("fileInput");
const folderUploadForm = document.getElementById("folderUploadForm");
const folderInput = document.getElementById("folderInput");
const uploadMeta = document.getElementById("uploadMeta");
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
const SQUIRREL_RUNNER = "  🐿️  ";
const LOADING_TRAIL_EMOJIS = ["🦫", "🦎", "🪵", "🥩", "🍯"];
const LOADING_TRAIL_MAX_STEPS = 55;
const SQUIRREL_TICK_MS = 100;
const MAX_LOADING_PERCENT = 99;
const SUCCESS_BOX_MIN_WIDTH = 72;
const SUCCESS_BOX_MAX_WIDTH = 110;

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

function renderSquirrelAt(position) {
  const offset = " ".repeat(Math.max(0, position));
  return `${offset}${SQUIRREL_RUNNER}`;
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
    `| ${fitText(message, innerWidth)} |`,
    topBottom,
  ].join("\n");
}

function buildLoadingFrame(message, position, progressPercent, emojiTrail = "", centerWidth = 80) {
  const squirrel = renderSquirrelAt(position);
  const loadingLabel = `Loading... ${progressPercent}%`;
  const centeredLoading = centerText(loadingLabel, Math.max(loadingLabel.length + 2, centerWidth));

  return `${message}\n\n${squirrel}\n${centeredLoading}\n${emojiTrail}`;
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
  const squirrelWidth = Array.from(SQUIRREL_RUNNER).length;
  const centerWidth = Math.max(40, terminalWidth - 2);
  const squirrelPosition = Math.max(0, Math.floor((centerWidth - squirrelWidth) / 2));

  let emojiTrail = "";
  let emojiSteps = 0;
  let lastEmoji = "";
  let progressPercent = 0;
  resultBox.textContent = buildLoadingFrame(
    message,
    squirrelPosition,
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
      squirrelPosition,
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

function makeTaskRow(task, index) {
  const itemType = normalizeItemType(task);

  return `
    <tr data-index="${index}" data-item-type="${itemType}" data-task-id="${task.id || ""}">
      <td><input type="checkbox" class="approve" checked /></td>
      <td class="item-type-cell">${renderItemTypeBadge(itemType)}</td>
      <td><input type="text" class="title" value="${task.title || ""}" /></td>
      <td><input type="text" class="owner" value="${task.owner || ""}" /></td>
      <td><input type="date" class="dueDate" value="${task.dueDate || ""}" /></td>
      <td><input type="time" class="dueTime" value="${task.dueTime || ""}" /></td>
      <td><input type="text" class="location" value="${task.location || ""}" placeholder="Event location" /></td>
      <td><input type="url" class="meetingLink" value="${task.meetingLink || ""}" placeholder="https://meet.google.com/..." /></td>
      <td><input type="url" class="googleDriveAttachment" value="${task.googleDriveAttachment || ""}" placeholder="https://drive.google.com/..." /></td>
      <td><input type="text" class="notes" value="${task.notes || ""}" /></td>
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

function renderAnalysisResult(data) {
  currentAnalysisId = data.analysisId;

  const eventCount = (data.tasks || []).filter((task) => normalizeItemType(task) === "event").length;
  const taskCount = (data.tasks || []).length - eventCount;

  const sourceInfo =
    data.parsedSourceFile && data.parsedSourceFile !== data.fileName
      ? ` (source: ${data.parsedSourceFile})`
      : "";

  uploadMeta.textContent = `Analyzed ${data.fileName}${sourceInfo} | ${data.inputType} | ${data.messageCount} messages | ${taskCount} tasks | ${eventCount} events`;

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

function renderTaskTable(tasks) {
  const html = `
    <table>
      <thead>
        <tr>
          <th>Approve</th>
          <th>Item Type</th>
          <th>Task</th>
          <th>Owner</th>
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
    .map((row) => ({
      id: row.dataset.taskId?.trim() || "",
      sourceIndex: Number(row.dataset.index || -1),
      itemType: row.dataset.itemType || "task",
      title: row.querySelector(".title")?.value?.trim() || "",
      owner: row.querySelector(".owner")?.value?.trim() || "Unassigned",
      dueDate: row.querySelector(".dueDate")?.value?.trim() || "",
      dueTime: row.querySelector(".dueTime")?.value?.trim() || "",
      location: row.querySelector(".location")?.value?.trim() || "",
      meetingLink: row.querySelector(".meetingLink")?.value?.trim() || "",
      googleDriveAttachment: row.querySelector(".googleDriveAttachment")?.value?.trim() || "",
      notes: row.querySelector(".notes")?.value?.trim() || "",
      sourceSnippet: "",
    }))
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
  if (!currentAnalysisId) {
    setResult("No analysis loaded.", true);
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
      toSheets: toSheets.checked,
      toCalendar: toCalendar.checked,
      spreadsheetId: spreadsheetId.value.trim(),
      sheetName: sheetName.value.trim() || "Tasks",
      calendarId: calendarId.value.trim() || "primary",
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
        includeSheets: toSheets.checked,
        includeCalendar: toCalendar.checked,
      })
    );
  } catch (error) {
    setResult(error.message, true);
  }
});

refreshAuthStatus();
