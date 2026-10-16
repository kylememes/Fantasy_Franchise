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

Still required before launch: two-browser Auth/Realtime acceptance testing and visual verification of the updated deployment.  Vercel connector requests currently return 403 for the kylememes scope. This is a database-level verification, not a claim of hosted browser end-to-end completion.
