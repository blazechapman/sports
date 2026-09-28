// Offline tests for lib/scan.js using fake ESPN events and an in-memory D1 stand-in.
import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, runScan } from "../lib/scan.js";

const team = (name, location, score, rank) => ({
  score: String(score), team: { name, location, displayName: `${location} ${name}` },
  ...(rank ? { curatedRank: { current: rank } } : { curatedRank: { current: 99 } }),
});
const event = (a, b, { period = 4, completed = true } = {}) => ({
  competitions: [{ status: { period, type: { completed, detail: period > 4 ? "Final/OT" : "Final" } }, competitors: [a, b],
    headlines: [{ shortLinkText: "Recap text" }] }],
  links: [{ rel: ["recap"], href: "https://espn.com/recap/1" }],
});

test("blowout by a cat team flags blowout + cat_watch", () => {
  const c = evaluate(event(team("Tigers", "LSU", 42, 12), team("Aggies", "Texas A&M", 10, 20)), "CFB", "2026-09-26");
  assert.equal(c.id, "2026-09-26-cfb-lsu-texasam");
  assert.deepEqual(c.useCases, ["blowout", "cat_watch"]);
});

test("unranked team beating a ranked team is an upset; overtime is clutch", () => {
  const c = evaluate(event(team("Boilermakers", "Purdue", 31, null), team("Fighting Irish", "Notre Dame", 28, 8), { period: 5 }), "CFB", "2026-09-26");
  assert.deepEqual(c.useCases, ["upset", "clutch"]);
});

test("ordinary or unfinished games are skipped", () => {
  assert.equal(evaluate(event(team("Bills", "Buffalo", 24, null), team("Jets", "New York", 20, null)), "NFL", "d"), null);
  assert.equal(evaluate(event(team("Bills", "Buffalo", 50, null), team("Jets", "New York", 0, null), { completed: false }), "NFL", "d"), null);
});

function fakeDb(existing = []) {
  const rows = new Map(existing.map((id) => [id, "{}"]));
  return {
    rows,
    prepare(sql) {
      return { bind: (...args) => ({
        first: async () => (rows.has(args[0]) ? { 1: 1 } : null),
        run: async () => { if (sql.startsWith("INSERT OR IGNORE") && !rows.has(args[0])) rows.set(args[0], args[1]); },
      }) };
    },
  };
}

test("runScan adds new moments, skips existing ones, and merges Claude's ideas", async () => {
  const feeds = {
    "football/nfl": [event(team("Chiefs", "Kansas City", 41, null), team("Dolphins", "Miami", 10, null))],
    "football/college-football": [event(team("Tigers", "LSU", 42, 12), team("Aggies", "Texas A&M", 10, 20))],
  };
  const fetchImpl = async (url) => {
    const key = Object.keys(feeds).find((k) => url.includes(k) && url.includes("20260927"));
    return { ok: true, json: async () => ({ events: key ? feeds[key] : [] }) };
  };
  const env = { DB: fakeDb(["2026-09-27-cfb-lsu-texasam"]), ANTHROPIC_API_KEY: "test" };
  let sent;
  const enrichImpl = async (_env, cands) => {
    sent = cands.map((c) => c.id);
    return { [cands[0].id]: { id: cands[0].id, offLimits: false, extraUseCases: ["streak", "bogus"], headline: "H", description: "D", concept: "C", captionStarter: "Cap" } };
  };
  const r = await runScan(env, { now: new Date("2026-09-28T12:45:00Z"), fetchImpl, enrichImpl });
  assert.equal(r.checked, 2);
  assert.equal(r.added, 1);
  assert.deepEqual(sent, ["2026-09-27-nfl-chiefs-dolphins"]);
  const doc = JSON.parse(env.DB.rows.get("2026-09-27-nfl-chiefs-dolphins"));
  assert.deepEqual(doc.useCases, ["blowout", "streak"]);
  assert.equal(doc.concept, "C");
  assert.equal(doc.status, "new");
  assert.equal(doc.postDate, "2026-09-28");
});

test("runScan still saves moments when Claude fails or has no key", async () => {
  const fetchImpl = async (url) => ({ ok: true, json: async () => ({ events: url.includes("nhl") && url.includes("20260927")
    ? [event(team("Panthers", "Florida", 6, null), team("Bruins", "Boston", 1, null), { period: 3 })] : [] }) });
  const env = { DB: fakeDb(), ANTHROPIC_API_KEY: "test" };
  const r = await runScan(env, { now: new Date("2026-09-28T12:45:00Z"), fetchImpl, enrichImpl: async () => { throw new Error("boom"); } });
  assert.equal(r.added, 1);
  assert.match(r.errors[0], /Claude: boom/);
  const doc = JSON.parse([...env.DB.rows.values()][0]);
  assert.deepEqual(doc.useCases, ["blowout", "cat_watch"]);
});
