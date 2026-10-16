# Lineups, skills and free agency

Owners open **Roster** for their offense, defense and special-team cards, depth editor, contracts and free agency. Cards show current OVR separately from development: red Franchise Superstar, gold Superstar, silver Star, bronze Normal. Original jersey artwork avoids requiring portrait assets. Mobile uses a position selector and large starter card rather than a shrunken field.

## Persistent lineup model

`depth_positions` defines eligibility. `depth_charts` stores ordered player IDs per group and an optimistic version, keyed by league/franchise. Offense displays 11 personnel; defense displays a base 4–3. All backups, fullbacks and third cornerbacks remain accessible in the editor; the coaching engine will choose personnel packages in a later phase. Special teams exposes K, P, KR and PR. Returners may also start in another unit. EDGE combines EDGE and DE; other primary positions remain exact.

`effective_depth` removes departed players, preserves manual ranking, then appends newly eligible roster members by overall (return rating for returners), breaking ties by ID. Ownership changes invalidate saved-editor versions and repair stored rankings. No player can occupy two ranks within one group. `save_depth_order` locks the league, verifies membership, version, eligibility and complete unique ownership before saving. The future simulation engine must read effective orders; there is no game engine yet.

## Workbook attributes

`scripts/extract-uploaded-attributes.py` verifies the workbook SHA256 and reuses the reviewed overall row/player identity map. It extracts 53 explicitly mapped numeric skills, excluding string running style, salary, biography and IDs. The private audit artifacts are generated under ignored `supabase/.temp/attributes`; `scripts/uploaded-attributes.ts` validates and generates private staging/activation SQL.

Matched players receive exact numeric skills. The full attributes object is replaced to remove ambiguous original aggregate estimates such as `pass_rush` and `route_running`. Distinct power/finesse moves and short/medium/deep routes are retained separately for the future engine. Unmatched players keep original estimates. Overalls, player IDs, statistics, draft history, contracts, ownership and draft state are preserved. Activation is atomic, checks staged count/identity, locks affected leagues and is idempotent. New leagues inherit imported master profiles.

The workbook contains no development traits. Previously Unrevealed NFL game traits receive a deterministic, original game assignment once, considering current ability, age and an ID hash. This is labeled `ff-game-assigned-v1`, separate from rating provenance. Existing revealed traits are preserved; this assignment is not an official Madden trait or a progression engine.

## Free agency rules

- Opens only after fantasy draft completion; one-year deals at the displayed asking price.
- Asking bands: 97+ $30M; 94–96 $20M; 90–93 $12M; 85–89 $7M; 80–84 $4M; 75–79 $2M; 70–74 $1.25M; under 70 $750K.
- A previously drafted player's asking price cannot fall below their original draft-round salary. Releasing/re-signing cannot erase that salary floor.
- Signings require available ownership, a fresh price, cap room and fewer than 60 roster players. Releases require ownership, a fresh contract, at least 46 remaining players and every existing position's minimum starter coverage.
- Equal annual cap hits; releases remove the full contract with no dead money in this simplified model. No extensions, contract bidding, guarantees or CPU autonomous free agency in this increment.
- League lock serializes sign, release, draft, lineup and trade actions. One claim wins concurrent requests. Contracts and ownership change atomically; release expires pending offers involving the player. Transactions and league events persist. Original draft picks remain historical.

## Verification

Local PGlite tests cover schema, real workbook mapping, atomic/idempotent import, preserved leagues, ownership/version/eligibility, sign/release/cap/roster and trade-driven lineup repair. React interaction tests cover lineup promotion, refresh, failed saves, confirmation and stale availability. PostgreSQL CI verifies simultaneous free-agent claims in separate transactions alongside existing draft/trade races. Hosted acceptance uses disposable Auth sessions and a dedicated fixture league, removed after verification.

The detailed ratings dataset is deliberately excluded from GitHub. CI runs synthetic importer validation; the full private import preservation test runs locally when the private extracted dataset is present.
