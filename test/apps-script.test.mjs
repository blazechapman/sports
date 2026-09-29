// Runs the Apps Script files (apps-script/*.gs) in Node against fake Google services.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadProject, response } from "./fake-apps-script.mjs";

// JSON round trip, as google.script.run does, so results compare cleanly across contexts.
const plain = (v) => JSON.parse(JSON.stringify(v));

test("setup creates the data sheet, loads the artifact data and schedules scans", () => {
  const p = loadProject();
  p.ctx.setup();
  const ss = p.spreadsheets.get(p.props.get("SPREADSHEET_ID"));
  assert.deepEqual([...ss.sheets.keys()], ["templates", "moments", "meta"]);
  assert.deepEqual(ss.getSheetByName("templates").grid[0], ["id", "label", "updated_at", "data"]);
  const snap = plain(p.ctx.apiSnapshot());
  assert.equal(snap.templates.length, 15);
  assert.equal(snap.moments.length, 26);
  assert.ok(snap.moments[0].data.createdAt >= snap.moments[25].data.createdAt, "moments newest first");
  assert.equal(ss.getSheetByName("templates").grid.find((r) => r[0] === "drake")[1], "Drake Hotline Bling");
  assert.deepEqual(p.triggers.map((t) => t.spec), [
    { fn: "scheduledScan", everyDays: 1, hour: 8, tz: "America/New_York" },
    { fn: "scheduledScan", weekDay: "SATURDAY", hour: 23, tz: "America/New_York" },
    { fn: "scheduledScan", weekDay: "SUNDAY", hour: 23, tz: "America/New_York" },
  ]);
  assert.match(p.logs.join("\n"), /No ANTHROPIC_API_KEY yet/);

  // Running it again keeps data and doesn't pile up triggers.
  p.ctx.apiAdd("templates", { name: "New one" });
  p.ctx.setup();
  assert.equal(p.ctx.apiSnapshot().templates.length, 16);
  assert.equal(p.triggers.length, 3);
  assert.match(p.logs.join("\n"), /Existing data kept/);
});

test("add, update, set and delete documents", () => {
  const p = loadProject();
  p.ctx.setup();
  const { id } = p.ctx.apiAdd("templates", { name: "Woman Yelling at Cat", timesUsed: 0, useCases: ["meltdown"] });
  p.ctx.apiUpdate("templates", id, { timesUsed: 1, lastUsed: "2026-09-28T12:00:00Z" });
  let t = plain(p.ctx.apiSnapshot().templates.find((d) => d.id === id));
  assert.deepEqual(t.data, { name: "Woman Yelling at Cat", timesUsed: 1, useCases: ["meltdown"], lastUsed: "2026-09-28T12:00:00Z" });
  p.ctx.apiSet("meta", "refresh", { at: "2026-09-28T12:00:00Z" });
  assert.equal(p.ctx.apiSnapshot().meta[0].data.at, "2026-09-28T12:00:00Z");
  p.ctx.apiDelete("templates", id);
  assert.equal(p.ctx.apiSnapshot().templates.some((d) => d.id === id), false);
  assert.throws(() => p.ctx.apiUpdate("templates", "nope", { a: 1 }), /Not found/);
  assert.throws(() => p.ctx.apiAdd("secrets", { a: 1 }), /Unknown collection/);
});

test("rows are added past the sheet's current size", () => {
  const p = loadProject();
  p.ctx.setup();
  const sh = p.spreadsheets.get(p.props.get("SPREADSHEET_ID")).getSheetByName("moments");
  const docs = Array.from({ length: 1100 }, (_, i) => ({ id: "m" + i, data: { headline: "x" } }));
  p.ctx.withLock_(() => p.ctx.writeDocs_(sh, "moments", docs));
  assert.equal(sh.getLastRow(), 1 + 26 + 1100);
});

const claudeReply = (obj, extraBlocks = []) =>
  response(200, { stop_reason: "end_turn", content: [...extraBlocks, { type: "text", text: JSON.stringify(obj) }] });

