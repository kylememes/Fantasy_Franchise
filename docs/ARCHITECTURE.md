# Fantasy Franchise architecture

## Scope and phases

1. **Current deliverable:** accounts, private leagues, invitations, team ownership, versioned provisional player pool, persistent snake draft, queue, roster needs, commissioner control, CPU completion, multiplayer integrity tests.
2. Rosters/depth charts, cap ledger, contracts, trades and coaching. Trades atomically transfer assets under league lock and validate cap ledger entries.
3. Seeded, versioned pure simulation engine: personnel + tactics + situation -> immutable play events, statistics and results. Store engine version, seed and roster/strategy snapshots. Unique (league, season, week, matchup) prevents double simulation.
4. Canvas renderer consumes saved event timelines; playback time is browser-local and cannot modify results. Standard plays contain 22 identified players, trajectories and ball events.
5. Schedule/standings/playoffs, scouting, rookie picks, cap rollover and attribute-specific development. Phase transitions run as durable idempotent jobs with checkpoints.
6. Multi-season balance, load, mobile and recovery verification. Later phases are not represented by fake functional controls.

## Boundaries

Next.js App Router + React/TypeScript on Vercel. Supabase Auth supplies signed user identity; PostgreSQL owns authorization and all draft mutations in SECURITY DEFINER functions with fixed search_path. Browser reads use RLS. No service-role key in browsers. Supabase Realtime notifies clients; periodic refetch repairs missed events. Database cron executes short CPU batches independently of spectators. Authenticated league members can also nudge the same safe worker for fast progression. PostgreSQL is the durable queue; every transaction checks the current state under a league row lock.

## Data model

`franchises`: 32 identity records. `players`: immutable versioned seed catalog with provenance, attributes and provisional contracts. `leagues`: commissioner, invite token, phase, ordered franchise IDs, next pick, revision. `memberships`: one team per user per league, one owner per franchise. `league_players`: league-specific copies of source player data, mutable franchise assignment. `draft_picks`: unique league/pick and league/player. `draft_queue`: private ordered user selections. `league_events`: append-only action log. League-scoped foreign keys and RLS enforce isolation. Invitations are random unguessable tokens, readable only by commissioner; join is a checked RPC, with team selection locked at draft start. Members may join only while waiting; commissioner may remove other owners before start or rotate invitation any time.

## Draft state machine

`waiting --commissioner start--> running --480 picks--> awaiting_completion --commissioner complete--> completing --1696 picks--> completed`
`running/completing --commissioner pause--> paused --commissioner resume--> previous running state`
No automatic start, resume, or completion authorization. All 32 franchises reverse order on alternate rounds; 53 total rounds fill 53-player rosters. Initial order is shuffled once inside league creation. Human picks have no timeout. First 15 rounds are human-selected where owned; beyond that every franchise is CPU-selected. Every pick carries expected pick and revision to reject stale submissions, including submissions created before a pause/resume cycle. A CPU batch is bounded; a pause serializes behind an in-flight transaction. Once pause commits, no later pick can commit until explicit resume. Worker retries find current state, never replay an earlier pick.

## CPU selection

Deterministic score combines provisional OVR, age, positional need, scarcity and annual salary. Maximum position allocations sum to 53; pool contains enough players at every position for all franchises. Human picks also respect these roster limits so completion can always fill a valid template. CPU prioritizes starters then depth. No proprietary EA database is bundled. Generated fictional pool is conspicuously labeled testing-only; a future data importer must require documented provenance for authorized real-player datasets.

## Security and verification

RLS hides leagues from outsiders, invitations from non-commissioners, queues from other owners. Clients cannot directly mutate league state or assignments. All callable mutation functions check auth.uid(), membership and commissioner rights as appropriate. Realtime exposes no invitation tokens. SQL integration tests execute actual migration functions with three user identities, test duplicate submission handling, pause/restart, authorization, league isolation, all 53 rounds, uniqueness and positional coverage. Separate PostgreSQL CI tests exercise real concurrent connections and pause/pick lock ordering. Production Supabase Auth/Realtime and deployed browser verification require configured Supabase and Vercel resources; do not claim these verified from local tests.
