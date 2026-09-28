// POST /api/suggest — asks Claude to tag a meme template with use cases, format and tone.
// Needs the ANTHROPIC_API_KEY secret (wrangler pages secret put ANTHROPIC_API_KEY, or .dev.vars locally).
import Anthropic from "@anthropic-ai/sdk";

// Keep in sync with USE_CASES in public/app.js.
const USE_CASES = {
  blowout: "Blowout - Won by a big margin",
  upset: "Upset - Underdog or unranked team wins",
  collapse: "Collapse - Blown lead, choke, late meltdown on the field",
  rivalry: "Rivalry - Rival or trophy game result",
  clutch: "Clutch finish - Walk-off, buzzer-beater, game-winner",
  bad_call: "Bad call - Refs, replay, controversial call",
  coaching: "Coaching - Head-scratching decision, hot seat, firing",
  meltdown: "Fanbase meltdown - A fanbase losing it online",
  streak: "Streak - Streak extended or snapped",
  rankings: "Rankings - Polls, snubs, playoff picture",
  transaction: "Transaction - Trade, signing, draft, portal",
  fantasy: "Fantasy pain - Lineup regret, waiver misery",
  hype: "Hype - Before a big game, bold predictions",
  milestone: "Milestone - Record or career milestone",
  revenge: "Revenge game - Facing a former team",
  cat_watch: "Cat Watch - A cat team wins by a decent margin",
};

const SYSTEM = `You tag meme templates for @sportsmemery, a sports meme Instagram account. Given a template, pick the use cases it genuinely fits (2 to 5), its best format, and its tone.

Use case ids and meanings:
${Object.entries(USE_CASES).map(([id, d]) => `${id}: ${d}`).join("\n")}`;

const SCHEMA = {
  type: "object",
  properties: {
    useCases: { type: "array", items: { type: "string", enum: Object.keys(USE_CASES) } },
    format: { type: "string", enum: ["Reel", "Carousel", "Both"] },
    tone: { type: "string", enum: ["Roast", "Celebration", "Disbelief", "Relatable", "Hype"] },
    reason: { type: "string" },
  },
  required: ["useCases", "format", "tone", "reason"],
  additionalProperties: false,
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "not_configured" }, 503);
  const { name = "", how = "" } = await request.json().catch(() => ({}));
  if (!String(name).trim()) return json({ error: "missing_name" }, 400);

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 1024,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: `Template: ${String(name).slice(0, 200)}\nHow it works: ${String(how).slice(0, 2000)}` }],
    });
    if (response.stop_reason === "refusal") return json({ error: "refusal" }, 422);
    const text = response.content.find((b) => b.type === "text")?.text;
    const out = JSON.parse(text);
    out.useCases = [...new Set(out.useCases.filter((u) => u in USE_CASES))];
    return json(out);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "bad_api_key" }, 502);
    if (e instanceof Anthropic.APIError) return json({ error: "api_error", status: e.status }, 502);
    return json({ error: "bad_response" }, 502);
  }
}
