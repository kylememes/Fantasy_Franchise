# Hosted Phase 1 verification

Verified 2026-10-16 against the Fantasy_Franchise Supabase project in us-east-2.

- Applied the franchise schema, Realtime/CPU worker, and draft helper search-path migration.
- Confirmed 32 franchises, the preserved 2,120-player fictional test pool, and the new 2,545-player catalog (2,532 real players plus 13 labeled fictional fullbacks). New leagues default to the NFL catalog with original provisional ratings.
- All application public tables have RLS enabled. API roles cannot execute internal pick/CPU functions.
- Realtime publishes leagues, memberships, and draft picks.
- The CPU worker is active every second with a persisted four-second normal-pick gate; it only selects running/completing leagues.
- A transaction using the authenticated database role passed league creation, waiting-state inactivity, start, CPU tick, pause inactivity, preserved current pick, resume, and snapshot checks. All verification records were rolled back.
- The pure draft helper has an empty fixed search path and still resolves correctly.

Security Advisor findings reviewed:

- `players` intentionally has no client policies or client grants. Leagues receive player snapshots through the guarded creation RPC. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Authenticated SECURITY DEFINER RPCs are intentional: each validates authentication, membership, commissioner authority, invitation possession, or current pick ownership before mutation. Internal helpers are not executable by API roles. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Deployment is live at https://fantasy-franchise-three.vercel.app/ with frontend environment and Auth redirects configured. The refresh was verified with an authenticated-role rollback transaction: 2,545 snapshots, real display names, no automatic start, one CPU pick, immediate second tick blocked, pause blocked, current pick preserved. The existing test league retained all 22 picks.

## Two-session hosted acceptance — 2026-10-16

The result in `docs/multiplayer-acceptance.json` uses two disposable users authenticated through actual Supabase Auth, separate client sessions, real RPC requests and real Realtime subscriptions. Invitation preview/join, synchronized human picks, commissioner-only controls, pause across live cron cycles, and CPU resumption passed. This verifies live Auth/API/Realtime, not two visual browser sessions. The fixture league, accounts and sessions were removed after the check; zero fixture records remained. The existing running league at 22 picks and paused league at 19 picks were preserved.

## Management deployment

Applied `franchise_contract_schema`, `franchise_draft_and_trade_schema` and `franchise_coaching_and_management_rpc` through the migration connector. Its trade-function migration request failed with an expired request-state error; the reviewed `settle_trade`/`propose_trade` definitions and explicit privileges were applied transactionally through direct SQL instead. The repository's combined migration is for fresh installs; do not reapply it to this hosted project.

Existing picks received round-based contracts. Standard draft payroll is $205.25M, leaving $69.75M against the $275M cap. All new application tables have RLS and read-only client grants. Guarded public RPCs are intentionally executable; internal contract, pick-right and trade-settlement functions are not. The existing leaked-password protection advisory remains an Auth configuration item; see [Supabase guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Still required: physical-phone and two-browser visual acceptance of the management screens. Vercel connector requests return 403 for the kylememes scope; Git deployment status and the approved browser fallback are used for release verification.

## Uploaded overall overlay — 2026-10-16

Applied schema `uploaded_overall_ratings`, staged all 2,107 identity matches and activated import `uploaded-ovr-28a6660ca355` atomically. Master and existing NFL snapshot counts both matched. Before/after checksums for draft picks, ownership, attributes/statistics and contracts were identical. Josh Allen and Myles Garrett are 99; Justin Jefferson WR is 94, the separate LB is 67, and Pat Surtain II is 97. The importer is idempotent and future leagues inherit the updated values. The original fictional test league and unmatched estimates were preserved.
