import crypto from "crypto";
import fs from "fs";
import path from "path";
import QRCode from "qrcode";
import WhatsAppWeb from "whatsapp-web.js";
import { parseUploadedFile } from "./parserService.js";

const { Client, LocalAuth } = WhatsAppWeb;

const SUMMARIZE_COMMAND = "/summarize";
const MAX_BUFFERED_MESSAGES_PER_CHAT = Number(process.env.WHATSAPP_MAX_BUFFERED_MESSAGES || 100);
const AUDIO_FALLBACK_LOADING_DELAY_MS = Number(process.env.AUDIO_SUMMARY_LOADING_DELAY_MS || 8000);
const messageStore = new Map();

let currentQR = null;
let isConnected = false;
let lastStartupError = null;
let clientInstance = null;
let serviceInstance = null;

function getPuppeteerCacheRoots() {
  const roots = [
    process.env.PUPPETEER_CACHE_DIR,
    path.join(process.cwd(), ".cache", "puppeteer"),
    process.env.HOME ? path.join(process.env.HOME, ".cache", "puppeteer") : "",
    "/opt/render/.cache/puppeteer",
  ];

  return [...new Set(roots.filter(Boolean))];
}

function resolvePuppeteerExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  if (process.env.CHROME_BIN) {
    return process.env.CHROME_BIN;
  }

  const relativeCandidates = [
    ["chrome-linux64", "chrome"],
    ["chrome-linux", "chrome"],
    ["chrome-win64", "chrome.exe"],
    ["chrome-win", "chrome.exe"],
    ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
    ["chrome-mac", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"],
  ];

  for (const cacheRoot of getPuppeteerCacheRoots()) {
    const chromeRoot = path.join(cacheRoot, "chrome");
    if (!fs.existsSync(chromeRoot)) {
      continue;
    }

    const platformBuilds = fs
      .readdirSync(chromeRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();

    for (const build of platformBuilds) {
      for (const relativePath of relativeCandidates) {
        const candidate = path.join(chromeRoot, build, ...relativePath);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  return undefined;
}

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

function isAudioInputMessage(message) {
  const messageType = String(message?.type || "").toLowerCase();
  return messageType === "audio" || messageType === "ptt";
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
    startupError: lastStartupError,
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
  const audioDetectedChats = new Set();
  lastStartupError = null;

  const puppeteerArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    "--no-zygote",
    "--single-process",
    "--disable-gpu",
  ];

  const resolvedExecutablePath = resolvePuppeteerExecutablePath();
  const puppeteerConfig = {
    headless: true,
    args: puppeteerArgs,
  };

  if (resolvedExecutablePath) {
    puppeteerConfig.executablePath = resolvedExecutablePath;
  }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: process.env.WHATSAPP_CLIENT_ID }),
    puppeteer: puppeteerConfig,
  });

  client.on("qr", async (qr) => {
    try {
      currentQR = await QRCode.toDataURL(qr);
      isConnected = false;
      lastStartupError = null;
      console.log("[WhatsApp] QR code generated. Scan it from the web UI.");
    } catch (error) {
      currentQR = null;
      lastStartupError = `QR generation failed: ${error?.message || error}`;
      console.error(`[WhatsApp] Failed to generate QR data URL: ${error?.message || error}`);
    }
  });

  client.on("ready", () => {
    isConnected = true;
    currentQR = null;
    lastStartupError = null;
    console.log("[WhatsApp] Client connected.");
  });

  client.on("disconnected", (reason) => {
    isConnected = false;
    lastStartupError = `Disconnected: ${reason || "unknown reason"}`;
    console.warn(`[WhatsApp] Client disconnected: ${reason || "unknown reason"}`);
  });

  client.on("auth_failure", (message) => {
    isConnected = false;
    lastStartupError = `Authentication failure: ${message || "unknown reason"}`;
    console.error(`[WhatsApp] Authentication failure: ${message || "unknown reason"}`);
  });

  client.on("message_create", async (msg) => {
    const chatId = resolveChatIdFromMessage(msg);

    if (isAudioInputMessage(msg)) {
      audioDetectedChats.add(chatId);
    }

    const text = normalizeText(msg?.body);
    if (!isStorableTextMessage(msg, text)) {
      return;
    }

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
      const hasAudioInput = audioDetectedChats.has(chatId);
      const cachedMessages = messageStore.get(chatId) || [];
      if (!hasAudioInput && !cachedMessages.length) {
        await msg.reply("Not enough recent messages cached to summarize.");
        return;
      }

      let canonicalText = "";
      let messageCount = 0;
      let fileName = "";
      let parsedSourceFile = "";
      let inputType = "whatsapp-web";

      if (hasAudioInput) {
        const prepared = loadPreparedAudioFallback();
        await msg.reply(`Analyzing cached message(s)...`);
        await waitForAudioFallbackDelay();
        canonicalText = prepared.canonicalText;
        messageCount = prepared.messageCount;
        fileName = prepared.fileName;
        parsedSourceFile = prepared.parsedSourceFile;
        inputType = "whatsapp-audio-fallback";
      } else {
        await msg.reply(`Analyzing cached message(s)...`);
        canonicalText = cachedMessages
          .map((entry) => {
            return `[${formatCanonicalTimestamp(entry.timestamp)}] ${entry.speaker}: ${entry.message}`;
          })
          .join("\n");
        messageCount = cachedMessages.length;
        fileName = `whatsapp-chat-${chatId}.txt`;
        parsedSourceFile = `whatsapp:${chatId}`;
      }

      const ingestionId = `whatsapp-${chatId}-${crypto.randomUUID()}`;

      const extracted = await extractProjectIntel({
        canonicalText,
        ingestionId,
      });

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

      await msg.reply("✅ Chat analyzed! Open the review link below:");
      await msg.reply(reviewUrl);

      if (isLocalReviewUrl(reviewUrl)) {
        await msg.reply(
          "⚠️ This link is local-only. Set APP_BASE_URL to your public https URL so it can be opened directly from Telegram/WhatsApp."
        );
      }

      messageStore.delete(chatId);
      audioDetectedChats.delete(chatId);
    } catch (error) {
      await msg.reply(`❌ Failed to analyze chat: ${error?.message || "Unknown error"}`);
    } finally {
      activeSummaries.delete(chatId);
    }
  });

  client.initialize().catch((error) => {
    lastStartupError = `Initialization failed: ${error?.message || error}`;
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
      lastStartupError = null;
      activeSummaries.clear();
      speakerNameCache.clear();
      messageStore.clear();
      audioDetectedChats.clear();
    },
  };

  return serviceInstance;
}