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
  assert.deepEqual([...ss.sheets.keys()], ["templates", "moments", "meta", "plans", "Meme Voice"]);
  assert.deepEqual(ss.getSheetByName("templates").grid[0], ["id", "label", "updated_at", "data"]);
  const snap = plain(p.ctx.apiSnapshot());
  assert.equal(snap.templates.length, 15);
  assert.equal(snap.moments.length, 26);
  assert.ok(snap.moments[0].data.createdAt >= snap.moments[25].data.createdAt, "moments newest first");
  assert.equal(ss.getSheetByName("templates").grid.find((r) => r[0] === "drake")[1], "Drake Hotline Bling");
  // ESPN blocks Google's servers, so no scheduled scans (and an older setup's are removed).
  assert.equal(p.triggers.length, 0);
  assert.match(p.logs.join("\n"), /No ANTHROPIC_API_KEY yet/);

  // Running it again keeps data and doesn't pile up triggers.
  p.ctx.apiAdd("templates", { name: "New one" });
  p.ctx.ScriptApp.newTrigger("scheduledScan").timeBased().everyDays(1).atHour(8).create();
  p.ctx.setup();
  assert.equal(p.ctx.apiSnapshot().templates.length, 16);
  assert.equal(p.triggers.length, 0);
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
  assert.equal(p.requests.filter((q) => q.url.includes("espn.com")).length, 14); // 7 leagues × 2 days
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
  assert.equal(r.errors.filter((e) => e.includes("feed 403")).length, 13);
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

const post = (p, body) => JSON.parse(p.ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);

test("app front door: needs the key, allows only listed calls", () => {
  const p = loadProject();
  p.ctx.setup();
  assert.equal(post(p, { key: "x", fn: "ping" }).code, "nokey");
  const key = p.ctx.makeAppKey();
  assert.equal(key.length, 64);
  assert.equal(post(p, { key: "wrong", fn: "apiSnapshot" }).code, "badkey");
  assert.deepEqual(post(p, { key, fn: "ping" }), { ok: true, result: { ok: true } });
  assert.equal(post(p, { key, fn: "apiSnapshot" }).result.templates.length, 15);
  assert.match(post(p, { key, fn: "makeAppKey" }).error, /Unknown call/);
  assert.match(post(p, { key, fn: "setup" }).error, /Unknown call/);
  const added = post(p, { key, fn: "apiAdd", args: ["templates", { name: "From the app" }] });
  assert.ok(added.ok);
  assert.equal(post(p, { key, fn: "apiUpdate", args: ["templates", "nope", {}] }).ok, false);

  // A stranger (no Google sign-in) calling through the app works with the key...
  p.session.user = "";
  assert.equal(post(p, { key, fn: "apiSnapshot" }).result.templates.length, 16);
  // ...but can't use the page's functions or the editor ones without it.
  assert.throws(() => p.ctx.apiSnapshot(), /Only the owner/);
  assert.throws(() => p.ctx.makeAppKey(), /Only the owner/);
  assert.throws(() => p.ctx.setup(), /Only the owner/);
  assert.throws(() => p.ctx.include("Seed"), /Unknown page part/);
  assert.throws(() => p.ctx.scheduledScan({ triggerUid: "guess" }), /only runs from its schedule/);
  assert.throws(() => p.ctx.scheduledScan(), /only runs from its schedule/);
});

test("scheduledScan runs for its own trigger", () => {
  const p = loadProject({ http: () => response(200, { events: [] }) });
  p.ctx.setup();
  p.session.user = "";
  const t = p.ctx.ScriptApp.newTrigger("scheduledScan").timeBased().everyDays(1).atHour(8).create();
  assert.doesNotThrow(() => p.ctx.scheduledScan({ triggerUid: t.getUniqueId() }));
});

