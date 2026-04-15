import crypto from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

const taskSchema = z.object({
  id: z.string().optional(),
  itemType: z.enum(["task", "event"]).optional().default("task"),
  title: z.string().min(1),
  owner: z.string().optional().default("Unassigned"),
  deadline: z.string().optional().default(""),
  startTime: z.string().optional().default(""),
  endTime: z.string().optional().default(""),
  location: z.string().optional().default(""),
  attendees: z.array(z.string()).optional().default([]),
  createMeetLink: z.boolean().optional().default(false),
  dueDate: z.string().optional().default(""),
  dueTime: z.string().optional().default(""),
  priority: z.enum(["low", "medium", "high"]).optional().default("medium"),
  requiresNewSlide: z.boolean().optional().default(false),
  requiresNewDoc: z.boolean().optional().default(false),
  targetFileName: z.string().optional().default(""),
  notes: z.string().optional().default(""),
  sourceSnippet: z.string().optional().default(""),
});

const outputSchema = z.object({
  tasks: z.array(taskSchema).default([]),
  decisions: z.array(z.string()).default([]),
  blockers: z.array(z.string()).default([]),
});

function getModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing in environment");
  }

  const genAi = new GoogleGenerativeAI(apiKey);
  return genAi.getGenerativeModel({
    model: process.env.GEMINI_MODEL || "gemma-3-4b-it",
  });
}

function stripMarkdownFences(text) {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(stripMarkdownFences(text));
  } catch (error) {
    return null;
  }
}

