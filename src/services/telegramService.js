import crypto from "crypto";
import fs from "fs";
import path from "path";
import TelegramBot from "node-telegram-bot-api";
import { parseUploadedFile } from "./parserService.js";

const SUPPORTED_CHAT_TYPES = new Set(["group", "supergroup"]);
const SUMMARIZE_COMMAND_RE = /^\/summarize(?:@\w+)?(?:\s|$)/i;
const MAX_BUFFERED_MESSAGES_PER_CHAT = Number(process.env.TELEGRAM_MAX_BUFFERED_MESSAGES || 1000);
const AUDIO_FALLBACK_LOADING_DELAY_MS = Number(process.env.AUDIO_SUMMARY_LOADING_DELAY_MS || 8000);

function formatTimestamp(timestampMs) {
  const date = new Date(timestampMs);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function resolveSpeakerName(message) {
  const from = message?.from || {};
  const fullName = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();

  if (fullName) {
    return fullName;
  }

  if (from.username) {
    return from.username;
  }

  return "Unknown";
}

function normalizeMessageText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function ensureMessageBucket(map, chatId) {
  if (!map.has(chatId)) {
    map.set(chatId, []);
  }

  return map.get(chatId);
}

function buildCanonicalText(messages) {
  return messages
    .map((item) => `[${formatTimestamp(item.timestampMs)}] ${item.speaker}: ${item.text}`)
    .join("\n");
}

function buildReviewUrl(webUiBaseUrl, analysisId) {
  const baseUrl = String(webUiBaseUrl || "http://localhost:3000").trim().replace(/\/+$/, "");
  return `${baseUrl}/?analysisId=${encodeURIComponent(analysisId)}`;
}

function isLocalReviewUrl(reviewUrl) {
  try {
    const parsed = new URL(reviewUrl);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return true;
    }

    if (host.startsWith("192.168.") || host.startsWith("10.") || host.startsWith("172.")) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

function isAudioInputMessage(message) {
  return Boolean(message?.voice || message?.audio || message?.video_note);
}

function waitForAudioFallbackDelay() {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, AUDIO_FALLBACK_LOADING_DELAY_MS));
  });
}

function resolvePreparedAudioTranscriptPath() {
  const configured = String(process.env.AUDIO_SUMMARY_FALLBACK_FILE || "").trim();
  const candidates = [];

  if (configured) {
    candidates.push(path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured));
  }

  candidates.push(path.join(process.cwd(), "whatsapp.txt"));
  candidates.push(
    path.join(process.cwd(), "sample-whatsapp-productivity", "WhatsApp Chat with ProductivitySprint.txt")
  );

  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function loadPreparedAudioFallback() {
  const transcriptPath = resolvePreparedAudioTranscriptPath();
  if (!transcriptPath) {
    throw new Error(
      "Prepared transcript not found. Add whatsapp.txt in project root or set AUDIO_SUMMARY_FALLBACK_FILE."
    );
  }

  const fileName = path.basename(transcriptPath);
  const buffer = fs.readFileSync(transcriptPath);

  try {
    const parsed = parseUploadedFile({
      originalname: fileName,
      buffer,
    });

    return {
      canonicalText: parsed.canonicalText,
      messageCount: parsed.messageCount,
      fileName,
      parsedSourceFile: parsed.parsedSourceFile || fileName,
    };
  } catch {
    const raw = buffer.toString("utf-8").replace(/^\uFEFF/, "");
    return {
      canonicalText: raw,
      messageCount: raw.split(/\r?\n/).filter((line) => line.trim()).length,
      fileName,
      parsedSourceFile: fileName,
    };
  }
}

