import crypto from "crypto";
import AdmZip from "adm-zip";

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function getExtension(fileName = "") {
  const index = fileName.lastIndexOf(".");
  if (index < 0) {
    return "";
  }
  return fileName.slice(index + 1).toLowerCase();
}

function normalizeTextSegment(segment) {
  if (typeof segment === "string") {
    return segment;
  }

  if (Array.isArray(segment)) {
    return segment
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .join(" ")
      .trim();
  }

  return segment?.text || "";
}

const whatsappLinePattern =
  /^\[?(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4},?\s+\d{1,2}:\d{2}(?:\s?[APMapm]{2})?)\]?\s*-\s*(.+)$/;

function tryParseWhatsAppStartLine(line, index) {
  const trimmed = line.trim();
  const match = trimmed.match(whatsappLinePattern);
  if (!match) {
    return null;
  }

  const timestamp = match[1].trim();
  const remainder = match[2].trim();
  const firstColon = remainder.indexOf(":");

  if (firstColon === -1) {
    return {
      speaker: "System",
      timestamp,
      message: remainder,
      sourceLine: index + 1,
    };
  }

  const speaker = remainder.slice(0, firstColon).trim() || "Unknown";
  const message = remainder.slice(firstColon + 1).trim();

  return {
    speaker,
    timestamp,
    message,
    sourceLine: index + 1,
  };
}

function parseTextLine(line, index) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const whatsappPattern = /^\[(.+?)\]\s*([^:]+):\s*(.+)$/;
  const datedPattern = /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})\s*-\s*([^:]+):\s*(.+)$/;
  const simplePattern = /^([^:]{2,40}):\s*(.+)$/;

  let match = trimmed.match(whatsappPattern);
  if (match) {
    return {
      speaker: match[2].trim(),
      timestamp: match[1].trim(),
      message: match[3].trim(),
      sourceLine: index + 1,
    };
  }

  match = trimmed.match(datedPattern);
  if (match) {
    return {
      speaker: match[2].trim(),
      timestamp: match[1].trim(),
      message: match[3].trim(),
      sourceLine: index + 1,
    };
  }

  match = trimmed.match(simplePattern);
  if (match) {
    return {
      speaker: match[1].trim(),
      timestamp: null,
      message: match[2].trim(),
      sourceLine: index + 1,
    };
  }

  return {
    speaker: "Unknown",
    timestamp: null,
    message: trimmed,
    sourceLine: index + 1,
  };
}

function looksLikeWhatsAppExport(lines) {
  const sample = lines.slice(0, 120);
  let matchCount = 0;

  for (const line of sample) {
    if (whatsappLinePattern.test(line.trim())) {
      matchCount += 1;
    }
  }

  return matchCount >= 2;
}

function parseWhatsAppConversation(rawText) {
  const lines = rawText.split(/\r?\n/);
  const conversation = [];
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const parsed = tryParseWhatsAppStartLine(line, i);

    if (parsed) {
      if (current && current.message.trim()) {
        conversation.push(current);
      }
      current = parsed;
      continue;
    }

    const continuation = line.trim();
    if (!continuation) {
      continue;
    }

    if (current) {
      current.message = `${current.message}\n${continuation}`.trim();
    } else {
      conversation.push({
        speaker: "Unknown",
        timestamp: null,
        message: continuation,
        sourceLine: i + 1,
      });
    }
  }

  if (current && current.message.trim()) {
    conversation.push(current);
  }

  return conversation;
}

function parseTextConversation(rawText) {
  const lines = rawText.split(/\r?\n/);
  if (looksLikeWhatsAppExport(lines)) {
    return parseWhatsAppConversation(rawText);
  }

  const conversation = lines
    .map((line, index) => parseTextLine(line, index))
    .filter(Boolean)
    .filter((item) => item.message.length > 0);

  return conversation;
}

function parseJsonConversation(rawJson) {
  const messages = [];

  if (Array.isArray(rawJson)) {
    rawJson.forEach((item, index) => {
      const text = normalizeTextSegment(item?.text || item?.message || item?.content);
      if (!text) {
        return;
      }
      messages.push({
        speaker: item?.from || item?.author || item?.sender || "Unknown",
        timestamp: item?.date || item?.timestamp || null,
        message: text,
        sourceLine: index + 1,
      });
    });
    return messages;
  }

  if (Array.isArray(rawJson?.messages)) {
    rawJson.messages.forEach((item, index) => {
      const text = normalizeTextSegment(item?.text || item?.message || item?.content);
      if (!text) {
        return;
      }
      messages.push({
        speaker: item?.from || item?.author || item?.sender || "Unknown",
        timestamp: item?.date || item?.timestamp || null,
        message: text,
        sourceLine: index + 1,
      });
    });
  }

  return messages;
}

