# AgentBeaverClever

Manual upload app that converts meeting transcript or chat exports into structured actions using Gemini, then executes approved actions in Google Sheets and Google Calendar.

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
   - Google Sheets API
   - Google Calendar API
3. Configure OAuth consent screen (External, add test users).
4. Create OAuth Client ID (Web application).
5. Add redirect URI:
   - `http://localhost:3000/auth/google/callback`

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
4. Select tasks and execute to Sheets and/or Calendar.
5. Open links from execution results.

### Team Shared Folder Setup

1. Accept the invite to the shared Google Drive folder.
2. Go to your personal Tactiq settings.
3. Connect Google Drive and explicitly set the save location to this shared folder.

## Notes

- This is a focused MVP for speed and reliability.
- Idempotency is based on deterministic action IDs to reduce duplicate writes.
