import crypto from "crypto";
import TelegramBot from "node-telegram-bot-api";

const SUPPORTED_CHAT_TYPES = new Set(["group", "supergroup"]);
const SUMMARIZE_COMMAND_RE = /^\/summarize(?:@\w+)?(?:\s|$)/i;
const MAX_BUFFERED_MESSAGES_PER_CHAT = Number(process.env.TELEGRAM_MAX_BUFFERED_MESSAGES || 1000);

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
  const baseUrl = String(webUiBaseUrl || "http://localhost:3000").replace(/\/+$/, "");
  return `${baseUrl}/?analysisId=${encodeURIComponent(analysisId)}`;
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

  async function handleSummarize(chatId, chatRef) {
    if (activeSummaries.has(chatId)) {
      await bot.sendMessage(chatRef.id, "⏳ A summary is already running for this chat. Please wait.");
      return;
    }

    const chatMessages = messagesByChatId.get(chatId) || [];
    if (!chatMessages.length) {
      await bot.sendMessage(chatRef.id, "No messages to summarize yet. Send messages first, then run /summarize.");
      return;
    }

    activeSummaries.add(chatId);

    try {
      await bot.sendMessage(chatRef.id, `Analyzing ${chatMessages.length} message(s)...`);

      const ingestionId = `telegram-${chatId}-${crypto.randomUUID()}`;
      const canonicalText = buildCanonicalText(chatMessages);
      const extracted = await extractProjectIntel({ canonicalText, ingestionId });

      const analysisPayload = {
        ingestionId,
        fileName: `telegram-chat-${chatId}.txt`,
        parsedSourceFile: `telegram:${chatId}`,
        inputType: "telegram-bot",
        messageCount: chatMessages.length,
        tasks: extracted.tasks,
        decisions: extracted.decisions,
        blockers: extracted.blockers,
      };

      const analysisId = saveAnalysis(analysisPayload);
      const reviewUrl = buildReviewUrl(webUiBaseUrl, analysisId);

      messagesByChatId.delete(chatId);

      await bot.sendMessage(
        chatRef.id,
        `✅ Chat analyzed! Review and execute actions here: ${reviewUrl}`
      );
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

    if (!text || typeof text !== "string") {
      return;
    }

    const cleanedText = normalizeMessageText(text);
    if (!cleanedText) {
      return;
    }

    const chatId = String(chat.id);

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
    },
    getBufferedMessageCount: (chatId) => {
      return (messagesByChatId.get(String(chatId)) || []).length;
    },
  };
}
