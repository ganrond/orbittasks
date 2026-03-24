# Lessons Learned — ArcForge Session 2026-03-23

## 1. Never suggest `saveAll()` in the console without knowing the data state

**What happened:** All tasks in Supabase were `archived: true`. The suggestion to run `saveAll()` locked that broken state permanently into Supabase, making it impossible to recover the original task distribution.

**Rule:** Before suggesting any console command that calls `saveAll()`, `dbSaveTasks()`, or any write to Supabase, first inspect the data state with read-only commands.

---

## 2. Bumping the SW cache version forces a fresh Supabase load — warn the user first

**What happened:** Changing the service worker cache name (`orbit-tasks-v1` → `arcforge-v2`) forced the browser to discard its localStorage cache and reload fresh from Supabase. The Supabase data was out of sync with localStorage (all tasks archived), which exposed the inconsistency and made tasks disappear.

**Rule:** Before bumping the SW cache version, warn the user that their browser will reload fresh from Supabase. If Supabase and localStorage might be out of sync, investigate first.

---

## 3. localStorage is the source of truth until Supabase is confirmed correct

**What happened:** The app mirrors Supabase data into localStorage on load. Because localStorage had correct (non-archived) tasks and Supabase had all-archived tasks, the app appeared to work fine — until the SW change forced a Supabase reload and overwrote localStorage with the bad Supabase data.

**Rule:** Never assume Supabase = localStorage. Before any change that forces a Supabase reload, verify Supabase data is consistent with what the user sees.

---

## 4. Take the backup BEFORE deploying any changes, not during

**What happened:** The backup was created partway through the session, after some files had already been modified. It captured an intermediate state, not the clean pre-session state.

**Rule:** Always take a full backup as the very first step, before any file is touched.

---

## 5. Diagnostic console commands must be read-only — never run `saveAll()` as part of debugging

**What happened:** During debugging, a console command that included `saveAll()` was suggested to "unarchive" tasks. This permanently modified Supabase, and the data could not be undone without a paid Supabase plan.

**Rule:** Diagnostic commands = read-only only. Never combine data inspection with data writes. If a fix is needed, explain it clearly and confirm with the user before executing.

---

## 6. The service worker can cache a broken state of the app

**What happened:** After the SW was added, it cached `app.js`. Subsequent deploys updated `app.js` but the SW served the cached (older) version, so debug logs added in a new commit never appeared in the browser.

**Rule:** When adding or modifying a service worker, bump the cache version name on every deploy that changes JS files. Or tell the user to open an incognito window to bypass cache.

---

## 7. Do not suggest irreversible data operations without a confirmed recovery path

**What happened:** Tasks were deleted/archived from Supabase with no way to recover them (free plan = no Point-in-Time Recovery). The user lost tasks from Agency, YouTube, SaaS, and House projects permanently.

**Rule:** Before any destructive operation on Supabase data, confirm: (a) is there a backup? (b) is there a recovery path? If neither, do not proceed.
