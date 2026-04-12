import { google } from "googleapis";

const SHEET_HEADERS = [
  "Task",
  "Owner",
  "DueDate",
  "DueTime",
  "Priority",
  "Status",
  "ActionId",
  "Source",
  "CreatedAt",
];

function toIsoDateTime(date, time) {
  const safeTime = time && /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : "09:00:00";
  return `${date}T${safeTime}`;
}

function addMinutesToDateTime(dateTimeStr, minutes) {
  const date = new Date(dateTimeStr);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function addOneDay(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function ensureSheetAndHeader(sheetsApi, spreadsheetId, sheetName) {
  const spreadsheetMeta = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const hasSheet = spreadsheetMeta.data.sheets?.some(
    (sheet) => sheet.properties?.title === sheetName
  );

  if (!hasSheet) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });
  }

  const headerResp = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:I1`,
  });

  const existing = headerResp.data.values?.[0] || [];
  const missingHeaders = existing.length !== SHEET_HEADERS.length;

  if (missingHeaders) {
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:I1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [SHEET_HEADERS],
      },
    });
  }
}

export async function syncTasksToSheet(oauthClient, tasks, options = {}) {
  const sheetsApi = google.sheets({ version: "v4", auth: oauthClient });
  const sheetName = options.sheetName || "Tasks";

  let spreadsheetId = options.spreadsheetId;
  let spreadsheetUrl = "";

  if (!spreadsheetId) {
    const createResp = await sheetsApi.spreadsheets.create({
      requestBody: {
        properties: {
          title: `Meeting Agent Tasks ${new Date().toISOString().slice(0, 10)}`,
        },
      },
    });

    spreadsheetId = createResp.data.spreadsheetId;
    spreadsheetUrl = createResp.data.spreadsheetUrl;
  }

  await ensureSheetAndHeader(sheetsApi, spreadsheetId, sheetName);

  const existingResp = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!G2:G`,
  });

  const existingIds = new Set(
    (existingResp.data.values || []).map((row) => row[0]).filter(Boolean)
  );

  const now = new Date().toISOString();
  const rows = [];
  const skipped = [];

  for (const task of tasks) {
    if (existingIds.has(task.id)) {
      skipped.push({ taskId: task.id, reason: "duplicate" });
      continue;
    }

    rows.push([
      task.title,
      task.owner || "Unassigned",
      task.dueDate || "",
      task.dueTime || "",
      task.priority || "medium",
      "todo",
      task.id,
      task.sourceSnippet || "",
      now,
    ]);
  }

  if (rows.length) {
    await sheetsApi.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:I`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: rows,
      },
    });
  }

  return {
    spreadsheetId,
    spreadsheetUrl: spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    sheetName,
    appendedCount: rows.length,
    skipped,
  };
}

export async function createCalendarEvents(oauthClient, tasks, options = {}, existingMap = {}) {
  const calendarApi = google.calendar({ version: "v3", auth: oauthClient });
  const calendarId = options.calendarId || "primary";
  const timezone = process.env.DEFAULT_TIMEZONE || "UTC";

  const created = [];
  const skipped = [];

  for (const task of tasks) {
    if (!task.dueDate) {
      skipped.push({ taskId: task.id, reason: "missing dueDate" });
      continue;
    }

    if (existingMap[task.id]) {
      skipped.push({ taskId: task.id, reason: "duplicate" });
      continue;
    }

    const hasTime = Boolean(task.dueTime && /^\d{2}:\d{2}$/.test(task.dueTime));

    const event = {
      summary: task.title,
      description: [
        `Owner: ${task.owner || "Unassigned"}`,
        `Priority: ${task.priority || "medium"}`,
        `ActionId: ${task.id}`,
        task.notes ? `Notes: ${task.notes}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      reminders: {
        useDefault: true,
      },
    };

    if (hasTime) {
      const startDateTime = toIsoDateTime(task.dueDate, task.dueTime);
      event.start = {
        dateTime: startDateTime,
        timeZone: timezone,
      };
      event.end = {
        dateTime: addMinutesToDateTime(startDateTime, 60),
        timeZone: timezone,
      };
    } else {
      event.start = { date: task.dueDate };
      event.end = { date: addOneDay(task.dueDate) };
    }

    const resp = await calendarApi.events.insert({
      calendarId,
      requestBody: event,
    });

    existingMap[task.id] = resp.data.id;

    created.push({
      taskId: task.id,
      eventId: resp.data.id,
      htmlLink: resp.data.htmlLink,
    });
  }

  return {
    calendarId,
    created,
    skipped,
  };
}
