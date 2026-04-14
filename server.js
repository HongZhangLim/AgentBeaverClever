import "dotenv/config";
import express from "express";
import multer from "multer";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";

import { parseUploadedFile, parseUploadedFolder } from "./src/services/parserService.js";
import { extractProjectIntel } from "./src/services/geminiService.js";
import {
  buildOAuthClient,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  getAuthedClient,
} from "./src/services/googleAuthService.js";
import {
  syncTasksToSheet,
  createCalendarEvents,
} from "./src/services/googleActionsService.js";
import { saveAnalysis, getAnalysis, getLatestAnalysis } from "./src/store/analysisStore.js";
import { initializeTelegramService } from "./src/services/telegramService.js";
import {
  initializeWhatsAppService,
  getWhatsAppStatus,
} from "./src/services/whatsappService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";

app.use(express.json({ limit: "2mb" }));
app.set("trust proxy", 1);
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-session-secret",
    proxy: true,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
    },
  })
);

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get("/api/auth-status", (req, res) => {
  const connected = Boolean(req.session.googleTokens?.refresh_token);
  res.json({ connected });
});

app.get("/auth/google/start", (req, res, next) => {
  try {
    const oauthClient = buildOAuthClient();
    const url = getAuthorizationUrl(oauthClient);
    res.redirect(url);
  } catch (error) {
    next(error);
  }
});

app.get("/auth/google/callback", async (req, res, next) => {
  try {
    const code = req.query.code;
    if (!code) {
      return res.status(400).send("Missing OAuth code");
    }

    const oauthClient = buildOAuthClient();
    const tokens = await exchangeCodeForTokens(oauthClient, code);

    req.session.googleTokens = {
      ...tokens,
      refresh_token: tokens.refresh_token,
    };

    req.session.calendarEventMap = req.session.calendarEventMap || {};

    res.redirect("/?connected=1");
  } catch (error) {
    next(error);
  }
});

app.post("/auth/google/disconnect", async (req, res) => {
  req.session.googleTokens = null;
  req.session.calendarEventMap = {};
  res.json({ ok: true });
});

async function analyzeParsedInput(parsed) {
  const extracted = await extractProjectIntel({
    canonicalText: parsed.canonicalText,
    ingestionId: parsed.ingestionId,
  });

  const analysisPayload = {
    ingestionId: parsed.ingestionId,
    fileName: parsed.fileName,
    parsedSourceFile: parsed.parsedSourceFile,
    inputType: parsed.inputType,
    messageCount: parsed.messageCount,
    tasks: extracted.tasks,
    decisions: extracted.decisions,
    blockers: extracted.blockers,
  };

  const analysisId = saveAnalysis(analysisPayload);

  return {
    analysisId,
    fileName: parsed.fileName,
    parsedSourceFile: parsed.parsedSourceFile,
    inputType: parsed.inputType,
    messageCount: parsed.messageCount,
    tasks: extracted.tasks,
    decisions: extracted.decisions,
    blockers: extracted.blockers,
  };
}

