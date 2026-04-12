# AgentBeaverClever

Manual upload app that converts meeting transcript or chat exports into structured actions using Gemini, then executes approved actions in Google Sheets and Google Calendar.

## Features

- Upload transcript TXT/MD or chat TXT/JSON files
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

## Demo Flow

1. Connect Google account.
2. Upload transcript/chat file.
3. Review extracted tasks.
4. Select tasks and execute to Sheets and/or Calendar.
5. Open links from execution results.

## Notes

- This is a focused MVP for speed and reliability.
- Idempotency is based on deterministic action IDs to reduce duplicate writes.
