// Entirely synthetic fixtures. The user's workbook and derived ratings stay private.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import {
  attributeImportSql,
  validateAttributes,
  type AttributeImport,
} from "../scripts/uploaded-attributes";

test("synthetic skills import enforces exact identities/ranges, atomic activation and idempotence", async () => {
  const db = new PGlite();
  const q = async (s: string, a: unknown[] = []) =>
    (await db.query<any>(s, a)).rows;
  try {
    await db.exec(
      "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;insert into auth.users values('10000000-0000-0000-0000-000000000001');select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);",
    );
    for (const n of [
      "001_franchise.sql",
      "20261015214620_mobile_draft_pacing.sql",
      "20261015215105_player_dataset_catalog.sql",
      "20261016022903_franchise_management.sql",
      "20261016034537_uploaded_overall_ratings.sql",
      "20261016112856_lineup_free_agency.sql",
    ])
      await db.exec(await readFile("supabase/migrations/" + n, "utf8"));
    const lid = (
      await q("select create_league('Synthetic import fixture','BAL') id")
    )[0].id;
    const p = (
      await q(
        "select id,attributes,overall from players where dataset='provisional-v1' order by id limit 1",
      )
    )[0];
    const input: AttributeImport = {
      import_id: "synthetic-skills",
      sha256: "a".repeat(64),
      matched_players: 1,
      mapping: { SpeedRating: "speed", ThrowPowerRating: "throw_power" },
      matches: [
        {
          player_id: p.id,
          source_row: 2,
          attributes: { speed: 72, throw_power: 88 },
        },
      ],
    };
    const reviewed = {
      sha256: input.sha256,
      matches: [{ player_id: p.id, source_row: 2 }],
    };
    validateAttributes(input, reviewed);
    assert.throws(
      () =>
        validateAttributes(
          {
            ...input,
            matches: [
              {
                ...input.matches[0],
                attributes: { speed: 100, throw_power: 88 },
              },
            ],
          },
          reviewed,
        ),
      /Invalid/,
    );
    assert.throws(
      () =>
        validateAttributes(
          { ...input, matches: [{ ...input.matches[0], source_row: 3 }] },
          reviewed,
        ),
      /Invalid/,
    );
    await q(
      "insert into overall_imports(id,source_file,sha256,summary,applied_at) values('synthetic-overall','synthetic fixture',$1,'{}',now())",
      [input.sha256],
    );
    await q(
      "insert into overall_import_rows values('synthetic-overall',$1,80,2,'Synthetic Player')",
      [p.id],
    );
    const out = attributeImportSql(input);
    await db.exec(out.setup);
    await assert.rejects(db.exec(out.activate), /Incomplete/);
    await db.exec("rollback");
    assert.deepEqual(
      (await q("select attributes from players where id=$1", [p.id]))[0]
        .attributes,
      p.attributes,
    );
    for (const b of out.batches) await db.exec(b);
    await db.exec(out.activate);
    const updated = (await q("select * from players where id=$1", [p.id]))[0];
    assert.deepEqual(updated.attributes, input.matches[0].attributes);
    assert.equal(updated.overall, p.overall);
    assert.equal(updated.attributes_source, input.import_id);
    assert.deepEqual(
      (
        await q(
          "select profile from league_players where league_id=$1 and player_id=$2",
          [lid, p.id],
        )
      )[0].profile.attributes,
      input.matches[0].attributes,
    );
    const applied = (
      await q("select applied_at from attribute_imports where id=$1", [
        input.import_id,
      ])
    )[0].applied_at;
    await db.exec(out.activate);
    assert.deepEqual(
      (
        await q("select applied_at from attribute_imports where id=$1", [
          input.import_id,
        ])
      )[0].applied_at,
      applied,
    );
    await db.exec("set role authenticated");
    await assert.rejects(
      q("select * from attribute_import_rows"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
