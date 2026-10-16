# Coach specialties and player cards

All 32 head coaches have original game-assigned specialties. These are gameplay choices, not official evaluations, licensed coach ratings, or guarantees about real people. Each coach offers one +2 specialty and one +1 specialty. A pass-rush specialty applies to both power and finesse moves so either rushing style benefits. Coordinators remain cosmetic.

Human owners hire available coaches directly. CPU franchises leave head-coach positions vacant through Preseason Week 1, then fill vacancies from the remaining coaches in the commissioner's Week 2 advancement transaction, before CPU game inputs freeze. CPU preferences consider saved scheme identity with deterministic tie-breaking. Existing human hires and completed game results are preserved. Owners may replace staff; changes affect future kickoffs, never a queued or saved game.

The database computes effective game attributes from the source profile, exact position eligibility, existing attribute aliases and an overall fallback for unavailable attributes. Each attribute caps at 99. The roster's original ratings and overall do not change. Player card previews use the same definitions and are tested against database output for every coach. Badges and card backs show actual applied deltas, including a smaller increase when capped. Cards prioritize position-relevant attributes and statistics. Missing blocking or kicking statistics are shown as unavailable rather than invented.

New frozen inputs carry coach_bonus_version 1 and use football engine V2. Inputs frozen before this update keep V1 behavior; a deterministic regression test verifies an existing input's exact result hash. The worker's commit function validates engine version against frozen inputs.

## Superstar player headshots

All 111 current real players tagged Superstar or Franchise Superstar are matched by exact nflverse GSIS ID and roster name across positions. ESPN IDs identify 87 photos; official NFL roster headshot URLs cover the remaining 24 offensive linemen. Card eligibility is checked on every render: eligible development tiers only, never fictional players. Lower tiers, missing identities and failed image loads use the existing silhouette. Photo lookup uses a shared identity index.

Images are displayed from ESPN's public headshot CDN or the official NFL image CDN, loaded lazily without sending the league URL as a referrer. No image files are copied into this repository. data/player-headshots.json records identities, photo providers, public image URLs and the roster metadata source. Every URL was checked for a successful image response on the recorded verification date. This records provenance and technical availability; it does not claim that nflverse's data license grants rights to third-party photographs. The source can be disabled or replaced independently of player identity and ratings.

Validation includes position filtering, capped boosts, no base-profile mutation, exact identity matching, photo error fallback, shared hiring conflicts, human-first timing, CPU hire uniqueness/idempotence, frozen input stability, and legacy simulation compatibility.
