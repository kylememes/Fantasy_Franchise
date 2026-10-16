# Player data and artwork

## NFL roster snapshot

`data/nfl-2026-manifest.json` records the source URLs, snapshot date, attribution and limitations. `data/nfl-2026-pool.json` contains 2,532 real players and 13 explicitly fictional fullback reserves. The source pool includes active, reserve/injured and practice players; it is not a promise of current active-roster status. Names, biographies and 2026 box-score data come from [nflverse](https://github.com/nflverse/nflverse-data), published under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The upstream license is included in `data/NFLVERSE_LICENSE.md`.

Fantasy Franchise changes the source into a draft pool, infers LT/RT and LG/RG from generic T/G assignments, maps OLB to EDGE, and generates **original provisional** 0–99 ratings and game contracts. This simple status/experience/box-score model is experimental. Athletic, blocking and other skill attributes are estimates, not measured scouting grades. Development is unscouted. No source is represented as official EA ratings, real contracts or complete career statistics. All generated reserves are marked `is_fictional=true`.

Rebuild from the exact source CSVs with `python scripts/build-nfl-pool.py ROSTERS.csv STATS.csv 2026-10-15`. Generate validated SQL batches with `node --import tsx scripts/pool-sql.ts`. The administrator imports them into a non-default dataset, checks positional coverage and uniqueness, and only then activates the default. Existing league snapshots and accepted picks are immutable with respect to dataset updates. Create a new league to use the current pool. Existing test leagues keep their saved player snapshots. The catalog retains a separate display name so different real people with identical names can coexist while preserving legacy uniqueness constraints.

For a fresh database, register the non-default catalog before importing the generated batches:

```sql
insert into public.player_datasets(id,label,source_url,license,rating_source,effective_date,metadata)
values ('nflverse-2026-original-v1','NFL 2026 roster · original provisional ratings',
'https://github.com/nflverse/nflverse-data','CC BY 4.0','ff-original-v1','2026-10-15',
'{"real_players":2532,"fictional_reserves":13,"not_ea_ratings":true}')
on conflict (id) do nothing;
```

After importing every file in `supabase/.temp/pool`, activate atomically only if all counts pass:

```sql
begin;
do $$ begin
 if (select count(*) from public.players where dataset='nflverse-2026-original-v1') <> 2545
 or exists(select 1 from public.position_limits l where
 (select count(*) from public.players p where p.dataset='nflverse-2026-original-v1' and p.position=l.position)<32*l.maximum)
 then raise exception 'Incomplete player pool'; end if;
end $$;
update public.player_datasets set is_default=false where is_default;
update public.player_datasets set is_default=true where id='nflverse-2026-original-v1';
commit;
```

## Requested ratings reference

The user selected https://www.maddenratings.com/ as the preferred overall/attribute reference on 2026-10-15. Its [About](https://www.maddenratings.com/about) page describes the data as reference-only; its [Terms](https://www.maddenratings.com/terms) do not supply a bulk game-redistribution license. No ratings from that site were imported. Current estimates remain explicitly labeled. An authorized export can use the existing importer with provider `MaddenRatings.com`, the exact edition/update, and an actual permission reference. Source football statistics are separate from game skill ratings.

## Authorized Madden ratings

No EA database is scraped, bundled or redistributed. EA's [Madden 27 ratings page](https://www.ea.com/games/madden-nfl/ratings) is a reference, not an import license. Before using an EA dataset, obtain authorization covering the intended reproduction and distribution. `scripts/authorized-ratings.ts` accepts an authorized JSON export and a permission manifest, matches nflverse/GSIS external IDs, validates attributes and creates a separate versioned dataset. It never overwrites an existing league.

Ratings format:
```json
[{"external_id":"GSIS_PLAYER_ID","overall":85,"attributes":{"throw_power":90,"short_accuracy":85}}]
```

Permission manifest format (populate from actual authorization, never inferred from public access):
```json
{"provider":"EA","edition":"Madden 27","permission_reference":"ACTUAL_LICENSE_REFERENCE","redistribution_authorized":true}
```

Usage: `node --import tsx scripts/authorized-ratings.ts RATINGS.json PERMISSION.json OUTPUT.json`. Players absent from a partial export retain their original provenance and estimates. This command validates the supplied attestation; it does not establish that legal permission exists. Review the source authorization before publishing a resulting pool.

## Team artwork

The 32 team logos are cached locally from ESPN URLs supplied by nflverse's `teams_colors_logos.csv`; exact URLs are in `data/team-logo-sources.json`. NFL/team marks belong to their respective owners; the data license does not transfer trademark rights. The app uses them to identify teams and does not claim NFL, NFLPA or EA endorsement. The Fantasy Franchise crest is original SVG artwork.

## Draft pacing

The database stores the next permitted CPU-pick timestamp. Normal CPU picks occur at most once every four seconds, even with many clients and workers. Each commit and commissioner start/resume resets the wait. Roster auto-completion after round 15 uses bounded batches of eight once per second. Pause stops both paths. No human timer exists.