test("scan from scoreboards sent by the page (ESPN blocks Google, so the device fetches them)", () => {
  const p = loadProject({ http: (req) => { throw new Error("no server fetch expected: " + req.url); } });
  p.ctx.setup();
  const feeds = [
    { league: "NFL", day: "2026-09-28", events: [game(team("Chiefs", "Kansas City", 41, null), team("Dolphins", "Miami", 10, null))] },
    { league: "NHL", day: "2026-09-28", error: "couldn't reach ESPN from this device" },
    { league: "XFL", day: "2026-09-28", events: [game(team("A", "A", 50, null), team("B", "B", 0, null))] }, // unknown league: ignored
    { league: "MLB", day: "not-a-date", events: [] },
  ];
  const r = plain(p.ctx.apiScan(feeds));
  assert.deepEqual(r, { checked: 1, added: 1, enriched: 0, errors: ["NHL feed couldn't reach ESPN from this device"] });
  assert.ok(p.ctx.snapshot_().moments.some((m) => m.id === "2026-09-28-nfl-chiefs-dolphins"));
  assert.equal(p.ctx.apiScan(feeds).error, "cooldown");
});

test("the app's front door passes the page's scoreboards to the scan", () => {
  const p = loadProject();
  p.ctx.setup();
  const key = p.ctx.makeAppKey();
  p.session.user = "";
  const feeds = [{ league: "CFB", day: "2026-09-27", events: [game(team("Tigers", "LSU", 42, 12), team("Aggies", "Texas A&M", 10, 20))] }];
  const out = post(p, { key, fn: "apiScan", args: [feeds] });
  assert.ok(out.ok, out.error);
  assert.equal(out.result.checked, 1);
});

// ---- timing, voice, plan ahead, team numbers, finalize ----

test("post windows: the next morning or late-night slot that leaves an hour", () => {
  const p = loadProject();
  const at = (iso, lead) => plain(p.run(`nextWindow_(new Date("${iso}")${lead == null ? "" : ", " + lead})`));
  // 9:25 PM ET (01:25 UTC next day, EDT) → late night, 10:30 PM after the hour of prep
  assert.deepEqual(at("2026-10-02T01:25:00Z"), { date: "2026-10-01", time: "10:30 PM", window: "Late night" });
  // 11:30 PM ET → too late tonight, so tomorrow morning
  assert.deepEqual(at("2026-10-02T03:30:00Z"), { date: "2026-10-02", time: "8:00 AM", window: "Morning" });
  // 2 PM ET → tonight's late window opens at 10 PM
  assert.deepEqual(at("2026-10-01T18:00:00Z"), { date: "2026-10-01", time: "10:00 PM", window: "Late night" });
  // 8:20 AM ET with no lead (a prepped plan) → right away, rounded to 8:30
  assert.deepEqual(at("2026-10-01T12:20:00Z", 0), { date: "2026-10-01", time: "8:30 AM", window: "Morning" });
});

test("scan moments get a post window, WNBA and college basketball, Cat fight and Gator Watch", () => {
  const feeds = [
    { league: "WNBA", day: "2026-09-30", events: [game(team("Lynx", "Minnesota", 90, null), team("Sky", "Chicago", 70, null))] },
    { league: "CFB", day: "2026-09-27", events: [game(team("Gators", "Florida", 24, null), team("Rebels", "Ole Miss", 21, 14))] },
    { league: "NFL", day: "2026-09-27", events: [game(team("Lions", "Detroit", 20, null), team("Panthers", "Carolina", 17, null))] },
  ];
  const p = loadProject();
  p.ctx.setup();
  p.run(`runScan_({ now: new Date("2026-10-02T01:25:00Z"), feeds: ${JSON.stringify(feeds)} })`);
  const m = Object.fromEntries(plain(p.ctx.snapshot_().moments).map((x) => [x.id, x.data]));
  assert.deepEqual(m["2026-09-30-wnba-lynx-sky"].useCases, ["blowout", "cat_watch"]);
  assert.deepEqual(m["2026-09-27-cfb-florida-olemiss"].useCases, ["upset", "gator_watch"]);
  assert.deepEqual(m["2026-09-27-nfl-lions-panthers"].useCases, ["cat_fight"]);
  assert.equal(m["2026-09-27-nfl-lions-panthers"].postWindow, "Late night");
  assert.equal(m["2026-09-27-nfl-lions-panthers"].postTime, "10:30 PM");
  assert.equal(m["2026-09-27-nfl-lions-panthers"].urgency, "Post today");
});