function makeTaskId(ingestionId, task) {
  const basis = `${ingestionId}:${task.itemType || "task"}:${task.title}:${task.owner || ""}:${
    task.deadline || ""
  }:${task.startTime || ""}:${task.endTime || ""}:${task.location || ""}:${
    (task.attendees || []).join("|")
  }:${task.targetFileName || ""}`;
  return crypto.createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

function normalizeAttendees(rawAttendees) {
  if (Array.isArray(rawAttendees)) {
    return [...new Set(rawAttendees.map((value) => String(value || "").trim()).filter(Boolean))];
  }

  if (typeof rawAttendees === "string") {
    return [...new Set(rawAttendees.split(/[;,]/).map((value) => value.trim()).filter(Boolean))];
  }

  return [];
}

function normalizeDate(rawDate) {
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
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(
        2,
        "0"
      )}`;
    }
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return "";
}

function normalizeTime(rawTime) {
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

  const hhmmss = value.match(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/);
  if (hhmmss) {
    return `${hhmmss[1]}:${hhmmss[2]}`;
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

function normalizeDateTime(rawDateTime) {
  if (!rawDateTime || typeof rawDateTime !== "string") {
    return "";
  }

  const value = rawDateTime.trim();
  if (!value) {
    return "";
  }

  const isoSeconds = value.match(/^(\d{4}-\d{2}-\d{2})[T ]([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/);
  if (isoSeconds) {
    return `${isoSeconds[1]}T${isoSeconds[2]}:${isoSeconds[3]}:${isoSeconds[4]}`;
  }

  const isoMinutes = value.match(/^(\d{4}-\d{2}-\d{2})[T ]([01]\d|2[0-3]):([0-5]\d)$/);
  if (isoMinutes) {
    return `${isoMinutes[1]}T${isoMinutes[2]}:${isoMinutes[3]}:00`;
  }

  const slashDateTime = value.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+([0-2]?\d(?::\d{2})?(?:\s*[AaPp][Mm])?))?$/
  );
  if (slashDateTime) {
    const [, monthRaw, dayRaw, yearRaw, timeRaw] = slashDateTime;
    const date = normalizeDate(`${monthRaw}/${dayRaw}/${yearRaw}`);
    const time = normalizeTime(timeRaw || "09:00");
    if (date && time) {
      return `${date}T${time}:00`;
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

function addMinutesToDateTime(dateTimeStr, minutes) {
  const match = dateTimeStr.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/
  );

  if (!match) {
    return "";
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
  return date.toISOString().slice(0, 19);
}

function normalizeTasks(ingestionId, tasks) {
  return tasks.map((task) => {
    const itemType = task.itemType === "event" ? "event" : "task";

    const deadline = normalizeDate(task.deadline || "");
    const fallbackDate = normalizeDate(task.dueDate || "");
    const fallbackTime = normalizeTime(task.dueTime || "") || "09:00";

    const startTime =
      normalizeDateTime(task.startTime || "") ||
      (itemType === "event" && fallbackDate ? `${fallbackDate}T${fallbackTime}:00` : "");

    const endTime =
      normalizeDateTime(task.endTime || "") || (itemType === "event" && startTime
        ? addMinutesToDateTime(startTime, 60)
        : "");

    const derivedDueDate =
      itemType === "task"
        ? deadline || fallbackDate
        : startTime
        ? startTime.slice(0, 10)
        : fallbackDate;

    const derivedDueTime = itemType === "event" && startTime ? startTime.slice(11, 16) : "";

    const id = task.id || makeTaskId(ingestionId, task);
    const normalizedAttendees = normalizeAttendees(task.attendees);

    return {
      id,
      itemType,
      title: task.title.trim(),
      owner: task.owner?.trim() || "Unassigned",
      deadline: itemType === "task" ? deadline || fallbackDate : "",
      startTime: itemType === "event" ? startTime : "",
      endTime: itemType === "event" ? endTime : "",
      location: itemType === "event" ? task.location?.trim() || "" : "",
      attendees: itemType === "event" ? normalizedAttendees : [],
      createMeetLink: itemType === "event" ? Boolean(task.createMeetLink) : false,
      dueDate: derivedDueDate || "",
      dueTime: derivedDueTime || "",
      priority: task.priority || "medium",
      requiresNewSlide: Boolean(task.requiresNewSlide),
      requiresNewDoc: Boolean(task.requiresNewDoc),
      targetFileName: task.targetFileName?.trim() || "",
      notes: task.notes?.trim() || "",
      sourceSnippet: task.sourceSnippet?.trim() || "",
    };
  });
}

async function requestStructuredOutput(model, canonicalText) {
  const prompt = [
    "You are an operations assistant for student projects.",
    "Extract actionable project intelligence from the conversation.",
    "Return strictly valid JSON with exactly this shape:",
    '{"tasks":[{"itemType":"task|event","title":"","owner":"","deadline":"YYYY-MM-DD or empty","startTime":"YYYY-MM-DDTHH:MM or empty","endTime":"YYYY-MM-DDTHH:MM or empty","location":"","attendees":[""],"createMeetLink":false,"priority":"low|medium|high","requiresNewSlide":false,"requiresNewDoc":false,"targetFileName":"","notes":"","sourceSnippet":""}],"decisions":[""],"blockers":[""]}',
    "Rules:",
    "- Include only real commitments or actions as tasks/events.",
    "- itemType must be 'event' when there is a concrete scheduled occurrence (meeting, presentation, pitching, call, workshop).",
    "- itemType must be 'task' for actionable work items with a deadline.",
    "- Example: '12/4/2026 6pm I have hackathon final pitching' MUST be classified as itemType='event'.",
    "- For itemType='event': populate startTime and endTime, and leave deadline empty.",
    "- For itemType='event': include location when present.",
    "- For itemType='event': include attendees as names or emails when present.",
    "- For itemType='event': set createMeetLink=true when it is a meeting/call/sync/review/presentation/pitching context.",
    "- For itemType='task': populate deadline, and leave startTime/endTime empty.",
    "- If event endTime is not explicit, infer a practical endTime 60 minutes after startTime.",
    "- If owner or date is not explicit, leave fields empty rather than guessing.",
    "- Detect collaboration deliverables: if the item implies creating a new slide deck or doc, set requiresNewSlide/requiresNewDoc and targetFileName.",
    "- Keep decisions and blockers concise.",
    "- Do not include any markdown, prose, or code fences; output JSON only.",
    "Conversation:",
    canonicalText,
  ].join("\n\n");

  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function repairJson(model, rawText) {
  const repairPrompt = [
    "Repair the following content into strict JSON only.",
    "Target shape:",
    '{"tasks":[{"itemType":"task|event","title":"","owner":"","deadline":"","startTime":"","endTime":"","location":"","attendees":[""],"createMeetLink":false,"priority":"low|medium|high","requiresNewSlide":false,"requiresNewDoc":false,"targetFileName":"","notes":"","sourceSnippet":""}],"decisions":[""],"blockers":[""]}',
    "Content to repair:",
    rawText,
  ].join("\n\n");

  const result = await model.generateContent(repairPrompt);
  return result.response.text();
}

export async function extractProjectIntel({ canonicalText, ingestionId }) {
  const model = getModel();

  const rawText = await requestStructuredOutput(model, canonicalText.slice(0, 45000));
  let parsed = safeJsonParse(rawText);

  if (!parsed) {
    const repaired = await repairJson(model, rawText);
    parsed = safeJsonParse(repaired);
  }

  if (!parsed) {
    throw new Error("Gemini response could not be parsed into JSON");
  }

  const validated = outputSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error("Gemini output did not match expected schema");
  }

  return {
    tasks: normalizeTasks(ingestionId, validated.data.tasks),
    decisions: validated.data.decisions,
    blockers: validated.data.blockers,
    rawModelText: rawText,
  };
}
