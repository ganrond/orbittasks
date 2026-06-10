# ArcForge — Agent Report

---

## Session: Phase 1 (first run)

---

## Codebase Audit (P1-1)

### How the AI call was made (before fix)

`api/chat.js` proxied to Anthropic's Messages API using SSE streaming:
- Method: `POST https://api.anthropic.com/v1/messages`
- Auth: `x-api-key: ANTHROPIC_API_KEY` header
- Model: `claude-haiku-4-5-20251001`
- Streaming: `stream: true` — returned SSE events
- Response parsed in `app.js` by reading Anthropic event types: `content_block_delta`, `text_delta`, `message_stop`

`app.js` had **four** call sites to `/api/chat`:
1. `sendMessage()` — main chat, sends `{ messages: chatHistory, system: buildSystemPrompt() }`, parsed SSE
2. `scanTasks` — automation/AI skill scan, sends `{ messages, system }`, parsed SSE
3. `breakdownTask` — subtask generation, sends `{ messages, system }`, parsed SSE
4. `autoSuggestPriority` — silent background priority classifier, sends `{ messages, system }`, parsed SSE

### How the sync/load sequence worked on startup

1. **Module level (synchronous):** Load tasks, projects, templates from `localStorage`. Apply defaults if empty. Initialize Supabase client.
2. **`DOMContentLoaded` → `init()` (async):**
   - If Supabase enabled: `await dbLoadAll()` fetches all tables in parallel.
   - If `dbData.projects.length > 0`: replace local state with Supabase data, mirror back to localStorage.
   - If `dbData.projects.length === 0` (Supabase empty): "migrate" — push local data to Supabase (guarded by length checks).
   - If `dbData === null` (error): fall back to localStorage only.
   - Sync settings (theme, pomodoro, checkin, weekly list) from Supabase.
3. After cloud load: `checkRecurringTasks()` → may call `saveAll()` if new recurring tasks are generated.
4. `switchProject(currentProjectId)` → calls `saveAll()` unconditionally.
5. `saveAll()` writes tasks/projects/templates to both localStorage AND Supabase (if enabled).

---

## Sync Bug Diagnosis (P1-2)

### The critical unsafe path

`saveAll()` is called inside `switchProject()`, which is called from `init()` at step 4 (after the `if (dbEnabled)` block). However, `saveAll()` was unconditionally calling `dbSaveTasks/dbSaveProjects` even when the cloud load had failed or returned null.

**Dangerous scenario:**
1. Fresh mobile visit (no localStorage)
2. Supabase `dbLoadAll()` fails silently (network hiccup, RLS mismatch, timeout)
3. `dbData === null` → app falls back to empty local state
4. `checkRecurringTasks()` runs with `tasks = []` → no-op (guard: returns if no recurring tasks)
5. `switchProject()` runs → calls `saveAll()`:
   - `dbSaveTasks([])` → guarded by `!tasksArr.length`, so tasks NOT pushed ✓
   - `dbSaveProjects([{id:'p_default', name:'My Tasks'}])` → NOT guarded — pushes default project!
6. Supabase now has an extra 'p_default' project. On next fresh load, if this causes `dbData.projects.length > 0` to resolve to just 'p_default', tasks from other projects would not match any project ID in the UI.

**Secondary risk:** Any code path calling `saveAll()` during the init window (e.g., if recurring tasks are generated) could write partially-loaded state.

### Fix implemented (P1-3)

Added `let _cloudDataReady = !dbEnabled;` flag:
- `false` by default when Supabase is enabled
- Set to `true` just before `checkRecurringTasks()` in `init()` (after the entire cloud load block)
- `saveAll()` now guards: `if (dbEnabled && _cloudDataReady) { dbSave... }` — no cloud writes during init's loading phase

This means:
- No Supabase writes during startup until the full cloud fetch has been attempted
- After init completes, all user actions (create/edit/delete task) write to Supabase normally
- The flag `_cloudDataReady = !dbEnabled` means offline/no-Supabase mode is unaffected

---

## Changes Made This Session

### P1-3 — Mobile sync bug fix (app.js)
- Added `let _cloudDataReady = !dbEnabled;` after Supabase client init (line ~82)
- Set `_cloudDataReady = true;` in `init()` just before `checkRecurringTasks()` (line ~311)
- Guarded `saveAll()`: changed `if (dbEnabled) { dbSave... }` → `if (dbEnabled && _cloudDataReady) { dbSave... }`

