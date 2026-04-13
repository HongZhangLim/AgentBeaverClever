import crypto from "crypto";
import QRCode from "qrcode";
import WhatsAppWeb from "whatsapp-web.js";

const { Client, LocalAuth } = WhatsAppWeb;

const SUMMARIZE_COMMAND = "/summarize";
const MAX_BUFFERED_MESSAGES_PER_CHAT = Number(process.env.WHATSAPP_MAX_BUFFERED_MESSAGES || 100);
const messageStore = new Map();

let currentQR = null;
let isConnected = false;
let clientInstance = null;
let serviceInstance = null;

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatCanonicalTimestamp(isoTimestamp) {
  const date = new Date(isoTimestamp || Date.now());

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function buildReviewUrl(webUiBaseUrl, analysisId) {
  const baseUrl = String(webUiBaseUrl || "http://localhost:3000").replace(/\/+$/, "");
  return `${baseUrl}/?analysisId=${encodeURIComponent(analysisId)}`;
}

function resolveChatIdFromMessage(message) {
  const from = typeof message?.from === "string" ? message.from : "";
  const to = typeof message?.to === "string" ? message.to : "";

  if (message?.fromMe && to) {
    return to;
  }

  if (from) {
    return from;
  }

  if (to) {
    return to;
  }

  return "unknown-chat";
}

async function resolveSpeakerNameFromMessage(message, cache) {
  if (message?.fromMe) {
    return "Me";
  }

  const participantId = message?.author || message?.from || "Unknown";
  if (!participantId) {
    return "Unknown";
  }

  if (cache.has(participantId)) {
    return cache.get(participantId);
  }

  try {
    const contact = typeof message?.getContact === "function"
      ? await message.getContact()
      : null;
    const resolvedName =
      normalizeText(contact?.pushname) ||
      normalizeText(contact?.name) ||
      normalizeText(contact?.shortName) ||
      normalizeText(contact?.number) ||
      String(participantId);

    cache.set(participantId, resolvedName);
    return resolvedName;
  } catch {
    const fallbackName = String(participantId);
    cache.set(participantId, fallbackName);
    return fallbackName;
  }
}

function isStorableTextMessage(message, text) {
  if (!message) {
    return false;
  }

  if (message.type && message.type !== "chat") {
    return false;
  }

  if (message.isStatus) {
    return false;
  }

  if (!text) {
    return false;
  }

  return true;
}

function getOrCreateChatStore(chatId) {
  if (!messageStore.has(chatId)) {
    messageStore.set(chatId, []);
  }

  return messageStore.get(chatId);
}

function appendMessageToStore(chatId, item) {
  const store = getOrCreateChatStore(chatId);
  store.push(item);

  if (store.length > MAX_BUFFERED_MESSAGES_PER_CHAT) {
    store.shift();
  }
}

export function getWhatsAppStatus() {
  return {
    isConnected,
    qrCodeUrl: currentQR,
  };
}

export function initializeWhatsAppService({
  extractProjectIntel,
  saveAnalysis,
  webUiBaseUrl = process.env.APP_BASE_URL || process.env.WEB_UI_BASE_URL || "http://localhost:3000",
} = {}) {
  if (typeof extractProjectIntel !== "function" || typeof saveAnalysis !== "function") {
    throw new Error("initializeWhatsAppService requires extractProjectIntel and saveAnalysis functions");
  }

  if (serviceInstance) {
    return serviceInstance;
  }

  const activeSummaries = new Set();
  const speakerNameCache = new Map();

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: process.env.WHATSAPP_CLIENT_ID || "meeting-intel-agent" }),
    puppeteer: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
    webVersionCache: {
      type: "remote",
      remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
    },
  });

  client.on("qr", async (qr) => {
    try {
      currentQR = await QRCode.toDataURL(qr);
      isConnected = false;
      console.log("[WhatsApp] QR code generated. Scan it from the web UI.");
    } catch (error) {
      currentQR = null;
      console.error(`[WhatsApp] Failed to generate QR data URL: ${error?.message || error}`);
    }
  });

  client.on("ready", () => {
    isConnected = true;
    currentQR = null;
    console.log("[WhatsApp] Client connected.");
  });

  client.on("disconnected", (reason) => {
    isConnected = false;
    console.warn(`[WhatsApp] Client disconnected: ${reason || "unknown reason"}`);
  });

  client.on("auth_failure", (message) => {
    isConnected = false;
    console.error(`[WhatsApp] Authentication failure: ${message || "unknown reason"}`);
  });

  client.on("message_create", async (msg) => {
    const text = normalizeText(msg?.body);
    if (!isStorableTextMessage(msg, text)) {
      return;
    }

    const chatId = resolveChatIdFromMessage(msg);

    if (text !== SUMMARIZE_COMMAND) {
      const speaker = await resolveSpeakerNameFromMessage(msg, speakerNameCache);
      appendMessageToStore(chatId, {
        speaker,
        timestamp: new Date().toISOString(),
        message: text,
      });
      return;
    }

    if (activeSummaries.has(chatId)) {
      await msg.reply("A summary is already running for this chat. Please wait.");
      return;
    }

    activeSummaries.add(chatId);

    try {
      const cachedMessages = messageStore.get(chatId) || [];
      if (!cachedMessages.length) {
        await msg.reply("Not enough recent messages cached to summarize.");
        return;
      }

      await msg.reply(`Analyzing ${cachedMessages.length} cached message(s)...`);

      const canonicalText = cachedMessages
        .map((entry) => {
          return `[${formatCanonicalTimestamp(entry.timestamp)}] ${entry.speaker}: ${entry.message}`;
        })
        .join("\n");

      const ingestionId = `whatsapp-${chatId}-${crypto.randomUUID()}`;

      const extracted = await extractProjectIntel({
        canonicalText,
        ingestionId,
      });

      const analysisPayload = {
        ingestionId,
        fileName: `whatsapp-chat-${chatId}.txt`,
        parsedSourceFile: `whatsapp:${chatId}`,
        inputType: "whatsapp-web",
        messageCount: cachedMessages.length,
        tasks: extracted.tasks,
        decisions: extracted.decisions,
        blockers: extracted.blockers,
      };

      const analysisId = saveAnalysis(analysisPayload);
      const reviewUrl = buildReviewUrl(webUiBaseUrl, analysisId);

      await msg.reply(
        `✅ Chat analyzed! Review and execute actions here: ${reviewUrl}`
      );

      messageStore.delete(chatId);
    } catch (error) {
      await msg.reply(`❌ Failed to analyze chat: ${error?.message || "Unknown error"}`);
    } finally {
      activeSummaries.delete(chatId);
    }
  });

  client.initialize().catch((error) => {
    console.error(`[WhatsApp] Failed to initialize client: ${error?.message || error}`);
  });

  clientInstance = client;
  serviceInstance = {
    client,
    stop: async () => {
      if (clientInstance) {
        await clientInstance.destroy().catch(() => {});
      }
      clientInstance = null;
      serviceInstance = null;
      currentQR = null;
      isConnected = false;
      activeSummaries.clear();
      speakerNameCache.clear();
      messageStore.clear();
    },
  };

  return serviceInstance;
}