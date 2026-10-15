# Hosted Phase 1 verification

Verified 2026-10-15 against the Fantasy_Franchise Supabase project in us-east-2.

- Applied the franchise schema, Realtime/CPU worker, and draft helper search-path migration.
- Confirmed 32 franchises and 2,120 explicitly fictional provisional players.
- All 10 public tables have RLS enabled. API roles cannot execute internal pick/CPU functions.
- Realtime publishes leagues, memberships, and draft picks.
- The CPU worker is active every five seconds; it only selects running/completing leagues.
- A transaction using the authenticated database role passed league creation, waiting-state inactivity, start, CPU tick, pause inactivity, preserved current pick, resume, and snapshot checks. All verification records were rolled back.
- The pure draft helper has an empty fixed search path and still resolves correctly.

Security Advisor findings reviewed:

- `players` intentionally has no client policies or client grants. Leagues receive player snapshots through the guarded creation RPC. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Authenticated SECURITY DEFINER RPCs are intentional: each validates authentication, membership, commissioner authority, invitation possession, or current pick ownership before mutation. Internal helpers are not executable by API roles. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Still required before launch: hosting access, frontend environment configuration, Auth redirect configuration, and two-browser Auth/Realtime acceptance testing. Vercel connector requests currently return 403 for the kylememes scope. This is a database-level verification, not a claim of hosted browser end-to-end completion.