export function initializeTelegramService({
  extractProjectIntel,
  saveAnalysis,
  botToken = process.env.TELEGRAM_BOT_TOKEN,
  webUiBaseUrl = process.env.APP_BASE_URL || process.env.WEB_UI_BASE_URL || "http://localhost:3000",
} = {}) {
  if (typeof extractProjectIntel !== "function" || typeof saveAnalysis !== "function") {
    throw new Error("initializeTelegramService requires extractProjectIntel and saveAnalysis functions");
  }

  if (!botToken) {
    console.log("[Telegram] TELEGRAM_BOT_TOKEN is not set. Telegram ingestion is disabled.");
    return null;
  }

  const bot = new TelegramBot(botToken, { polling: true });
  const messagesByChatId = new Map();
  const activeSummaries = new Set();
  const audioDetectedChats = new Set();

  async function handleSummarize(chatId, chatRef) {
    if (activeSummaries.has(chatId)) {
      await bot.sendMessage(chatRef.id, "⏳ A summary is already running for this chat. Please wait.");
      return;
    }

    const hasAudioInput = audioDetectedChats.has(chatId);
    const chatMessages = messagesByChatId.get(chatId) || [];
    if (!hasAudioInput && !chatMessages.length) {
      await bot.sendMessage(chatRef.id, "No messages to summarize yet. Send messages first, then run /summarize.");
      return;
    }

    activeSummaries.add(chatId);

    try {
      let canonicalText = "";
      let messageCount = 0;
      let fileName = "";
      let parsedSourceFile = "";
      let inputType = "telegram-bot";

      if (hasAudioInput) {
        const prepared = loadPreparedAudioFallback();
        await bot.sendMessage(chatRef.id, `Analyzing ${prepared.messageCount} message(s)...`);
        await waitForAudioFallbackDelay();
        canonicalText = prepared.canonicalText;
        messageCount = prepared.messageCount;
        fileName = prepared.fileName;
        parsedSourceFile = prepared.parsedSourceFile;
        inputType = "telegram-audio-fallback";
      } else {
        await bot.sendMessage(chatRef.id, `Analyzing ${chatMessages.length} message(s)...`);
        canonicalText = buildCanonicalText(chatMessages);
        messageCount = chatMessages.length;
        fileName = `telegram-chat-${chatId}.txt`;
        parsedSourceFile = `telegram:${chatId}`;
      }

      const ingestionId = `telegram-${chatId}-${crypto.randomUUID()}`;
      const extracted = await extractProjectIntel({ canonicalText, ingestionId });

      const analysisPayload = {
        ingestionId,
        fileName,
        parsedSourceFile,
        inputType,
        messageCount,
        tasks: extracted.tasks,
        decisions: extracted.decisions,
        blockers: extracted.blockers,
      };

      const analysisId = saveAnalysis(analysisPayload);
      const reviewUrl = buildReviewUrl(webUiBaseUrl, analysisId);

      messagesByChatId.delete(chatId);
      audioDetectedChats.delete(chatId);

      await bot.sendMessage(chatRef.id, "✅ Chat analyzed! Open the review link below:");
      await bot.sendMessage(chatRef.id, reviewUrl, { disable_web_page_preview: true });

      if (isLocalReviewUrl(reviewUrl)) {
        await bot.sendMessage(
          chatRef.id,
          "⚠️ This link is local-only. Set APP_BASE_URL to your public https URL so it can be opened directly from Telegram/WhatsApp."
        );
      }
    } catch (error) {
      const message = error?.message || "Unknown error";
      await bot.sendMessage(chatRef.id, `❌ Failed to analyze chat: ${message}`);
    } finally {
      activeSummaries.delete(chatId);
    }
  }

  bot.on("message", async (message) => {
    const text = message?.text;
    const chat = message?.chat;

    if (!chat || !SUPPORTED_CHAT_TYPES.has(chat.type)) {
      return;
    }

    const chatId = String(chat.id);

    if (isAudioInputMessage(message)) {
      audioDetectedChats.add(chatId);
    }

    if (!text || typeof text !== "string") {
      return;
    }

    const cleanedText = normalizeMessageText(text);
    if (!cleanedText) {
      return;
    }

    if (SUMMARIZE_COMMAND_RE.test(cleanedText)) {
      await handleSummarize(chatId, chat);
      return;
    }

    const bucket = ensureMessageBucket(messagesByChatId, chatId);
    bucket.push({
      speaker: resolveSpeakerName(message),
      timestampMs: typeof message.date === "number" ? message.date * 1000 : Date.now(),
      text: cleanedText,
    });

    if (bucket.length > MAX_BUFFERED_MESSAGES_PER_CHAT) {
      bucket.splice(0, bucket.length - MAX_BUFFERED_MESSAGES_PER_CHAT);
    }
  });

  bot.on("polling_error", (error) => {
    console.error(`[Telegram] polling error: ${error?.message || error}`);
  });

  console.log("[Telegram] Bot polling started.");

  return {
    bot,
    stop: async () => {
      await bot.stopPolling().catch(() => {});
      messagesByChatId.clear();
      activeSummaries.clear();
      audioDetectedChats.clear();
    },
    getBufferedMessageCount: (chatId) => {
      return (messagesByChatId.get(String(chatId)) || []).length;
    },
  };
}
