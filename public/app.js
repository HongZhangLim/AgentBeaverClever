let currentAnalysisId = null;

const authStatus = document.getElementById("authStatus");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");

const uploadForm = document.getElementById("uploadForm");
const fileInput = document.getElementById("fileInput");
const uploadMeta = document.getElementById("uploadMeta");
const taskTableWrap = document.getElementById("taskTableWrap");

const decisionsList = document.getElementById("decisionsList");
const blockersList = document.getElementById("blockersList");
const insights = document.getElementById("insights");

const actionOptions = document.getElementById("actionOptions");
const executeBtn = document.getElementById("executeBtn");
const resultBox = document.getElementById("resultBox");

const toSheets = document.getElementById("toSheets");
const toCalendar = document.getElementById("toCalendar");
const spreadsheetId = document.getElementById("spreadsheetId");
const sheetName = document.getElementById("sheetName");
const calendarId = document.getElementById("calendarId");

function setResult(payload, isError = false) {
  resultBox.textContent = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  resultBox.classList.toggle("error", isError);
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

function renderInsights(listEl, items) {
  listEl.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.textContent = "None";
    listEl.appendChild(li);
    return;
  }

  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    listEl.appendChild(li);
  });
}

function makeTaskRow(task, index) {
  return `
    <tr data-index="${index}">
      <td><input type="checkbox" class="approve" checked /></td>
      <td><input type="text" class="title" value="${task.title || ""}" /></td>
      <td><input type="text" class="owner" value="${task.owner || ""}" /></td>
      <td><input type="date" class="dueDate" value="${task.dueDate || ""}" /></td>
      <td><input type="time" class="dueTime" value="${task.dueTime || ""}" /></td>
      <td>
        <select class="priority">
          <option value="low" ${task.priority === "low" ? "selected" : ""}>low</option>
          <option value="medium" ${task.priority === "medium" ? "selected" : ""}>medium</option>
          <option value="high" ${task.priority === "high" ? "selected" : ""}>high</option>
        </select>
      </td>
      <td><input type="text" class="notes" value="${task.notes || ""}" /></td>
      <td><small>${task.id || ""}</small></td>
    </tr>
  `;
}

function renderTaskTable(tasks) {
  const html = `
    <table>
      <thead>
        <tr>
          <th>Approve</th>
          <th>Task</th>
          <th>Owner</th>
          <th>Due Date</th>
          <th>Due Time</th>
          <th>Priority</th>
          <th>Notes</th>
          <th>Task ID</th>
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
      id: row.cells[7]?.textContent?.trim(),
      title: row.querySelector(".title")?.value?.trim() || "",
      owner: row.querySelector(".owner")?.value?.trim() || "Unassigned",
      dueDate: row.querySelector(".dueDate")?.value?.trim() || "",
      dueTime: row.querySelector(".dueTime")?.value?.trim() || "",
      priority: row.querySelector(".priority")?.value || "medium",
      notes: row.querySelector(".notes")?.value?.trim() || "",
      sourceSnippet: "",
    }))
    .filter((task) => task.title.length > 0);
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

  setResult("Analyzing file...");

  try {
    const data = await fetchJson("/api/upload-analyze", {
      method: "POST",
      body: formData,
    });

    currentAnalysisId = data.analysisId;

    uploadMeta.textContent = `Analyzed ${data.fileName} | ${data.inputType} | ${data.messageCount} messages | ${data.tasks.length} tasks`;
    renderInsights(decisionsList, data.decisions || []);
    renderInsights(blockersList, data.blockers || []);
    insights.classList.remove("hidden");

    renderTaskTable(data.tasks || []);
    setResult({ message: "Analysis complete", analysisId: data.analysisId, taskCount: data.tasks.length });
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

  setResult("Executing approved actions...");

  try {
    const data = await fetchJson("/api/actions/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setResult(data);
  } catch (error) {
    setResult(error.message, true);
  }
});

refreshAuthStatus();
