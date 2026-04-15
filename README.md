# Agent Beaver Clever

A deterministic workspace automation tool that extracts tasks from unstructured chats and transcripts, executing them safely via pure JavaScript logic. 

Informal communication often buries deadlines and critical tasks. Agent Beaver Clever eliminates manual administration by parsing unstructured data into structured schemas, instantly automating documentation, permissions, and event scheduling.

## Core Architecture & Philosophy

Built for practicality and reliability, this tool rejects unpredictable orchestration in favor of strict system boundaries:

* **Strict AI Boundaries**: LLMs are leveraged exclusively to process messy data into clean JSON. Once generated, the AI's job is done.
* **Zod JSON Guardrails**: Validates all LLM outputs against predefined schemas to force strict, error-free data generation.
* **Deterministic Execution**: Instead of using native AI function calls, actions are executed via a pure JavaScript orchestrator. This guarantees 100% reliable API execution for specific endpoints.

## Key Features

* **Multi-Platform Ingestion**: Auto-detects Google Meet transcripts from Drive and ingests unstructured group chat histories from WhatsApp and Telegram.
* **Multimodal Processing**: Parses mixed input types including texts, PDFs, and audio messages.
* **Action Extraction**: Categorizes tasks, identifies Persons in Charge (PICs), assigns due dates, and extracts decisions and blockers into predefined JSON schemas.
* **Human Approval Interface**: Extracted data is presented in a clean spreadsheet interface for rapid review before initiating actions.
* **Workspace Integration**: Auto-creates shared Google Docs, Slides, and Sheets. Pushes approved events directly to Google Calendar and attaches generated files for immediate team access.
* **Automated Reminders**: Triggers multi-stage push notifications for critical deadlines


# AgentBeaverClever

Manual upload app that converts meeting transcript or chat exports into structured actions using Gemma, then executes approved actions in Google Calendar.

## Features

- Upload transcript TXT/MD, chat TXT/JSON, or chat export ZIP files
- Upload exported chat folders directly from the browser
- Gemini extraction for tasks, decisions, and blockers
- Human approval before external writes
- Google Sheets task sync with duplicate protection
- Google Calendar event creation for dated tasks

## Quick Start

1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies:
   - `npm install`
3. Run app:
   - `npm start`
4. Open browser at `http://localhost:3000`

## Google Setup

1. Create a Google Cloud project.
2. Enable APIs:
   - Google Calendar API
   - Google Drive API
   - Google Docs API
   - Google Slides API
   - Google Sheets API
3. Configure OAuth consent screen (External, add test users).
4. Create OAuth Client ID (Web application).
5. Add Authorised JavaScript Origins:
   - `http://localhost:3000`
6. Add Authorised redirect URIs:
   - `http://localhost:3000/auth/google/callback`
7. Add email as test users in `Audience`

## Input Formats

### Transcript TXT/MD
Free-form text is accepted. Basic speaker extraction works on common patterns:
- `Name: message`
- `[date, time] Name: message`
- `YYYY-MM-DD HH:mm - Name: message`

### Chat JSON
Supports Telegram-like exports with `messages` array and generic arrays of objects with message text fields.

### ZIP Chat Export
Supports archive uploads and auto-detects the best chat source file inside the ZIP:
- WhatsApp export ZIP with `WhatsApp Chat with ....txt`
- Telegram export ZIP with `result.json`
- Generic ZIP containing `.txt`, `.md`, or `.json` chat files

### Folder Upload
Supports selecting an exported chat folder directly in the browser:
- The frontend only sends `.txt`, `.md`, and `.json` files from that folder
- The backend auto-picks the best candidate file, preferring `result.json` and WhatsApp chat text exports
- Media files are ignored for analysis

## Sample Data

This repo includes ready-to-use sample folders for quick verification:
- `sample-whatsapp-productivity/`
- `sample-telegram-productivity/`

Use the app's **Analyze Folder** button and select either folder.

## Validation Command

To validate parser behavior from terminal:

```bash
node --input-type=module -e "import fs from 'fs'; import path from 'path'; import { parseUploadedFolder } from './src/services/parserService.js'; const supported = new Set(['.txt','.md','.json']); function buildFolderPayload(rootDir){ const files=[]; const rootName=path.basename(rootDir); function walk(dir){ for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) { walk(full); continue; } const ext = path.extname(entry.name).toLowerCase(); if (!supported.has(ext)) { continue; } const relative = path.relative(rootDir, full).replace(/\\/g, '/'); files.push({ originalname: rootName + '/' + relative, buffer: fs.readFileSync(full) }); } } walk(rootDir); return files; } const folders=['./sample-whatsapp-productivity','./sample-telegram-productivity']; for (const folder of folders){ const payload=buildFolderPayload(folder); const result=parseUploadedFolder(payload); console.log(folder, JSON.stringify({ inputType: result.inputType, parsedSourceFile: result.parsedSourceFile, messageCount: result.messageCount })); }"
```

## End-User Guide

### Demo Flow

1. Connect Google account.
2. Upload transcript/chat file (TXT, JSON, ZIP) or upload a chat export folder.
3. Review extracted tasks.
4. Select tasks and execute to Google Calendar.
5. Open links from execution results.

### Team Shared Folder Setup

1. Accept the invite to the shared Google Drive folder.
2. Connect Google Drive and explicitly set the save location to this shared folder.

## Notes

- This is a focused MVP for speed and reliability.
- Idempotency is based on deterministic action IDs to reduce duplicate writes.
