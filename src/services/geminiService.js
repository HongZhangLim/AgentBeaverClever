import crypto from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

const taskSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  owner: z.string().optional().default("Unassigned"),
  dueDate: z.string().optional().default(""),
  dueTime: z.string().optional().default(""),
  priority: z.enum(["low", "medium", "high"]).optional().default("medium"),
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
    model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
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
  const basis = `${ingestionId}:${task.title}:${task.owner || ""}:${task.dueDate || ""}:${task.dueTime || ""}`;
  return crypto.createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

function normalizeTasks(ingestionId, tasks) {
  return tasks.map((task) => {
    const id = task.id || makeTaskId(ingestionId, task);
    return {
      id,
      title: task.title.trim(),
      owner: task.owner?.trim() || "Unassigned",
      dueDate: task.dueDate?.trim() || "",
      dueTime: task.dueTime?.trim() || "",
      priority: task.priority || "medium",
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
    '{"tasks":[{"title":"","owner":"","dueDate":"YYYY-MM-DD or empty","dueTime":"HH:MM or empty","priority":"low|medium|high","notes":"","sourceSnippet":""}],"decisions":[""],"blockers":[""]}',
    "Rules:",
    "- Include only real commitments or actions as tasks.",
    "- If owner or date is not explicit, leave empty rather than guessing.",
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
    '{"tasks":[{"title":"","owner":"","dueDate":"","dueTime":"","priority":"low|medium|high","notes":"","sourceSnippet":""}],"decisions":[""],"blockers":[""]}',
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