test("the meme voice library goes into Claude's prompts", () => {
  let body;
  const p = loadProject({ http: (req) => { body = JSON.parse(req.payload); return response(200, { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ useCases: [], format: "Reel", tone: "Roast", reason: "" }) }] }); } });
  p.ctx.setup();
  p.props.set("ANTHROPIC_API_KEY", "sk-test");
  const sh = p.spreadsheets.get(p.props.get("SPREADSHEET_ID")).getSheetByName("Meme Voice");
  p.ctx.withLock_(() => p.ctx.appendRows_(sh, [["Example", "Bears fans, it's okay to cry."]], true));
  p.ctx.apiFinalize; // exists
  p.run("memeText_({ league: 'NFL', winner: 'Lions', loser: 'Bears', winnerScore: 45, loserScore: 10 }, null)");
  assert.match(body.system, /House style for @sportsmemery/);
  assert.match(body.system, /Punch at moments, not people/);
  assert.match(body.system, /Bears fans, it's okay to cry\./);
  assert.doesNotMatch(body.system, /Paste a caption you liked here/);
});

const upcoming = (away, home, start, extra = {}) => ({
  date: start,
  competitions: [{ date: start, status: { type: { state: "pre" } }, notes: extra.notes || [],
    competitors: [
      { homeAway: "away", curatedRank: { current: away[2] || 99 }, team: { name: away[0], location: away[1], displayName: away[1] + " " + away[0] } },
      { homeAway: "home", curatedRank: { current: home[2] || 99 }, team: { name: home[0], location: home[1], displayName: home[1] + " " + home[0] } },
    ] }],
});

test("plan ahead: flags matchups, asks Claude with the library, saves plans with a post window", () => {
  let claudeBody;
  const p = loadProject({ http: (req) => {
    claudeBody = JSON.parse(req.payload);
    const games = JSON.parse(claudeBody.messages[0].content);
    return response(200, { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ plans: games.map((g) => ({
      id: g.id, headline: "H " + g.id, scenarios: [{ outcome: "If A wins", idea: "idea", template: "Drake Hotline Bling" }, { outcome: "If B wins", idea: "idea 2", template: "Always Has Been" }] })) }) }] });
  } });
  p.ctx.setup();
  p.props.set("ANTHROPIC_API_KEY", "sk-test");
  const feeds = [
    { league: "NFL", events: [
      upcoming(["Panthers", "Carolina"], ["Lions", "Detroit"], "2026-10-04T17:00:00Z"), // cat fight
      upcoming(["Jets", "New York"], ["Bills", "Buffalo"], "2026-10-04T17:00:00Z"),      // nothing
    ] },
    { league: "CFB", events: [
      upcoming(["Wildcats", "Kentucky"], ["Gators", "Florida"], "2026-10-03T23:00:00Z"),  // Gator Watch + cat team
      upcoming(["Bulldogs", "Georgia", 3], ["Volunteers", "Tennessee", 9], "2026-10-03T19:30:00Z"), // ranked showdown
      upcoming(["Buckeyes", "Ohio State", 2], ["Golden Gophers", "Minnesota"], "2026-10-03T16:00:00Z"), // upset watch
      upcoming(["Ducks", "Oregon"], ["Beavers", "Oregon State"], "2026-10-03T20:00:00Z", { notes: [{ headline: "Platypus Trophy" }] }), // rivalry
    ] },
    { league: "NHL", error: "couldn't reach ESPN from this device" },
  ];
  const r = plain(p.ctx.apiPlan(feeds));
  assert.deepEqual(r, { found: 5, added: 5, enriched: 5, errors: ["NHL schedule couldn't reach ESPN from this device"] });
  assert.match(claudeBody.system, /Prefer Fresh templates/);
  assert.match(claudeBody.system, /Drake Hotline Bling/);  // the library
  assert.match(claudeBody.system, /Never use it for a Florida loss/);
  const plans = plain(p.ctx.snapshot_().plans);
  const byId = Object.fromEntries(plans.map((x) => [x.id, x.data]));
  assert.deepEqual(byId["plan-2026-10-04-nfl-panthers-lions"].angles, ["cat_fight"]);
  assert.deepEqual(byId["plan-2026-10-03-cfb-kentucky-florida"].angles, ["gator_watch"]);
  assert.deepEqual(byId["plan-2026-10-03-cfb-georgia-tennessee"].angles, ["ranked_showdown"]);
  assert.deepEqual(byId["plan-2026-10-03-cfb-ohiostate-minnesota"].angles, ["upset_watch"]);
  assert.deepEqual(byId["plan-2026-10-03-cfb-oregon-oregonstate"].angles, ["rivalry"]);
  // Gator Watch is planned first (highest priority)
  assert.equal(JSON.parse(claudeBody.messages[0].content).length <= 4, true);
  // 1 PM ET kickoff + 3.5 h → 4:30 PM, so the late-night window that day
  assert.deepEqual([byId["plan-2026-10-04-nfl-panthers-lions"].postWindow, byId["plan-2026-10-04-nfl-panthers-lions"].postTime], ["Late night", "10:00 PM"]);
  assert.equal(byId["plan-2026-10-04-nfl-panthers-lions"].scenarios.length, 2);
  assert.equal(byId["plan-2026-10-04-nfl-panthers-lions"].status, "upcoming");
  // running again adds nothing and doesn't ask Claude again
  claudeBody = null;
  assert.equal(plain(p.ctx.apiPlan(feeds)).added, 0);
  assert.equal(claudeBody, null);
});

