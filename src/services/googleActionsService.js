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
  const safeTime = time ? `${time}:00` : "09:00:00";
  return `${date}T${safeTime}`;
}

function addMinutesToDateTime(dateTimeStr, minutes) {
  const match = dateTimeStr.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/
  );

  if (!match) {
    throw new Error(`Invalid dateTime format: ${dateTimeStr}`);
  }

  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    )
  );

  date.setUTCMinutes(date.getUTCMinutes() + minutes);

  // Keep the same local datetime format used for start.dateTime when timeZone is provided.
  return date.toISOString().slice(0, 19);
}

function addOneDay(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function normalizeDueDate(rawDate) {
  if (!rawDate || typeof rawDate !== "string") {
    return "";
  }

  const value = rawDate.trim();
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slashMatch) {
    const [, monthRaw, dayRaw, yearRaw] = slashMatch;
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const year = yearRaw.length === 2 ? Number(`20${yearRaw}`) : Number(yearRaw);

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(
        day
      ).padStart(2, "0")}`;
    }
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return "";
}

function normalizeDueTime(rawTime) {
  if (!rawTime || typeof rawTime !== "string") {
    return "";
  }

  const value = rawTime.trim();
  if (!value) {
    return "";
  }

  const hhmm = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (hhmm) {
    return `${hhmm[1]}:${hhmm[2]}`;
  }

  const ampm = value.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (ampm) {
    let hour = Number(ampm[1]);
    const minute = Number(ampm[2]);
    const suffix = ampm[3].toLowerCase();

    if (hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59) {
      if (suffix === "pm" && hour !== 12) {
        hour += 12;
      }
      if (suffix === "am" && hour === 12) {
        hour = 0;
      }
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  return "";
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
    const dueDate = normalizeDueDate(task.dueDate);
    if (!dueDate) {
      skipped.push({ taskId: task.id, reason: "missing or invalid dueDate" });
      continue;
    }

    if (existingMap[task.id]) {
      skipped.push({ taskId: task.id, reason: "duplicate" });
      continue;
    }

    const dueTime = normalizeDueTime(task.dueTime);
    const hasTime = Boolean(dueTime);

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
      const startDateTime = toIsoDateTime(dueDate, dueTime);
      event.start = {
        dateTime: startDateTime,
        timeZone: timezone,
      };
      event.end = {
        dateTime: addMinutesToDateTime(startDateTime, 60),
        timeZone: timezone,
      };
    } else {
      event.start = { date: dueDate };
      event.end = { date: addOneDay(dueDate) };
    }

    try {
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
    } catch (error) {
      const apiMessage = error?.response?.data?.error?.message || error?.message || "calendar error";
      skipped.push({ taskId: task.id, reason: `calendar_error: ${apiMessage}` });
    }
  }

  return {
    calendarId,
    created,
    skipped,
  };
}
