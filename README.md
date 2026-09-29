# Meme Lab

Web app version of the Meme Lab artifact (@sportsmemery): match a sports moment to the right meme template, then queue it.

Two ways to run it, sharing the same UI (`public/app.js`):

- **Google Apps Script:** the page, a Google Sheet for data and Google's scheduled triggers. Setup guide: [`apps-script/README.md`](apps-script/README.md).
- **Cloudflare:** Pages (static UI in `public/`) + Pages Functions (`functions/api/`) + D1 (SQLite). Setup below.

## Layout

| Path | What |
|---|---|
| `public/index.html`, `styles.css`, `app.js` | UI ported from the artifact (Today, Match, Library, Add, Use cases tabs) |
| `public/db.js` | Cloudflare data layer: a small Firestore-style client over `/api` plus `api.suggest` / `api.scan`, so `app.js` stays close to the artifact code. Polls every 15s. |
| `functions/api/suggest.js` | `POST /api/suggest`: asks Claude (Opus 5.5, low effort, JSON-schema output) to tag a template with use cases, format and tone |
| `functions/api/scan.js` | `POST /api/scan`: the "Check for new moments" button (once per 10 min) |
| `lib/scan.js`, `lib/rules.js` | The moment scan and the shared Meme Lab rules |
| `worker/` | Scheduled Worker that runs the scan automatically |
| `apps-script/` | The Apps Script version (see its README) |
| `scripts/build-apps-script.mjs` | Regenerates `apps-script/Index.html`, `Styles.html`, `App.html` and `Seed.gs` from `public/` and `data/export/` |
| `test/` | Offline tests for both versions (`npm test`) |
| `functions/api/[[path]].js` | REST API: `GET/POST /api/:collection`, `GET/PUT/PATCH/DELETE /api/:collection/:id` (collections: `templates`, `moments`, `meta`) |
| `migrations/` | D1 schema (one `docs` table holding JSON documents) |
| `data/export/` | Templates and moments exported from the artifact on 2026-09-28 |
| `scripts/build-seed.mjs` | Turns `data/export/` into `data/seed.sql` |

## Cloudflare: run locally

```sh
npm install
npm run db:migrate:local
npm run db:seed:local
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .dev.vars   # optional: enables Claude suggestions
npm run dev            # http://localhost:8788
```

## Cloudflare: deploy

```sh
npx wrangler login
npx wrangler d1 create memelab      # paste the database_id into wrangler.toml
npm run db:migrate
npm run db:seed
npx wrangler pages project create memelab
npx wrangler pages secret put ANTHROPIC_API_KEY --project-name memelab
npm run deploy

# scheduled scan: paste the same database_id into worker/wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY --config worker/wrangler.toml
npm run deploy:scan
```

If the D1 binding isn't picked up from `wrangler.toml`, add it in the dashboard: Pages → Settings → Bindings → D1, variable `DB`.

**The Cloudflare API has no auth.** Put the site behind Cloudflare Access (Zero Trust → Access → Applications) before you share the URL.

## Claude suggestions

The "Suggest use cases" button on the Add template tab calls `/api/suggest`. If `ANTHROPIC_API_KEY` isn't set or the call fails, it falls back to keyword matching. Requests use server-side refusal fallback (`fallbacks: "default"`), so a declined request is retried on another model automatically.

## Moment scan

Runs at 8:45 AM ET daily and 11:45 PM ET Saturday/Sunday nights (Worker cron, UTC-based, so an hour earlier in winter), plus whenever you press **Check for new moments**.

1. **Free:** pulls yesterday's and today's finished games from ESPN's public scoreboard feed (NFL, FBS college football, MLB, NBA, NHL). The feed is unofficial and can change without notice.
2. **Free:** flags games using the Meme Lab rules: blowout margins, ranked-team upsets, overtime/extra innings (clutch), Cat Watch. Games already in the database, including dismissed ones, are skipped.
3. **One Claude call** for up to 12 new games: writes the headline, concept and caption starter, adds any use cases the recap supports, and applies the off-limits filter. Without an API key, or if the call fails, moments are still saved without those extras.

Claude only sees the score and ESPN's one-line recap, so the off-limits check can't catch anything the recap doesn't mention. Bad calls, coaching and fanbase meltdowns are rarely detectable from scores alone.