app.post("/api/upload-analyze", upload.single("file"), async (req, res, next) => {
  try {
    const parsed = parseUploadedFile(req.file);
    const response = await analyzeParsedInput(parsed);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/upload-analyze-folder", upload.array("files", 400), async (req, res, next) => {
  try {
    const parsed = parseUploadedFolder(req.files || []);
    const response = await analyzeParsedInput(parsed);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/webhooks/meeting", async (req, res, next) => {
  try {
    const payload = req.body || {};
    const transcript = typeof payload.transcript === "string" ? payload.transcript.trim() : "";
    const incomingFileName =
      payload.fileName ||
      payload.filename ||
      payload.sourceFileName ||
      payload.source ||
      "";
    const fileName = typeof incomingFileName === "string" ? incomingFileName.trim() : "";

    if (!transcript) {
      return res.status(400).json({ error: "No transcript provided" });
    }

    const ingestionId = `webhook-${Date.now()}`;

    const extracted = await extractProjectIntel({
      canonicalText: transcript,
      ingestionId,
    });

    const analysisId = saveAnalysis({
      ingestionId,
      fileName: fileName || "Automated Meeting",
      inputType: "webhook-meeting",
      tasks: extracted.tasks,
      decisions: extracted.decisions,
      blockers: extracted.blockers,
    });

    console.log(`[Webhook] Processed meeting: ${analysisId}`);
    res.json({ ok: true, analysisId });
  } catch (error) {
    console.error("[Webhook Error]:", error.message);
    next(error);
  }
});

app.get("/api/analysis/:analysisId", (req, res) => {
  const analysisId = req.params.analysisId;
  const analysis = getAnalysis(analysisId);

  if (!analysis) {
    return res.status(404).json({ error: "Analysis not found" });
  }

  res.json({
    analysisId,
    ...analysis,
  });
});

app.get("/api/analyses/latest", (req, res) => {
  const latestAnalysis = getLatestAnalysis();

  if (!latestAnalysis) {
    return res.status(404).json({ error: "No recent meetings found." });
  }

  res.json(latestAnalysis);
});

app.get("/api/whatsapp/status", (req, res) => {
  res.json(getWhatsAppStatus());
});

app.post("/api/actions/execute", async (req, res, next) => {
  try {
    const tokens = req.session.googleTokens;
    if (!tokens?.refresh_token) {
      return res.status(401).json({ error: "Google account not connected" });
    }

    const { analysisId, tasks, options } = req.body || {};
    const analysis = getAnalysis(analysisId);
    if (!analysis) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    const approvedTasks = Array.isArray(tasks) && tasks.length
      ? tasks.map((editedTask, editedIndex) => {
          const parsedSourceIndex = Number.parseInt(String(editedTask.sourceIndex), 10);
          const hasSourceIndex = Number.isInteger(parsedSourceIndex) && parsedSourceIndex >= 0;

          const baseTask =
            (analysis.tasks || []).find(
              (sourceTask) => sourceTask.id && editedTask.id && sourceTask.id === editedTask.id
            ) ||
            (hasSourceIndex ? analysis.tasks?.[parsedSourceIndex] : null) ||
            {};

          const mergedTask = {
            ...baseTask,
            ...editedTask,
            id: editedTask.id || baseTask.id || `generated-${editedIndex}`,
          };

          delete mergedTask.sourceIndex;

          return mergedTask;
        })
      : analysis.tasks;
    if (!approvedTasks.length) {
      return res.status(400).json({ error: "No approved tasks selected" });
    }

    const { oauthClient, refreshedTokens } = await getAuthedClient(tokens);
    req.session.googleTokens = refreshedTokens;

    const runOptions = {
      toSheets: Boolean(options?.toSheets),
      toCalendar: Boolean(options?.toCalendar),
      spreadsheetId: options?.spreadsheetId || "",
      sheetName: options?.sheetName || "Tasks",
      calendarId: options?.calendarId || "primary",
    };

    const results = {
      sheets: null,
      calendar: null,
    };

    if (runOptions.toSheets) {
      results.sheets = await syncTasksToSheet(oauthClient, approvedTasks, {
        spreadsheetId: runOptions.spreadsheetId,
        sheetName: runOptions.sheetName,
      });
    }

    if (runOptions.toCalendar) {
      req.session.calendarEventMap = req.session.calendarEventMap || {};
      results.calendar = await createCalendarEvents(
        oauthClient,
        approvedTasks,
        { calendarId: runOptions.calendarId },
        req.session.calendarEventMap
      );
    }

    res.json({
      ok: true,
      analysisId,
      executedTaskCount: approvedTasks.length,
      results,
    });
  } catch (error) {
    next(error);
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  const message = err.message || "Unknown error";
  const status = message.toLowerCase().includes("oauth") ? 400 : 500;
  res.status(status).json({ error: message });
});

const telegramService = initializeTelegramService({
  extractProjectIntel,
  saveAnalysis,
  webUiBaseUrl: process.env.APP_BASE_URL || `http://localhost:${port}`,
});

const whatsappService = initializeWhatsAppService({
  extractProjectIntel,
  saveAnalysis,
  webUiBaseUrl: process.env.APP_BASE_URL || `http://localhost:${port}`,
});

async function shutdown() {
  if (whatsappService?.stop) {
    await whatsappService.stop();
  }

  if (telegramService?.stop) {
    await telegramService.stop();
  }
}

process.once("SIGINT", () => {
  shutdown().finally(() => process.exit(0));
});

process.once("SIGTERM", () => {
  shutdown().finally(() => process.exit(0));
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