test("team numbers: alphabetical by nickname (pro) or school (college), stable, new teams appended", () => {
  const p = loadProject();
  p.ctx.setup();
  const nfl = [{ id: "3", name: "Bears", location: "Chicago", displayName: "Chicago Bears", abbr: "CHI" },
    { id: "25", name: "49ers", location: "San Francisco", displayName: "San Francisco 49ers", abbr: "SF" },
    { id: "4", name: "Bengals", location: "Cincinnati", displayName: "Cincinnati Bengals", abbr: "CIN" }];
  const cfb = [{ id: "57", name: "Gators", location: "Florida", displayName: "Florida Gators", abbr: "FLA" },
    { id: "333", name: "Crimson Tide", location: "Alabama", displayName: "Alabama Crimson Tide", abbr: "ALA" }];
  assert.deepEqual(plain(p.ctx.apiSaveTeams([{ league: "NFL", teams: nfl }, { league: "CFB", teams: cfb }, { league: "XFL", teams: nfl }])),
    { NFL: { total: 3, added: 3 }, CFB: { total: 2, added: 2 } });
  const ss = p.spreadsheets.get(p.props.get("SPREADSHEET_ID"));
  assert.deepEqual(ss.getSheetByName("Teams NFL").grid.slice(1).map((r) => [r[0], r[1]]), [[1, "49ers"], [2, "Bears"], [3, "Bengals"]]);
  assert.deepEqual(ss.getSheetByName("Teams CFB").grid.slice(1).map((r) => [r[0], r[1]]), [[1, "Alabama"], [2, "Florida"]]);
  // a new team later gets the next number; existing numbers don't move
  nfl.push({ id: "1", name: "Falcons", location: "Atlanta", displayName: "Atlanta Falcons", abbr: "ATL" }, { id: "22", name: "Cardinals", location: "Arizona", displayName: "Arizona Cardinals", abbr: "ARI" });
  assert.deepEqual(plain(p.ctx.apiSaveTeams([{ league: "NFL", teams: nfl }])), { NFL: { total: 5, added: 2 } });
  assert.deepEqual(ss.getSheetByName("Teams NFL").grid.slice(1).map((r) => [r[0], r[1]]), [[1, "49ers"], [2, "Bears"], [3, "Bengals"], [4, "Cardinals"], [5, "Falcons"]]);
  assert.equal(p.ctx.teamNumber_("NFL", "Bears"), 2);
  assert.equal(p.ctx.teamNumber_("NFL", "Chicago Bears"), 2);
  assert.equal(p.ctx.teamNumber_("CFB", "Florida"), 2);
  assert.equal(p.ctx.teamNumber_("NBA", "Bulls"), "");
});

