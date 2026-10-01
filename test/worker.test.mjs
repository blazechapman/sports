// Tests for app/worker.js: the app's files pass through, and only ESPN scoreboards are relayed.
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../app/worker.js";

const env = { ASSETS: { fetch: async () => new Response("asset") } };

test("relays only the scan's ESPN scoreboards", async () => {
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(url); return new Response('{"events":[]}', { status: 200, headers: { "content-type": "application/json" } }); };
  const ok = await worker.fetch(new Request("https://x.dev/espn/football/college-football/scoreboard?dates=20260928&limit=300&groups=80"), env);
  assert.equal(ok.status, 200);
  assert.equal(seen[0], "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20260928&limit=300&groups=80");
  for (const bad of ["/espn/soccer/eng.1/scoreboard", "/espn/football/nfl/news", "/espn/football/nfl/scoreboard?callback=x"]) {
    assert.equal((await worker.fetch(new Request("https://x.dev" + bad), env)).status, 404, bad);
  }
  // "../" is resolved before the Worker sees it, so this is an ordinary page request, never relayed.
  assert.equal(await (await worker.fetch(new Request("https://x.dev/espn/../secret/scoreboard"), env)).text(), "asset");
  assert.equal(seen.length, 1);
  assert.equal(await (await worker.fetch(new Request("https://x.dev/"), env)).text(), "asset");
});