### P1-4 — Switched AI proxy from Anthropic to Google Gemini (api/chat.js)
- Completely rewrote `api/chat.js`:
  - Uses `fetch` to `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GOOGLE_AI_API_KEY}`
  - Accepts `{ messages, system }` (full conversation history) OR `{ message }` (single turn)
  - Maps Anthropic role names to Gemini: `assistant` → `model`
  - Passes `system` as Gemini's `systemInstruction` field
  - Returns simple JSON `{ reply: string }` (no SSE streaming)
  - Uses `GOOGLE_AI_API_KEY` env var (was `ANTHROPIC_API_KEY`)
- Created `.env.local` with `GOOGLE_AI_API_KEY=REPLACE_WITH_YOUR_KEY` placeholder

### P1-5 — Updated all /api/chat call sites in app.js
All four call sites in `app.js` now use simple `await response.json()` instead of SSE stream reading:
1. `sendMessage()` — parses `{ reply }`, renders markdown, handles `ARCFORGE_UPDATES` block
2. `scanTasks` — parses `{ reply }` as JSON for automation/AI skill detection
3. `breakdownTask` — parses `{ reply }` as JSON array for subtasks
4. `autoSuggestPriority` — parses `{ reply }` as JSON object for priority classification

### P1-6 — Service worker check
`service-worker.js` does not exist in the project directory. The PWA manifest exists but there is no service worker implementation. This means:
- No offline caching is occurring (safe — no risk of stale cached data causing sync issues)
- The PWA install prompt may not appear on all browsers without a valid service worker
- **No fix needed for Issue 2** from this angle — the service worker is not the cause of the mobile sync bug

---

## Manual Testing Checklist (Bruno must verify)

1. **GOOGLE_AI_API_KEY — REQUIRED before AI works:**
   - Get a free key at: https://aistudio.google.com/app/apikey (Sign in → "Create API key")
   - Add to Vercel: Dashboard → your project → Settings → Environment Variables → Add `GOOGLE_AI_API_KEY`
   - For local testing: replace `REPLACE_WITH_YOUR_KEY` in `.env.local`

2. **Test AI chat after deploy:**
   - Open the app → click the AI assistant button
   - Type "Hello, summarize my tasks" and confirm a reply appears
   - Test task breakdown: expand a task → click "Break into subtasks with AI"

3. **Test sync on mobile (critical):**
   - Open app on desktop, note current task count
   - On mobile: open the same URL in an incognito/private browser tab (forces no localStorage)
   - Tasks must still be visible (loaded from Supabase)
   - Check Supabase dashboard → table editor after mobile load — task count must be unchanged

4. **Test new task sync:**
   - Create a task on desktop → refresh on mobile → task must appear
   - Create a task on mobile → refresh on desktop → task must appear

5. **PWA install:**
   - No service worker means PWA install may not work on some browsers
   - Chrome on Android may show "Add to Home Screen" anyway due to manifest alone (limited functionality)
   - Adding a service worker is recommended for future work (see Recommendations)

---

## Recommendations (not implemented)

1. **Add a service worker** — even a minimal "cache-busting" one that only caches static assets (HTML, CSS, JS, manifest). This would enable proper PWA install and offline app shell. Do NOT cache any API or Supabase calls.

2. **Supabase row-level security audit** — confirm the anon key allows SELECT/INSERT/UPDATE/DELETE from all devices. If RLS is set to `auth.uid()`, the anon key will return 0 rows on any device that hasn't authenticated.

3. **Error reporting for cloud load failures** — currently `dbData === null` silently falls back to localStorage with just a console.warn. Consider adding a visible warning banner: "Could not load from cloud — showing local data only."

4. **Gemini model upgrade path** — the proxy uses `gemini-1.5-flash`. When Google releases newer models (`gemini-2.0-flash`, etc.), update the model ID in `api/chat.js` to get better responses.

---

## Phase 1 Task Status

- [x] P1-1 — Codebase audit complete (see above)
- [x] P1-2 — Sync bug diagnosed (see above)
- [x] P1-3 — Sync bug fixed (`_cloudDataReady` guard in app.js)
- [x] P1-4 — api/chat.js rewritten for Google Gemini
- [x] P1-5 — All four /api/chat call sites in app.js updated to use JSON
- [x] P1-6 — Service worker checked — does not exist (documented above)

**Phase 1 is complete. Ready to proceed to Phase 2.**

---

## Phase 2 Status

- [ ] P2-1 — AI chat mobile UX (back button)
- [ ] P2-2 — QA: Pomodoro timer
- [ ] P2-3 — QA: Task CRUD
- [ ] P2-4 — QA: Filters and views
- [ ] P2-5 — QA: Recurring tasks
- [ ] P2-6 — QA: Startup console errors
- [ ] P2-7 — Final checklist