test("finalize: Claude's text in a Meme Queue row and a CSV in Drive, moment queued", () => {
  const p = loadProject({ http: () => response(200, { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ text1: "BEARS DEFENSE", text2: "\"It's fine\", 45-10", text3: "", caption: "Lions 45-10. Bears fans, breathe." }) }] }) });
  p.ctx.setup();
  p.props.set("ANTHROPIC_API_KEY", "sk-test");
  p.ctx.apiSaveTeams([{ league: "NFL", teams: [{ id: "8", name: "Lions", location: "Detroit", displayName: "Detroit Lions" }, { id: "3", name: "Bears", location: "Chicago", displayName: "Chicago Bears" }] }]);
  p.ctx.apiSet("moments", "m1", { league: "NFL", winner: "Lions", loser: "Bears", winnerScore: 45, loserScore: 10, headline: "Lions maul Bears", postDate: "2026-10-01", postTime: "10:30 PM", postWindow: "Late night", status: "new" });
  const out = plain(p.ctx.apiFinalize({ momentId: "m1", templateId: "this-is-fine", hashtags: "#sportsmemes #nfl" }));
  assert.equal(out.texts.text1, "BEARS DEFENSE");
  const ss = p.spreadsheets.get(p.props.get("SPREADSHEET_ID"));
  const q = ss.getSheetByName("Meme Queue").grid;
  assert.equal(q[0].join("|"), "Queue ID|Finalized|Post date|Post window|Post time|League|Template|Format|Winner|Winner #|Loser|Loser #|Winner score|Loser score|Text 1|Text 2|Text 3|Instagram caption|Hashtags|Moment");
  const row = Object.fromEntries(q[0].map((h, i) => [h, q[1][i]]));
  assert.equal(row["Template"], "This Is Fine (dog in burning room)");
  assert.equal(row["Winner #"], "2");   // Bears=1, Lions=2
  assert.equal(row["Loser #"], "1");
  assert.equal(row["Post window"], "Late night");
  const file = p.drive.folders[0].files[0];
  assert.equal(p.drive.folders[0].name, "Meme Lab Exports");
  assert.equal(file.mime, "text/csv");
  assert.match(file.name, /^2026-10-01 NFL Lions-Bears This Is Fine/);
  const lines = file.content.trim().split("\r\n");
  assert.equal(lines.length, 2);
  assert.match(lines[1], /,"""It's fine"", 45-10",/); // quotes and commas escaped for CSV
  const m = plain(p.ctx.getDoc_("moments", "m1"));
  assert.equal(m.status, "queued");
  assert.equal(m.text1, "BEARS DEFENSE");
  assert.ok(m.csvUrl);
  assert.equal(plain(p.ctx.getDoc_("templates", "this-is-fine")).timesUsed, 1);
  // a second finalize reuses the same Drive folder
  p.ctx.apiFinalize({ momentId: "m1", templateId: "", hashtags: "" });
  assert.equal(p.drive.folders.length, 1);
  assert.equal(p.drive.folders[0].files.length, 2);
  assert.throws(() => p.ctx.apiFinalize({ momentId: "nope" }), /moment is gone/);
});

test("finalize without a Claude key uses the moment's own text", () => {
  const p = loadProject({ http: () => { throw new Error("no Claude call expected"); } });
  p.ctx.setup();
  p.ctx.apiSet("moments", "m2", { league: "NFL", winner: "Lions", loser: "Bears", winnerScore: 45, loserScore: 10, concept: "Bears D as This Is Fine dog", captionStarter: "Lions 45-10 over the Bears." });
  const out = plain(p.ctx.apiFinalize({ momentId: "m2" }));
  assert.deepEqual(out.texts, { text1: "Bears D as This Is Fine dog", text2: "", text3: "", caption: "Lions 45-10 over the Bears." });
});