function parseConversationFromBuffer(buffer, extension) {
  const rawText = buffer.toString("utf-8").replace(/^\uFEFF/, "");

  if (extension === "json") {
    const parsedJson = JSON.parse(rawText);
    return parseJsonConversation(parsedJson);
  }

  return parseTextConversation(rawText);
}

function isPreferredChatEntry(entryName) {
  const lower = entryName.toLowerCase();
  return lower.endsWith("result.json") || lower.includes("whatsapp chat");
}

function buildCanonicalText(conversation) {
  return conversation
    .map((item) => {
      const timePrefix = item.timestamp ? `[${item.timestamp}] ` : "";
      return `${timePrefix}${item.speaker}: ${item.message}`;
    })
    .join("\n");
}

function pickBestChatSource(sources) {
  const supported = sources
    .map((item) => ({
      ...item,
      extension: getExtension(item.entryName),
    }))
    .filter((item) => ["txt", "md", "json"].includes(item.extension));

  if (!supported.length) {
    throw new Error("No supported chat file found. Expected .txt, .md, or .json");
  }

  const ranked = supported.sort(
    (a, b) => scoreArchiveEntry(b.entryName, b.extension) - scoreArchiveEntry(a.entryName, a.extension)
  );

  let best = null;

  for (const item of ranked) {
    try {
      const conversation = parseConversationFromBuffer(item.buffer, item.extension);
      if (!conversation.length) {
        continue;
      }

      const candidate = {
        conversation,
        messageCount: conversation.length,
        entryName: item.entryName,
        extension: item.extension,
      };

      if (isPreferredChatEntry(item.entryName)) {
        return candidate;
      }

      if (!best || candidate.messageCount > best.messageCount) {
        best = candidate;
      }
    } catch (error) {
      continue;
    }
  }

  if (!best) {
    throw new Error("Could not parse supported chat content");
  }

  return best;
}

function scoreArchiveEntry(entryName, extension) {
  const lower = entryName.toLowerCase();
  let score = 0;

  if (lower.endsWith("result.json")) {
    score += 200;
  }

  if (lower.includes("whatsapp chat")) {
    score += 180;
  }

  if (extension === "json") {
    score += 80;
  }

  if (extension === "txt") {
    score += 60;
  }

  if (extension === "md") {
    score += 30;
  }

  return score;
}

function parseZipConversation(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const candidates = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => ({
      entryName: entry.entryName,
      buffer: entry.getData(),
    }));

  return pickBestChatSource(candidates);
}

function parseFolderConversation(files) {
  if (!Array.isArray(files) || !files.length) {
    throw new Error("No folder files uploaded");
  }

  const candidates = files.map((file) => ({
    entryName: file.originalname,
    buffer: file.buffer,
  }));

  return pickBestChatSource(candidates);
}

function resolveFolderName(files) {
  const firstName = files[0]?.originalname || "folder-upload";
  const normalized = firstName.replace(/\\/g, "/");
  const root = normalized.split("/")[0]?.trim();
  return root || "folder-upload";
}

export function parseUploadedFile(file) {
  if (!file) {
    throw new Error("No file uploaded");
  }

  const extension = getExtension(file.originalname);

  let conversation = [];
  let inputType = "transcript";
  let parsedSourceFile = file.originalname;

  if (extension === "json") {
    inputType = "chat-json";
    conversation = parseConversationFromBuffer(file.buffer, extension);
  } else if (extension === "zip") {
    const zipResult = parseZipConversation(file.buffer);
    conversation = zipResult.conversation;
    parsedSourceFile = zipResult.entryName;
    inputType = zipResult.extension === "json" ? "zip-chat-json" : "zip-chat-text";
  } else {
    inputType = extension === "txt" ? "chat-txt-or-transcript" : "transcript";
    conversation = parseConversationFromBuffer(file.buffer, extension);
  }

  if (!conversation.length) {
    throw new Error("Could not find readable messages in uploaded file");
  }

  const canonicalText = buildCanonicalText(conversation);

  return {
    inputType,
    fileName: file.originalname,
    parsedSourceFile,
    messageCount: conversation.length,
    ingestionId: hashText(`${file.originalname}:${parsedSourceFile}:${canonicalText}`),
    conversation,
    canonicalText,
  };
}

export function parseUploadedFolder(files) {
  const folderResult = parseFolderConversation(files);
  const canonicalText = buildCanonicalText(folderResult.conversation);
  const folderName = resolveFolderName(files);

  return {
    inputType: folderResult.extension === "json" ? "folder-chat-json" : "folder-chat-text",
    fileName: folderName,
    parsedSourceFile: folderResult.entryName,
    messageCount: folderResult.messageCount,
    ingestionId: hashText(`${folderName}:${folderResult.entryName}:${canonicalText}`),
    conversation: folderResult.conversation,
    canonicalText,
  };
}
