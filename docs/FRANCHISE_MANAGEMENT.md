# Franchise management increment

## Model and rules before implementation

- Keep draft history immutable; current ownership lives in league_players. Trades never rewrite the draft board. All mutations acquire the league lock first, then validate current membership, assets and cap.
- Draft contracts are assigned from a versioned 53-round scale, identical for all selections in a round. Existing picks are backfilled without changing ownership. Contracts travel with players. Yearly cap hit equals annual salary initially, with no bonuses or dead money. Rounds 1–5: five years; 6–10: four; 11–15: three; 16–35: two; 36–53: one. $275M cap leaves $69.75M beyond the standard draft payroll.
- Commissioner explicitly confirms full simulation. It enters completing mode from any unfinished state and bypasses human turns and the round-15 checkpoint. Pause remains authoritative; resume preserves the chosen mode. Existing standard drafts retain their checkpoint and unlimited human time.
- Trade offers contain players and future rookie picks, with immutable proposal assets. Submission is the proposing human's acceptance. Another human must accept their incoming offer. CPU evaluation requires positive compensation, fair aggregate value and protection against packaging low-value pieces for a star. Rejection explains the cause. Settlement rechecks ownership, season, roster eligibility and cap under the league lock. Duplicate settlement returns the existing result.
- Rookie pick rights are generated lazily for three future seasons. Each original team/season/round is unique. No inaugural fantasy picks are traded. Trades unlock after draft completion. Completed teams must retain every position, at most 60 players, and remain below the cap.
- Coaching preferences belong to league+franchise, saved by its owner through a guarded RPC. Explicit whitelisted scheme and integer 0–100 sliders; optimistic version checks prevent lost updates. Settings are preparation for the later simulation engine, not claims of active game behavior.
- New tables use RLS and read-only client grants; mutations use guarded RPCs. A management snapshot contains current ownership, contracts, pick rights, offers and coaching, synchronized by league revision/Realtime plus polling recovery.

## Ratings

MaddenRatings.com is the requested reference. Its About page describes ratings as reference-only; no bulk reuse license was found. Do not scrape/repackage its database. Authorized import tooling remains available, preserving dataset provenance. The existing original estimates remain labeled until an authorized export is supplied. Football box-score statistics remain separate from skill ratings.

## Verification and release

SQL integration covers round boundaries, salary equality, full simulation crossing round 15, pause/resume, unauthorized actions, human acceptance, CPU rejection/acceptance, stale assets, cap checks, pick ownership and coaching conflicts. Add UI flow tests and production build. Hosted additive migration and authenticated checks precede release. Two-user acceptance uses actual Auth sessions and Realtime; browser UI checks are reported separately.

Validation: local suite (13 passed, PostgreSQL-only suite skipped locally), production build, full 1,696-pick simulation, trade UI/SQL and coaching conflict checks passed. Actual hosted two-session Auth/Realtime acceptance passed; disposable fixtures were removed. Real PostgreSQL concurrency release checks run in CI.
