import crypto from "crypto";

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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

function parseTextConversation(rawText) {
  const lines = rawText.split(/\r?\n/);
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

export function parseUploadedFile(file) {
  if (!file) {
    throw new Error("No file uploaded");
  }

  const extension = file.originalname.split(".").pop()?.toLowerCase();
  const rawText = file.buffer.toString("utf-8");

  let conversation = [];
  let inputType = "transcript";

  if (extension === "json") {
    inputType = "chat-json";
    const parsedJson = JSON.parse(rawText);
    conversation = parseJsonConversation(parsedJson);
  } else {
    inputType = extension === "txt" ? "chat-txt-or-transcript" : "transcript";
    conversation = parseTextConversation(rawText);
  }

  if (!conversation.length) {
    throw new Error("Could not find readable messages in uploaded file");
  }

  const canonicalText = conversation
    .map((item) => {
      const timePrefix = item.timestamp ? `[${item.timestamp}] ` : "";
      return `${timePrefix}${item.speaker}: ${item.message}`;
    })
    .join("\n");

  return {
    inputType,
    fileName: file.originalname,
    messageCount: conversation.length,
    ingestionId: hashText(`${file.originalname}:${canonicalText}`),
    conversation,
    canonicalText,
  };
}