test("suggest: no key, working key, bad key, and fallback responses", () => {
  let reply;
  const p = loadProject({ http: () => reply });
  p.ctx.setup();
  assert.deepEqual(plain(p.ctx.apiSuggest({ name: "This is fine" })), { error: "not_configured" });

  p.props.set("ANTHROPIC_API_KEY", "sk-test");
  reply = claudeReply({ useCases: ["collapse", "collapse", "bogus"], format: "Reel", tone: "Relatable", reason: "Calm amid chaos." });
  const out = plain(p.ctx.apiSuggest({ name: "This is fine", how: "Dog in a burning room" }));
  assert.deepEqual(out, { useCases: ["collapse"], format: "Reel", tone: "Relatable", reason: "Calm amid chaos." });

  const req = p.requests.at(-1);
  assert.equal(req.url, "https://api.anthropic.com/v1/messages");
  assert.equal(req.method, "post");
  assert.equal(req.headers["x-api-key"], "sk-test");
  assert.equal(req.headers["anthropic-version"], "2023-06-01");
  assert.equal(req.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  const body = JSON.parse(req.payload);
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.fallbacks, "default");
  assert.equal(body.output_config.effort, "low");
  assert.equal(body.output_config.format.type, "json_schema");
  assert.ok(body.output_config.format.schema.properties.useCases.items.enum.includes("cat_watch"));

  reply = response(401, { error: { message: "invalid x-api-key" } });
  assert.deepEqual(plain(p.ctx.apiSuggest({ name: "x" })), { error: "bad_api_key" });

  // After a server-side fallback, only the text after the fallback block counts.
  reply = claudeReply({ useCases: ["upset"], format: "Both", tone: "Hype", reason: "r" },
    [{ type: "text", text: "{\"partial" }, { type: "fallback", from: { model: "a" }, to: { model: "b" } }]);
  assert.deepEqual(plain(p.ctx.apiSuggest({ name: "x" })).useCases, ["upset"]);
});

const team = (name, location, score, rank) => ({
  score: String(score), team: { name, location, displayName: `${location} ${name}` }, curatedRank: { current: rank || 99 },
});
const game = (a, b, period = 4) => ({
  competitions: [{ status: { period, type: { completed: true, detail: "Final" } }, competitors: [a, b], headlines: [{ shortLinkText: "Recap" }] }],
  links: [{ rel: ["recap"], href: "https://espn.com/recap/9" }],
});

test("scan: flags games from the feeds, asks Claude once per chunk, skips known games, respects the cooldown", () => {
  const feeds = {
    "football/nfl/scoreboard?dates=20260928": [game(team("Chiefs", "Kansas City", 41, null), team("Dolphins", "Miami", 10, null)), game(team("Bills", "Buffalo", 20, null), team("Jets", "New York", 17, null))],
    "football/college-football/scoreboard?dates=20260927": [game(team("Tigers", "LSU", 42, 12), team("Aggies", "Texas A&M", 10, 20))],
    "hockey/nhl/scoreboard?dates=20260928": [game(team("Panthers", "Florida", 3, null), team("Bruins", "Boston", 2, null), 4)],
  };
  const p = loadProject({
    http: (req) => {
      if (req.url.includes("espn.com")) {
        const key = Object.keys(feeds).find((k) => req.url.includes(k));
        return response(200, { events: key ? feeds[key] : [] });
      }
      const games = JSON.parse(JSON.parse(req.payload).messages[0].content);
      return claudeReply({ moments: games.map((g) => ({ id: g.id, offLimits: false, extraUseCases: ["streak"], headline: "H " + g.id, description: "D", concept: "C", captionStarter: "Cap" })) });
    },
  });
  p.ctx.setup();
  p.props.set("ANTHROPIC_API_KEY", "sk-test");
  // The LSU game is already saved (from the artifact), so it is skipped.
  p.ctx.apiSet("moments", "2026-09-27-cfb-lsu-texasam", { headline: "old", createdAt: "2026-09-27T00:00:00Z" });

  const now = "new Date('2026-09-28T16:00:00Z')";
  const r = plain(p.run(`runScan_({ now: ${now} })`));
  assert.deepEqual(r, { checked: 3, added: 2, enriched: 2, errors: [] });
  assert.equal(p.requests.filter((q) => q.url.includes("espn.com")).length, 10);
  assert.equal(p.requests.filter((q) => q.url.includes("anthropic")).length, 1);

  const moments = plain(p.ctx.apiSnapshot().moments);
  const chiefs = moments.find((m) => m.id === "2026-09-28-nfl-chiefs-dolphins").data;
  assert.deepEqual(chiefs.useCases, ["blowout", "streak"]);
  assert.equal(chiefs.concept, "C");
  assert.equal(chiefs.status, "new");
  assert.equal(chiefs.postDate, "2026-09-28");
  assert.equal(chiefs.potential, "Medium"); // 2 use cases + NFL weight 3 = 5; High needs 6
  const nhl = moments.find((m) => m.id === "2026-09-28-nhl-panthers-bruins").data;
  assert.deepEqual(nhl.useCases, ["clutch", "streak"]);
  assert.equal(moments.find((m) => m.id === "2026-09-27-cfb-lsu-texasam").data.headline, "old");

  // Scanning again adds nothing.
  assert.equal(plain(p.run(`runScan_({ now: ${now} })`)).added, 0);

  // The button: first press runs, a second press within 10 minutes is refused.
  assert.equal(p.ctx.apiScan().error, undefined);
  assert.equal(p.ctx.apiScan().error, "cooldown");
});

