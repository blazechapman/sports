// Moment scan: pulls finished games from ESPN's public scoreboard feed, flags meme-worthy
// ones with the Meme Lab rules (free), then makes one Claude call to write concepts and
// captions and apply the off-limits filter for the new ones.
import Anthropic from "@anthropic-ai/sdk";
import { USE_CASES, MARGIN, isCat, potential } from "./rules.js";

const FEEDS = {
  NFL: "football/nfl",
  CFB: "football/college-football",
  MLB: "baseball/mlb",
  NBA: "basketball/nba",
  NHL: "hockey/nhl",
};
const REGULATION = { NFL: 4, CFB: 4, NBA: 4, NHL: 3, MLB: 9 };
const MAX_ENRICH = 12; // most games sent to Claude per scan

const etDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d); // YYYY-MM-DD
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function fetchLeague(league, ymd, fetchImpl) {
  const params = new URLSearchParams({ dates: ymd.replace(/-/g, ""), limit: "300" });
  if (league === "CFB") params.set("groups", "80"); // FBS only
  const url = `https://site.api.espn.com/apis/site/v2/sports/${FEEDS[league]}/scoreboard?${params}`;
  const r = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${league} feed ${r.status}`);
  return (await r.json()).events || [];
}

// Turns one ESPN event into a candidate moment, or null if nothing is flagged.
export function evaluate(ev, league, gameDate) {
  const comp = ev.competitions?.[0];
  if (!comp?.status?.type?.completed) return null;
  const teams = (comp.competitors || []).map((c) => ({
    name: league === "CFB" ? c.team?.location || c.team?.displayName : c.team?.name || c.team?.displayName,
    full: c.team?.displayName || "",
    score: Number(c.score),
    rank: c.curatedRank?.current && c.curatedRank.current < 99 ? c.curatedRank.current : null,
  }));
  if (teams.length !== 2 || teams.some((t) => !Number.isFinite(t.score)) || teams[0].score === teams[1].score) return null;
  const [w, l] = teams[0].score > teams[1].score ? teams : [teams[1], teams[0]];
  const margin = w.score - l.score;
  const useCases = [];
  if (margin >= MARGIN[league]) useCases.push("blowout");
  if (l.rank && (!w.rank || w.rank - l.rank >= 5)) useCases.push("upset");
  if ((comp.status.period || 0) > REGULATION[league]) useCases.push("clutch");
  if (useCases.includes("blowout") && isCat(w.name, w.full)) useCases.push("cat_watch");
  if (!useCases.length) return null;
  const recap = [comp.headlines?.[0]?.shortLinkText, comp.headlines?.[0]?.description].filter(Boolean).join(" — ");
  const link = (ev.links || []).find((x) => (x.rel || []).includes("recap") || (x.rel || []).includes("summary"))?.href;
  return {
    id: `${gameDate}-${league.toLowerCase()}-${slug(w.name)}-${slug(l.name)}`,
    league, gameDate,
    winner: w.name, loser: l.name, winnerScore: w.score, loserScore: l.score,
    winnerRank: w.rank, loserRank: l.rank,
    detail: comp.status.type.detail || "Final",
    recap, useCases, sources: link ? [link] : [],
  };
}

const ENRICH_SCHEMA = {
  type: "object",
  properties: {
    moments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          offLimits: { type: "boolean" },
          extraUseCases: { type: "array", items: { type: "string", enum: Object.keys(USE_CASES) } },
          headline: { type: "string" },
          description: { type: "string" },
          concept: { type: "string" },
          captionStarter: { type: "string" },
        },
        required: ["id", "offLimits", "extraUseCases", "headline", "description", "concept", "captionStarter"],
        additionalProperties: false,
      },
    },
  },
  required: ["moments"],
  additionalProperties: false,
};

const ENRICH_SYSTEM = `You write meme ideas for @sportsmemery, a sports meme Instagram account. Brand rule: punch at moments, not people. Set offLimits true when the facts given involve a serious injury, death, or a legal or personal matter.

For each game, using only the facts given (do not invent plays or quotes):
- headline: one punchy line, under 90 characters
- description: one factual sentence
- concept: a meme concept as setup → punchline, naming a well-known template if one fits
- captionStarter: an Instagram caption opener that states the result
- extraUseCases: any other use cases the facts clearly support, else []

Use case ids:
${Object.entries(USE_CASES).map(([id, d]) => `${id}: ${d}`).join("\n")}`;

async function enrich(env, candidates) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const facts = candidates.map((c) => ({
    id: c.id, league: c.league,
    result: `${c.winnerRank ? "#" + c.winnerRank + " " : ""}${c.winner} ${c.winnerScore}, ${c.loserRank ? "#" + c.loserRank + " " : ""}${c.loser} ${c.loserScore} (${c.detail})`,
    flagged: c.useCases, recap: c.recap || "",
  }));
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: ENRICH_SCHEMA } },
    system: ENRICH_SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(facts) }],
  });
  if (response.stop_reason !== "end_turn") throw new Error(`enrich stopped: ${response.stop_reason}`);
  const text = response.content.find((b) => b.type === "text")?.text;
  return Object.fromEntries(JSON.parse(text).moments.map((m) => [m.id, m]));
}

// Runs a scan and writes new moments into D1. Returns a summary.
export async function runScan(env, { now = new Date(), fetchImpl = fetch, enrichImpl = enrich } = {}) {
  const today = etDate(now);
  const yesterday = etDate(new Date(now.getTime() - 864e5));
  const candidates = [], errors = [];
  for (const league of Object.keys(FEEDS)) {
    for (const day of [yesterday, today]) {
      try {
        for (const ev of await fetchLeague(league, day, fetchImpl)) {
          const c = evaluate(ev, league, day);
          if (c) candidates.push(c);
        }
      } catch (e) {
        errors.push(String(e.message || e));
      }
    }
  }

  // Skip games already in the database (including ones you dismissed).
  const fresh = [];
  for (const c of candidates) {
    const row = await env.DB.prepare("SELECT 1 FROM docs WHERE collection = 'moments' AND id = ?").bind(c.id).first();
    if (!row) fresh.push(c);
  }
  fresh.sort((a, b) => potentialRank(b) - potentialRank(a));

  let extra = {};
  const toEnrich = fresh.slice(0, MAX_ENRICH);
  if (toEnrich.length && env.ANTHROPIC_API_KEY) {
    try { extra = await enrichImpl(env, toEnrich); } catch (e) { errors.push("Claude: " + (e.message || e)); }
  }

  const createdAt = now.toISOString();
  for (const c of fresh) {
    const e = extra[c.id] || {};
    const useCases = [...new Set([...c.useCases, ...(e.extraUseCases || []).filter((u) => u in USE_CASES)])];
    const off = !!e.offLimits;
    const doc = {
      source: "auto", status: "new", createdAt,
      league: c.league, gameDate: c.gameDate,
      winner: c.winner, loser: c.loser, winnerScore: c.winnerScore, loserScore: c.loserScore,
      headline: e.headline || `${c.winner} ${c.winnerScore}, ${c.loser} ${c.loserScore}`,
      description: e.description || c.recap || `${c.winner} beat ${c.loser} ${c.winnerScore}-${c.loserScore} (${c.detail}).`,
      concept: e.concept || "",
      captionStarter: e.captionStarter || `${c.winner} ${c.winnerScore}-${c.loserScore} over ${c.loser}.`,
      useCases: off ? [] : useCases,
      offLimits: off,
      potential: off ? "Low" : potential(useCases, c.league),
      urgency: off ? "" : "Post today",
      postDate: off ? "" : today,
      postTime: off ? "" : "7:00 PM",
      sources: c.sources,
    };
    await env.DB.prepare("INSERT OR IGNORE INTO docs (collection, id, data, updated_at) VALUES ('moments', ?, ?, ?)")
      .bind(c.id, JSON.stringify(doc), createdAt).run();
  }
  return { checked: candidates.length, added: fresh.length, enriched: Object.keys(extra).length, errors };
}

function potentialRank(c) {
  return { High: 2, Medium: 1, Low: 0 }[potential(c.useCases, c.league)];
}
