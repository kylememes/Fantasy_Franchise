import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { simulateGame, type GameInput } from "../_shared/simulation.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "POST required" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!,
      key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await req.json();
    let actor: string | null = null;
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ticket =
      typeof body.ticket === "string" && uuid.test(body.ticket)
        ? body.ticket
        : null;
    if (!ticket) {
      const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
      if (!jwt) return reply({ error: "Sign in required" }, 401);
      const { data, error } = await admin.auth.getUser(jwt);
      if (error || !data.user) return reply({ error: "Invalid session" }, 401);
      actor = data.user.id;
      if (typeof body.league_id !== "string" || !uuid.test(body.league_id))
        return reply({ error: "League required" }, 400);
    }
    const { data: jobs, error } = await admin.rpc("claim_simulations", {
      p_lid: ticket ? null : body.league_id,
      p_actor: actor,
      p_ticket: ticket,
      p_gid:
        !ticket && typeof body.game_id === "string" && uuid.test(body.game_id)
          ? body.game_id
          : null,
    });
    if (error) return reply({ error: "Worker access denied" }, 403);
    let processed = 0;
    for (const job of jobs || []) {
      try {
        const result = simulateGame(job.input as GameInput);
        const { data: committed, error: saveError } = await admin.rpc(
          "commit_simulation",
          { gid: job.id, job_lease: job.lease, p_result: result },
        );
        if (saveError) throw saveError;
        if (committed) processed++;
      } catch (error) {
        console.error(
          "Game worker failure",
          job.id,
          error instanceof Error ? error.message : "Engine or database error",
        );
        await admin.rpc("fail_simulation", {
          gid: job.id,
          job_lease: job.lease,
        });
      }
    }
    return reply({ processed });
  } catch {
    return reply({ error: "Invalid worker request" }, 400);
  }
});