test("scan: feed errors and Claude failures don't stop moments being saved", () => {
  const p = loadProject({
    http: (req) => {
      if (req.url.includes("hockey/nhl") && req.url.includes("20260927")) {
        return response(200, { events: [game(team("Panthers", "Florida", 6, null), team("Bruins", "Boston", 1, null), 3)] });
      }
      if (req.url.includes("anthropic")) return response(529, { error: { message: "overloaded" } });
      return response(403, "blocked");
    },
  });
  p.ctx.setup();
  p.props.set("ANTHROPIC_API_KEY", "sk-test");
  const r = plain(p.run("runScan_({ now: new Date('2026-09-28T16:00:00Z') })"));
  assert.equal(r.added, 1);
  assert.equal(r.errors.filter((e) => e.includes("feed 403")).length, 9);
  assert.match(r.errors.at(-1), /Claude: Claude API 529: overloaded/);
  const doc = plain(p.ctx.apiSnapshot().moments.find((m) => m.id === "2026-09-27-nhl-panthers-bruins").data);
  assert.deepEqual(doc.useCases, ["blowout", "cat_watch"]);
  assert.equal(doc.captionStarter, "Panthers 6-1 over Bruins.");
});

test("scan: a failed Claude batch is reported, not re-sent", () => {
  let claudeCalls = 0;
  const p = loadProject({
    http: (req) => {
      if (req.url.includes("anthropic")) { claudeCalls++; throw new Error("Timeout"); }
      return response(200, { events: req.url.includes("hockey/nhl") && req.url.includes("20260927")
        ? [game(team("Panthers", "Florida", 6, null), team("Bruins", "Boston", 1, null), 3)] : [] });
    },
  });
  p.ctx.setup();
  p.props.set("ANTHROPIC_API_KEY", "sk-test");
  const r = plain(p.run("runScan_({ now: new Date('2026-09-28T16:00:00Z') })"));
  assert.equal(claudeCalls, 1);
  assert.equal(r.added, 1);
  assert.deepEqual(r.errors, ["Claude: Timeout"]);
});

test("generated Apps Script files match the shared sources", () => {
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const appHtml = readFileSync(new URL("../apps-script/App.html", import.meta.url), "utf8");
  assert.ok(appHtml.includes(app), "apps-script/App.html is stale: run npm run build:apps-script");
  const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.ok(readFileSync(new URL("../apps-script/Styles.html", import.meta.url), "utf8").includes(css), "apps-script/Styles.html is stale");
});
