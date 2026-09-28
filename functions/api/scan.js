// POST /api/scan — runs the moment scan now (the "Check for new moments" button).
// Limited to once every 10 minutes; the time is kept in meta/refresh.
import { runScan } from "../../lib/scan.js";

const COOLDOWN_MS = 10 * 60 * 1000;
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export async function onRequestPost({ env }) {
  const row = await env.DB.prepare("SELECT data FROM docs WHERE collection = 'meta' AND id = 'refresh'").first();
  const last = row ? JSON.parse(row.data).at : null;
  if (last && Date.now() - new Date(last).getTime() < COOLDOWN_MS) return json({ error: "cooldown", at: last }, 429);
  const at = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO docs (collection, id, data, updated_at) VALUES ('meta', 'refresh', ?, ?) " +
    "ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
  ).bind(JSON.stringify({ at }), at).run();
  return json(await runScan(env));
}
