# Trade desk

The builder presents two franchises with searchable, position-filtered rosters, future rookie picks and selected player cards. Cards reuse the existing portraits, development badges and attribute/stat backs; contracts show annual salary and remaining years. The impact summary is salary-only: salary sent, salary received, net annual change, and remaining cap space. No trade block or depth-impact dashboard is included.

Estimated value considers ability, position, age, development, annual salary, remaining contract years and future picks. Local estimates keep the comparison responsive. Authenticated `trade_preview` responses supply the authoritative values, CPU feedback and interest once a package is checked. The red-to-green 0–100 interest score is not an acceptance probability: 75+ represents an interested CPU on the current valid package. Human owners never receive a CPU interest meter. Invalid packages show zero interest. Old asynchronous responses cannot replace a newer package's evaluation.

`evaluate_trade_internal` drives both previews and actual proposals. It checks current ownership, future pick eligibility, duplicate/size limits, salary caps, roster limits and required positions, while CPU evaluation considers total value, useful upgrades and protection against weak bundles for high-value players. A preview never creates an offer. Submission runs the evaluator again while holding the league lock. Human acceptance retains the existing settlement function and depth-chart repair; no saved game or original player rating is rewritten.

Incoming, Sent and Completed views group each negotiation around its latest offer. Original offers remain in the negotiation history. Countering or revising creates a linked offer and supersedes a pending parent in one transaction; building a draft does not withdraw anything. A resolved or stale parent cannot silently be countered. Existing historical offers keep their stored values. CPU outcomes open the Completed view; human proposals open Sent.

Unread badges count pending incoming offers not yet opened by the current owner. Authenticated read receipts persist across devices and remain private to that owner. Ownership and league membership guard every new RPC. Internal helpers are not executable by client roles. The snapshot wrapper preserves previous management fields and adds only human-team IDs and unread offer IDs.

The partner finder ranks roster fits for an offered player, requested position or both. It can seed the builder but never submits or guarantees a deal. It does not publish a trade block.

Validation covers SQL/JavaScript valuation agreement, low/high CPU interest and actual outcomes, human-only decisions, salary and eligibility blocks, atomic counter replacement and rollback, superseded/stale acceptance, per-user read isolation, saved depth repair, player-card rendering, salary-only display, stale preview suppression, failure retention, inbox actions and partner suggestions.
