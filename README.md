# Meme Lab

Web app version of the Meme Lab artifact (@sportsmemery): match a sports moment to the right meme template, then queue it.

**Stack:** Cloudflare Pages (static UI in `public/`) + Pages Functions (`functions/api/`) + D1 (SQLite).

## Layout

| Path | What |
|---|---|
| `public/index.html`, `styles.css`, `app.js` | UI ported from the artifact (Today, Match, Library, Add, Use cases tabs) |
| `public/db.js` | Small Firestore-style client over `/api`, so `app.js` stays close to the artifact code. Polls every 15s for updates. |
| `functions/api/suggest.js` | `POST /api/suggest`: asks Claude (Opus 5.5, low effort, JSON-schema output) to tag a template with use cases, format and tone |
| `functions/api/[[path]].js` | REST API: `GET/POST /api/:collection`, `GET/PUT/PATCH/DELETE /api/:collection/:id` (collections: `templates`, `moments`, `meta`) |
| `migrations/` | D1 schema (one `docs` table holding JSON documents) |
| `data/export/` | Templates and moments exported from the artifact on 2026-09-28 |
| `scripts/build-seed.mjs` | Turns `data/export/` into `data/seed.sql` |

## Run locally

```sh
npm install
npm run db:migrate:local
npm run db:seed:local
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .dev.vars   # optional: enables Claude suggestions
npm run dev            # http://localhost:8788
```

## Deploy to Cloudflare

```sh
npx wrangler login
npx wrangler d1 create memelab      # paste the database_id into wrangler.toml
npm run db:migrate
npm run db:seed
npx wrangler pages project create memelab
npx wrangler pages secret put ANTHROPIC_API_KEY --project-name memelab
npm run deploy
```

If the D1 binding isn't picked up from `wrangler.toml`, add it in the dashboard: Pages → Settings → Bindings → D1, variable `DB`.

**The API has no auth.** Put the site behind Cloudflare Access (Zero Trust → Access → Applications) before you share the URL.

## Claude suggestions

The "Suggest use cases" button on the Add template tab calls `/api/suggest`. If `ANTHROPIC_API_KEY` isn't set or the call fails, it falls back to keyword matching. Requests use server-side refusal fallback (`fallbacks: "default"`), so a declined request is retried on another model automatically.

## Not yet ported

- **Check for new moments**: the artifact fired a Claude Code Routine. The button is hidden for now. Next step: have the daily scan write to this app's API (a Routine or a Cloudflare Cron Worker), then wire the button to it.
