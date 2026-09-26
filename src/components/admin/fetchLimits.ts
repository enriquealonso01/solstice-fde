/**
 * How much the admin screens fetch, and whether they should admit it.
 *
 * A leaf module on purpose. These two values belong to `useAdminData`, but that file imports the
 * Supabase client, which calls `createClient(import.meta.env.VITE_SUPABASE_URL, ...)` at module scope
 * and throws `supabaseUrl is required` when the variable is empty. In this working tree
 * `vite.config.ts` fills it from `.env`, so a test that imported `useAdminData` loaded fine — and the
 * same test failed to collect at all in a fresh clone of the public repo, where there is no `.env`.
 * Found at iteration 112 by running the suite the way a reviewer does.
 *
 * Keeping them here means the guard can assert them without dragging a browser client into a Node
 * test, which it never needed.
 */

/**
 * How many session rows the supervisor grid fetches.
 *
 * This was 100, and on 2026-09-26 that emptied the Archive. Nothing closes a chat session on the web --
 * there is no hangup event the way there is on a call -- so `active` rows accumulate with every test
 * conversation anyone runs. The table held 180 sessions: 155 active, 23 ended, 2 taken over. The newest
 * 100 by `started_at` were *all* active, so the page fetched 100 rows, found no `ended` row among them,
 * and rendered "Archived 0" and the empty state "No ended sessions yet" while 23 ended conversations sat
 * in the database.
 *
 * The screen was not lying about the rows it had; it was drawing a conclusion from a window it never said
 * it had applied. The Archive is a beat in `docs/demo-runbook.md`.
 *
 * `npm run demo:tidy` is the operational cure and stays the cure -- it closes anything idle for 30
 * minutes, or whatever `--minutes` says -- but the Archive should not be one skipped command away from
 * reading as empty. So the window is wide enough to hold the whole demo dataset several times over, and
 * when it *is* full the page says so instead of quietly showing a slice.
 */
export const SESSION_FETCH_LIMIT = 500

/** True when the grid is showing a window rather than everything, so it can say so. */
export const sessionViewIsTruncated = (fetched: number) => fetched >= SESSION_FETCH_LIMIT
