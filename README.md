# Schedly

Schedly is a meeting-memory workspace for contacts, meeting preparation, post-meeting notes, commitments and grounded AI contact history.

## What changed in this build

- **No demo/sample data ships with the app.** New workspaces start empty.
- Contacts can be **created, edited and deleted**. All fields entered during contact creation remain editable.
- Contacts, meetings and commitments are persisted in the browser so user-entered data remains available after reloads.
- **AI Contact Memory** uses a searchable contact picker instead of a contact dropdown.
- AI questions and meeting briefs receive the selected contact's stored profile, previous interaction history, meetings and commitments in addition to Hindsight recall.
- Temporary Hindsight outages no longer block the AI completely when the browser has the contact's stored history.
- Meeting Notes accepts **PDF / Word (.pdf, .doc, .docx)** transcripts and **MP4** recordings.
- PDF/Word content is converted to text before AI extraction.
- MP4 recordings are converted to speech with FFmpeg and transcribed with **Groq Whisper**.
- The extraction result includes a **meeting summary, discussion points, commitments/deadlines and follow-ups**.
- A meeting can be added directly from the **Post-meeting memory update** box.
- The extraction panel sits beside the post-meeting form on desktop, matching the supplied reference layout.
- **Voice Prep** uses browser speech recognition for voice commands and browser speech synthesis for reading the meeting brief.

## Run it

```bash
npm install
cp .env.example .env
# add GROQ_API_KEY and HINDSIGHT_BASE_URL
# add HINDSIGHT_API_KEY when using Hindsight Cloud
npm start
```

Open `http://localhost:3000`.

### Environment

- `GROQ_API_KEY` — required for AI briefs, AI Contact Memory, document extraction and MP4 transcription.
- `GROQ_MODEL` — optional, defaults to `openai/gpt-oss-120b`.
- `GROQ_FALLBACK_MODEL` — optional, defaults to `qwen/qwen3-32b`.
- `GROQ_WHISPER_MODEL` — optional, defaults to `whisper-large-v3-turbo`.
- `HINDSIGHT_BASE_URL` — use `https://api.hindsight.vectorize.io` for Hindsight Cloud or the base URL of a local Hindsight server.
- `HINDSIGHT_API_KEY` — required for Hindsight Cloud.
- `HINDSIGHT_BANK_PREFIX` — optional, defaults to `schedly`.
- `MAX_UPLOAD_MB` — optional, defaults to 100.

The server keeps API keys out of the browser.

## File processing

For Word and PDF files, the server uses system document converters (`pdftotext`, `antiword`, and `unzip`). For MP4 files it uses `ffmpeg` to extract mono 16 kHz audio before sending the audio to Groq Whisper.

On a Linux/macOS server, install the corresponding command-line tools if they are not already present. On Windows, use equivalent installations and make sure `pdftotext`, `antiword`, `unzip` and `ffmpeg` are available on `PATH`.

The browser only stores the user's contact/meeting/task workspace locally. Meeting memory is also mirrored to Hindsight when the live server is configured.

## Privacy / recording

The app requires an explicit consent checkbox before an MP4 recording is uploaded for transcription. The recording is processed on the configured server and is not stored as a permanent uploaded file by Schedly; the temporary server file is removed after transcription.

## Notes

`npm run seed` is intentionally a no-op because this release does not include sample/demo people or meetings.


## Troubleshooting: `ERR_MODULE_NOT_FOUND` for `dotenv`

If Node reports `Cannot find package 'dotenv'`, install the project dependencies from the folder containing `package.json`:

```powershell
npm install
npm start
```

The server now also loads `.env` using Node's built-in file APIs, so the `dotenv` import itself is no longer required. The other packages (Express, Multer and Groq SDK) still must be installed with `npm install`. Make sure you run commands from the project folder that contains `package.json`, not its parent folder.
