# Fantasy Franchise

**Draft Your Team. Build Your Dynasty.**

Next.js / React / TypeScript · Supabase Auth / PostgreSQL / Realtime · Vercel

## Phase 1 implementation

- Email/password accounts, private leagues, invitation links and 32 NFL franchise identities.
- One human owner per franchise; other teams are CPU controlled. Independent leagues and player snapshots.
- Persistent randomized snake order, commissioner start/pause/resume, unlimited human pick time.
- Round 15 checkpoint: only the commissioner authorizes rounds 16–53. Pausing also stops roster completion.
- Atomic selections, stale-request rejection, per-league player uniqueness, authorization and RLS isolation.
- Searchable draft room, position/rating/age/salary filters, player profiles, confirmation, private queue, round board, roster needs and activity.
- Needs-aware CPU roster completion and durable database worker, plus Realtime notifications with polling recovery.
- Original plum/coral/mint identity, NFL logos and mobile draft cards with explicit selection controls. Future-phase controls are explicitly unavailable.

**Data:** New leagues use an attributed nflverse 2026 snapshot with 2,532 real players, original provisional ratings/game contracts, and 13 explicitly fictional fullback depth reserves. Existing test leagues keep their original pool and picks. No EA database is scraped or included. See `docs/DATA_SOURCES.md` for provenance, limitations and the authorized Madden import workflow.

## Architecture before implementation

See [Architecture and phased plan](docs/ARCHITECTURE.md) for schema, boundaries, draft state transitions, concurrency model and later phases. The authoritative backend is PostgreSQL RPC, not browser state. The frontend never receives a service-role key.

## Connect the backend

Use a **new dedicated Supabase project**. Do not run these migrations against FLG or Coastlyne.

1. Apply `supabase/migrations/001_franchise.sql` through Supabase migrations or the SQL editor, as project database owner.
2. Enable `pg_cron` in Database → Extensions. Apply `002_realtime_worker.sql` once. This initially registers a 5-second CPU job and publishes league, membership and pick changes. A Supabase PostgreSQL version supporting second-based cron intervals is required. Apply the remaining migration files in filename order; the pacing migration changes the worker check to once per second and enforces a four-second server-side gap between normal CPU picks.
3. Set the two values from `.env.example` in Vercel, and in `.env.local` for local work:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable/anon key, never service-role)
4. For the real-player catalog, follow the import/activation instructions in `docs/DATA_SOURCES.md`. Until activation, new installs use the clearly fictional test pool.
5. Enable email/password authentication. Set Supabase Auth Site URL to the application URL and configure confirmation redirect URLs for the deployed origin and local development. Keep email confirmation enabled for production; use your provider's email delivery setup.
6. Link Vercel to `kylememes/Fantasy_Franchise` using the Next.js preset. Add both variables to intended environments and deploy. No Vercel Cron or paid external job service is needed for this phase.
7. Verify the two-user acceptance checklist below before using a live league.

The app intentionally shows a backend-connection message when the public Supabase configuration is missing. It never substitutes browser-only storage for shared league state.

## Local commands

Use Node 22 or later. After project linking and environment setup:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

`npm test` runs the real SQL migration in isolated, disk-persisted PGlite PostgreSQL with mocked Auth identities. It checks a complete 53-round draft, permissions, invitation rotation, private queues, ownership conflicts, all 1,696 unique picks, 32 complete rosters, positional coverage, pause/checkpoint rules, stale requests, and database restart recovery.

The separate concurrency suite runs only when `TEST_DATABASE_URL` points at an **empty disposable PostgreSQL database**; it creates test roles/tables and must never target production. GitHub Actions supplies PostgreSQL 17 for concurrent pick requests, simultaneous workers and pause lock ordering. Local PGlite tests do not prove network concurrency or Supabase Auth/Realtime behavior.

## Two-user deployed acceptance checklist

- Create and verify two accounts in separate browser sessions; create a league and join the invitation with a different available team.
- Confirm the second user cannot see/copy the commissioner-only invitation or start, pause or resume the draft.
- Start as commissioner; verify CPU picks update both browsers and stop on human owners indefinitely.
- Queue a player; verify another owner cannot read that queue. Open a profile and confirm a pick; verify both rosters/boards update.
- Send two competing pick requests with the same expected revision; only one must succeed.
- Pause while CPU picks are running. Once pause confirms, verify pick count remains unchanged, including after closing both browsers and returning later.
- Resume, finish 15 rounds, and verify no automatic transition past pick 480. Authorize completion, pause/resume it, and verify all 32 rosters have 53 players.
- Rotate the invitation and verify the old token fails. Verify joining after draft start fails.
- Test desktop, a narrow mobile viewport, keyboard navigation and dialog focus.
- Check `cron.job_run_details` for successful CPU job runs with no spectators online. Results must persist across a Vercel redeploy.

## Operational notes

The pause guarantee is transactional: an in-flight CPU batch (one pick during the initial draft, or at most eight during roster completion) can finish before pause acquires the league lock. After pause commits, further picks cannot commit until explicit resume. No human draft timer exists. CPU jobs operate on saved state and never resume a paused league.

Position limits are enforced even for human picks to guarantee every completed 53-player roster can fill its positions. HB is represented as RB. Scouting/development details and salaries are provisional metadata; cap negotiations, trades, coaching, simulation, seasons and history remain Phases 2–5.

Supabase project backups are managed separately from source control. Do not reset the live database or reapply the initial migration on deployment. Source deployments do not recreate leagues.

## Verification status

- Local production build and TypeScript checks: passed.
- Local full-draft SQL integration suite and restart test: passed.
- Real PostgreSQL concurrency suite: configured in CI; see workflow results for status.
- Hosted schema, dataset import, authenticated RPC rollback checks, worker and initial deployment: passed. Two-user browser Auth/Realtime acceptance remains pending; see `docs/HOSTED_VERIFICATION.md`.

References: [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart), [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
