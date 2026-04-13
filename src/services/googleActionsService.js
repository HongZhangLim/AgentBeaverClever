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

const DRIVE_MIME_TYPES = {
  slide: "application/vnd.google-apps.presentation",
  doc: "application/vnd.google-apps.document",
};

const TEAM_COLLABORATORS = [
  {
    name: "Lim Hong Zhang",
    envKey: "COLLABORATOR_LIM_HONG_ZHANG_EMAIL",
  },
  {
    name: "Lim Szeman",
    envKey: "COLLABORATOR_LIM_SZEMAN_EMAIL",
  },
  {
    name: "Khor Kai Yee",
    envKey: "COLLABORATOR_KHOR_KAI_YEE_EMAIL",
  },
];

const TASK_DEADLINE_REMINDER_OVERRIDES = [
  { method: "email", minutes: 24 * 60 },
  { method: "popup", minutes: 120 },
  { method: "popup", minutes: 30 },
  { method: "popup", minutes: 15 },
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

  const ampm = value.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (ampm) {
    let hour = Number(ampm[1]);
    const minute = Number(ampm[2] || "00");
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

function normalizeLocalDateTime(rawDateTime) {
  if (!rawDateTime || typeof rawDateTime !== "string") {
    return "";
  }

  const value = rawDateTime.trim();
  if (!value) {
    return "";
  }

  const isoWithSeconds = value.match(
    /^(\d{4}-\d{2}-\d{2})[T ]([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/
  );
  if (isoWithSeconds) {
    return `${isoWithSeconds[1]}T${isoWithSeconds[2]}:${isoWithSeconds[3]}:${isoWithSeconds[4]}`;
  }

  const isoWithMinutes = value.match(/^(\d{4}-\d{2}-\d{2})[T ]([01]\d|2[0-3]):([0-5]\d)$/);
  if (isoWithMinutes) {
    return `${isoWithMinutes[1]}T${isoWithMinutes[2]}:${isoWithMinutes[3]}:00`;
  }

  const slashDateTime = value.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+([0-2]?\d(?::\d{2})?(?:\s*[AaPp][Mm])?))?$/
  );
  if (slashDateTime) {
    const [, monthRaw, dayRaw, yearRaw, timeRaw] = slashDateTime;
    const normalizedDate = normalizeDueDate(`${monthRaw}/${dayRaw}/${yearRaw}`);
    const normalizedTime = normalizeDueTime(timeRaw || "09:00") || "09:00";

    if (normalizedDate) {
      return `${normalizedDate}T${normalizedTime}:00`;
    }
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    const hour = String(parsed.getHours()).padStart(2, "0");
    const minute = String(parsed.getMinutes()).padStart(2, "0");
    const second = String(parsed.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  }

  return "";
}

function normalizeItemType(task) {
  if (task?.itemType === "event") {
    return "event";
  }

  if (task?.itemType === "task") {
    return "task";
  }

  if (task?.startTime || task?.endTime) {
    return "event";
  }

  return "task";
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function normalizeAttendeeValues(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue.map((item) => String(item || "").trim()).filter(Boolean);
  }

  if (typeof rawValue === "string") {
    return rawValue
      .split(/[;,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function resolveCollaboratorEmails() {
  const explicit = TEAM_COLLABORATORS.map((collaborator) => ({
    name: collaborator.name,
    email: (process.env[collaborator.envKey] || "").trim(),
  }));

  const defaultEmailList = (process.env.DEFAULT_COLLABORATOR_EMAILS || "")
    .split(/[\s,]+/)
    .map((email) => email.trim())
    .filter(Boolean);

  const defaultEventAttendees = (process.env.DEFAULT_EVENT_ATTENDEES || "")
    .split(/[\s,]+/)
    .map((email) => email.trim())
    .filter(Boolean);

  const configuredEmails = explicit.map((entry) => entry.email).filter(Boolean);
  const missingNames = explicit.filter((entry) => !entry.email).map((entry) => entry.name);

  const namedCollaborators = explicit
    .filter((entry) => entry.email)
    .map((entry) => ({
      name: entry.name,
      email: entry.email,
      normalizedName: normalizeName(entry.name),
    }));

  return {
    emails: [...new Set([...configuredEmails, ...defaultEmailList])],
    missingNames,
    namedCollaborators,
    defaultEventAttendees,
  };
}

function resolveAttendeeEmails(task, collaboratorInfo) {
  const rawCandidates = [
    ...normalizeAttendeeValues(task.attendees),
    String(task.owner || "").trim(),
  ].filter((value) => value && value.toLowerCase() !== "unassigned");

  const resolvedEmails = new Set();
  const unresolvedNames = [];

  for (const candidate of rawCandidates) {
    if (isEmail(candidate)) {
      resolvedEmails.add(candidate.toLowerCase());
      continue;
    }

    const normalizedCandidate = normalizeName(candidate);
    const namedMatch = collaboratorInfo.namedCollaborators.find((collaborator) => {
      return (
        collaborator.normalizedName === normalizedCandidate ||
        collaborator.normalizedName.includes(normalizedCandidate) ||
        normalizedCandidate.includes(collaborator.normalizedName)
      );
    });

    if (namedMatch) {
      resolvedEmails.add(namedMatch.email);
    } else {
      unresolvedNames.push(candidate);
    }
  }

  if (!resolvedEmails.size && collaboratorInfo.defaultEventAttendees.length) {
    collaboratorInfo.defaultEventAttendees.forEach((email) => resolvedEmails.add(email));
  }

  return {
    emails: [...resolvedEmails],
    unresolvedNames,
  };
}

function normalizeHttpUrl(rawValue) {
  if (typeof rawValue !== "string") {
    return "";
  }

  const value = rawValue.trim();
  if (!value) {
    return "";
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return "";
}

function isGoogleDriveAttachmentUrl(url) {
  return /^https?:\/\/(drive|docs|sheets|slides)\.google\.com\//i.test(String(url || ""));
}

function parseManualGoogleDriveLinks(rawValue) {
  const values = Array.isArray(rawValue)
    ? rawValue
    : String(rawValue || "")
        .split(/[\n,;]/)
        .map((value) => value.trim());

  const urls = values
    .map((value) => normalizeHttpUrl(String(value || "")))
    .filter((url) => url && isGoogleDriveAttachmentUrl(url));

  return [...new Set(urls)];
}

function shouldCreateMeetLink(task) {
  if (normalizeHttpUrl(task.meetingLink)) {
    return false;
  }

  if (task.createMeetLink === true) {
    return true;
  }

  const text = `${task.title || ""} ${task.notes || ""}`.toLowerCase();
  return /(meeting|meet|sync|call|standup|review|presentation|pitch|discussion|check-?in|demo)/.test(
    text
  );
}

function buildDriveFileName(task, typeLabel) {
  const base = (task.targetFileName || "").trim() || (task.title || "Untitled").trim();
  const suffix = typeLabel === "slide" ? "Slides" : "Doc";

  if (base.toLowerCase().includes("slide") || base.toLowerCase().includes("doc")) {
    return base;
  }

  return `${base} ${suffix}`;
}

function stripActionIdLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .filter((line) => !/^ActionId\s*:/i.test(line.trim()))
    .join("\n")
    .trim();
}

function formatReminderOffset(minutes) {
  if (minutes === 24 * 60) {
    return "1 day before deadline";
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"} before deadline`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"} before deadline`;
}

function buildTaskReminderLabels() {
  return TASK_DEADLINE_REMINDER_OVERRIDES.map(
    (rule) => `- [${String(rule.method || "popup").toUpperCase()}] ${formatReminderOffset(rule.minutes)}`
  ).join("\n");
}

function buildTaskNotesWithReminderLabels(notes) {
  const cleanedNotes = stripActionIdLines(notes);
  const reminderLabelBlock = `Deadline Reminders:\n${buildTaskReminderLabels()}`;

  return cleanedNotes ? `${cleanedNotes}\n\n${reminderLabelBlock}` : reminderLabelBlock;
}

function buildTaskDeadlineLabel(task, normalizedDate, normalizedTime) {
  const rawDeadline = String(task?.deadline || "").trim();
  const rawDueDate = String(task?.dueDate || "").trim();

  if (rawDeadline) {
    return rawDeadline;
  }

  if (rawDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDueDate)) {
    return rawDueDate;
  }

  if (normalizedDate && normalizedTime) {
    return `${normalizedDate} ${normalizedTime}`;
  }

  return normalizedDate || "No specific deadline";
}

function toDriveUrlField(driveLinks = []) {
  return driveLinks.find(Boolean) || "";
}

function formatTaskNotes(task) {
  const safeNotes = stripActionIdLines(task.notes);
  const safeSource = stripActionIdLines(task.sourceSnippet);

  return `👤 Owner: ${task.owner || 'Unassigned'}
🔥 Priority: ${task.priority ? task.priority.charAt(0).toUpperCase() + task.priority.slice(1) : 'Medium'}
📅 Deadline: ${task.dueDate || 'No specific deadline'}

🔗 Attached Link: ${task.driveUrl || 'None'}

📝 Notes:
${task.notes || 'No additional notes provided.'}

---
💬 Context / Source:
"${task.sourceSnippet || 'No snippet available.'}"`;
}


function formatEventDescription(event) {
  const safeNotes = stripActionIdLines(event.notes);
  const safeSource = stripActionIdLines(event.sourceSnippet);

  return `👤 Owner: ${event.owner || 'Unassigned'}
🔥 Priority: ${event.priority ? event.priority.charAt(0).toUpperCase() + event.priority.slice(1) : 'Medium'}
⏰ Time: ${event.startTime || 'TBD'} - ${event.endTime || 'TBD'}

🔗 Attached Link: ${event.driveUrl || 'None'}

📝 Notes:
${safeNotes || 'No additional notes provided.'}

---
💬 Context / Source:
"${safeSource || 'No snippet available.'}"`;
}

function buildDriveAttachments(driveFiles, manualDriveLinks = []) {
  const createdFileAttachments = driveFiles
    .map((file) => ({
      fileUrl: file.webViewLink,
      title: "Attached Document",
    }))
    .filter((attachment) => attachment.fileUrl);

  const manualAttachments = manualDriveLinks.map((url) => ({
    fileUrl: url,
    title: "Attached Document",
  }));

  return [...createdFileAttachments, ...manualAttachments];
}

async function maybeCreateDriveFiles(driveApi, task, collaboratorInfo, actionId) {
  const requestedTypes = [];

  if (task.requiresNewSlide) {
    requestedTypes.push({
      label: "slide",
      mimeType: DRIVE_MIME_TYPES.slide,
    });
  }

  if (task.requiresNewDoc) {
    requestedTypes.push({
      label: "doc",
      mimeType: DRIVE_MIME_TYPES.doc,
    });
  }

  if (!requestedTypes.length) {
    return { files: [], warnings: [] };
  }

  const createdFiles = [];
  const warnings = [];

  for (const requestedType of requestedTypes) {
    try {
      const createResp = await driveApi.files.create({
        requestBody: {
          name: buildDriveFileName(task, requestedType.label),
          mimeType: requestedType.mimeType,
        },
        fields: "id,name,webViewLink,mimeType",
      });

      const created = createResp.data;
      createdFiles.push(created);

      if (!collaboratorInfo.emails.length) {
        warnings.push({
          taskId: actionId,
          fileId: created.id,
          reason:
            "No collaborator emails configured. Set COLLABORATOR_LIM_HONG_ZHANG_EMAIL, COLLABORATOR_LIM_SZEMAN_EMAIL, and COLLABORATOR_KHOR_KAI_YEE_EMAIL (or DEFAULT_COLLABORATOR_EMAILS).",
          collaboratorsMissing: collaboratorInfo.missingNames,
        });
        continue;
      }

      for (const email of collaboratorInfo.emails) {
        try {
          await driveApi.permissions.create({
            fileId: created.id,
            sendNotificationEmail: false,
            requestBody: {
              type: "user",
              role: "writer",
              emailAddress: email,
            },
          });
        } catch (error) {
          const apiMessage =
            error?.response?.data?.error?.message || error?.message || "drive permission error";
          warnings.push({
            taskId: actionId,
            fileId: created.id,
            email,
            reason: `drive_permission_error: ${apiMessage}`,
          });
        }
      }
    } catch (error) {
      const apiMessage =
        error?.response?.data?.error?.message || error?.message || "drive file create error";
      warnings.push({
        taskId: actionId,
        reason: `drive_create_error: ${apiMessage}`,
      });
    }
  }

  return { files: createdFiles, warnings };
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

    const dueDate = normalizeDueDate(task.deadline || task.dueDate);
    const dueTime =
      normalizeDueTime(task.dueTime) ||
      (task.startTime && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(task.startTime)
        ? task.startTime.slice(11, 16)
        : "");

    rows.push([
      task.title,
      task.owner || "Unassigned",
      dueDate || "",
      dueTime || "",
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
  const driveApi = google.drive({ version: "v3", auth: oauthClient });

  const calendarId = options.calendarId || "primary";
  const timezone = process.env.DEFAULT_TIMEZONE || "UTC";
  const collaboratorInfo = resolveCollaboratorEmails();

  const results = {
    calendarId,
    events: {
      created: [],
      skipped: [],
      warnings: [],
    },
    tasks: {
      created: [],
      skipped: [],
    },
    drive: {
      createdFiles: [],
      warnings: [],
    },
  };

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index] || {};
    const actionId = task.id || `generated-${index}`;
    const itemType = normalizeItemType(task);
    const providedMeetingLink = normalizeHttpUrl(task.meetingLink);
    const manualDriveLinks = parseManualGoogleDriveLinks(task.googleDriveAttachment);
    const existingRef = String(existingMap[actionId] || "");
    const [existingRefType, existingRefId] = existingRef.split(":");

    const shouldCreateDrive = Boolean(task.requiresNewSlide || task.requiresNewDoc);
    let driveFiles = [];

    if (shouldCreateDrive) {
      const driveResult = await maybeCreateDriveFiles(driveApi, task, collaboratorInfo, actionId);
      driveFiles = driveResult.files;
      results.drive.createdFiles.push(
        ...driveFiles.map((file) => ({
          taskId: actionId,
          fileId: file.id,
          name: file.name,
          mimeType: file.mimeType,
          webViewLink: file.webViewLink,
        }))
      );
      results.drive.warnings.push(...driveResult.warnings);
    }

    if (itemType === "event") {
      const eventStart =
        normalizeLocalDateTime(task.startTime) ||
        (() => {
          const fallbackDate = normalizeDueDate(task.dueDate || task.deadline);
          const fallbackTime = normalizeDueTime(task.dueTime) || "09:00";
          return fallbackDate ? toIsoDateTime(fallbackDate, fallbackTime) : "";
        })();

      if (!eventStart) {
        results.events.skipped.push({ taskId: actionId, reason: "missing or invalid startTime" });
        continue;
      }

      const eventEnd = normalizeLocalDateTime(task.endTime) || addMinutesToDateTime(eventStart, 60);

      if (!eventEnd) {
        results.events.skipped.push({ taskId: actionId, reason: "missing or invalid endTime" });
        continue;
      }

      const driveLinks = [
        ...new Set([...manualDriveLinks, ...driveFiles.map((file) => file.webViewLink).filter(Boolean)]),
      ];
      const attendees = resolveAttendeeEmails(task, collaboratorInfo);
      const driveUrl = toDriveUrlField(driveLinks);
      const eventNotes = stripActionIdLines(task.notes);

      const event = {
        summary: task.title,
        description: formatEventDescription({
          owner: task.owner,
          priority: task.priority,
          startTime: eventStart,
          endTime: eventEnd,
          driveUrl,
          notes: eventNotes,
          sourceSnippet: task.sourceSnippet,
        }),
        reminders: {
          useDefault: true,
        },
        start: {
          dateTime: eventStart,
          timeZone: timezone,
        },
        end: {
          dateTime: eventEnd,
          timeZone: timezone,
        },
      };

      if (task.location && String(task.location).trim()) {
        event.location = String(task.location).trim();
      }

      if (attendees.emails.length) {
        event.attendees = attendees.emails.map((email) => ({ email }));
      }

      if (attendees.unresolvedNames.length) {
        results.events.warnings.push({
          taskId: actionId,
          reason: "unresolved attendee names",
          names: attendees.unresolvedNames,
        });
      }

      const attachments = buildDriveAttachments(driveFiles, manualDriveLinks);
      const insertParams = {
        calendarId,
        supportsAttachments: true,
        requestBody: event,
      };

      if (shouldCreateMeetLink(task)) {
        event.conferenceData = {
          createRequest: {
            requestId: `meet-${actionId}-${Date.now()}`,
            conferenceSolutionKey: {
              type: "hangoutsMeet",
            },
          },
        };
        insertParams.conferenceDataVersion = 1;
      }

      if (attachments.length) {
        event.attachments = attachments;
      }

      try {
        let resp;
        if (existingRefType === "event" && existingRefId) {
          resp = await calendarApi.events.update({
            eventId: existingRefId,
            ...insertParams,
          });
        } else {
          resp = await calendarApi.events.insert(insertParams);
          existingMap[actionId] = `event:${resp.data.id}`;
        }

        results.events.created.push({
          taskId: actionId,
          eventId: resp.data.id,
          htmlLink: resp.data.htmlLink,
          meetLink: resp.data.hangoutLink || providedMeetingLink || "",
          location: resp.data.location || "",
          attendees: (resp.data.attendees || []).map((attendee) => attendee.email).filter(Boolean),
          driveLinks,
        });
      } catch (error) {
        const apiMessage =
          error?.response?.data?.error?.message || error?.message || "calendar error";
        results.events.skipped.push({
          taskId: actionId,
          reason: `calendar_error: ${apiMessage}`,
        });
      }

      continue;
    }

    const deadlineDate = normalizeDueDate(task.deadline || task.dueDate);
    if (!deadlineDate) {
      results.tasks.skipped.push({
        taskId: actionId,
        reason: "missing or invalid deadline",
      });
      continue;
    }

    const deadlineTime =
      normalizeDueTime(task.dueTime) ||
      (task.startTime && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(task.startTime)
        ? task.startTime.slice(11, 16)
        : "") ||
      "09:00";

    const taskStart = toIsoDateTime(deadlineDate, deadlineTime);
    const taskEnd = addMinutesToDateTime(taskStart, 15);

    const driveLinks = [
      ...new Set([...manualDriveLinks, ...driveFiles.map((file) => file.webViewLink).filter(Boolean)]),
    ];
    const driveUrl = toDriveUrlField(driveLinks);
    const taskNotesWithReminderLabels = buildTaskNotesWithReminderLabels(task.notes);
    const taskDeadlineLabel = buildTaskDeadlineLabel(task, deadlineDate, deadlineTime);

    const taskEvent = {
      summary: task.title,
      description: formatTaskNotes({
        owner: task.owner,
        priority: task.priority,
        dueDate: taskDeadlineLabel,
        driveUrl,
        notes: taskNotesWithReminderLabels,
        sourceSnippet: task.sourceSnippet,
      }),
      start: {
        dateTime: taskStart,
        timeZone: timezone,
      },
      end: {
        dateTime: taskEnd,
        timeZone: timezone,
      },
      reminders: {
        useDefault: false,
        overrides: TASK_DEADLINE_REMINDER_OVERRIDES,
      },
    };

    if (task.location && String(task.location).trim()) {
      taskEvent.location = String(task.location).trim();
    }

    const attachments = buildDriveAttachments(driveFiles, manualDriveLinks);
    if (attachments.length) {
      taskEvent.attachments = attachments;
    }

    try {
      let resp;
      if (existingRefType === "task-event" && existingRefId) {
        resp = await calendarApi.events.update({
          calendarId,
          eventId: existingRefId,
          supportsAttachments: true,
          requestBody: taskEvent,
        });
      } else {
        resp = await calendarApi.events.insert({
          calendarId,
          supportsAttachments: true,
          requestBody: taskEvent,
        });
        existingMap[actionId] = `task-event:${resp.data.id}`;
      }

      results.tasks.created.push({
        taskId: actionId,
        eventId: resp.data.id,
        htmlLink: resp.data.htmlLink || "",
        startDateTime: taskStart,
        endDateTime: taskEnd,
        driveLinks,
      });
    } catch (error) {
      const apiMessage =
        error?.response?.data?.error?.message || error?.message || "calendar error";
      results.tasks.skipped.push({
        taskId: actionId,
        reason: `calendar_error: ${apiMessage}`,
      });
    }
  }

  return results;
}
