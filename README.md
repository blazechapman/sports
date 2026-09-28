# Meme Lab

Web app version of the Meme Lab artifact (@sportsmemery): match a sports moment to the right meme template, then queue it.

**Stack:** Cloudflare Pages (static UI in `public/`) + Pages Functions (`functions/api/`) + D1 (SQLite).

## Layout

| Path | What |
|---|---|
| `public/index.html`, `styles.css`, `app.js` | UI ported from the artifact (Today, Match, Library, Add, Use cases tabs) |
| `public/db.js` | Small Firestore-style client over `/api`, so `app.js` stays close to the artifact code. Polls every 15s for updates. |
| `functions/api/[[path]].js` | REST API: `GET/POST /api/:collection`, `GET/PUT/PATCH/DELETE /api/:collection/:id` (collections: `templates`, `moments`, `meta`) |
| `migrations/` | D1 schema (one `docs` table holding JSON documents) |
| `data/export/` | Templates and moments exported from the artifact on 2026-09-28 |
| `scripts/build-seed.mjs` | Turns `data/export/` into `data/seed.sql` |

## Run locally

```sh
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev            # http://localhost:8788
```

## Deploy to Cloudflare

```sh
npx wrangler login
npx wrangler d1 create memelab      # paste the database_id into wrangler.toml
npm run db:migrate
npm run db:seed
npx wrangler pages project create memelab
npm run deploy
```

If the D1 binding isn't picked up from `wrangler.toml`, add it in the dashboard: Pages → Settings → Bindings → D1, variable `DB`.

**The API has no auth.** Put the site behind Cloudflare Access (Zero Trust → Access → Applications) before you share the URL.

## Not yet ported

- **Suggest use cases with Claude**: the artifact used its built-in `sample` capability. The app currently falls back to keyword matching. Next step: a `/api/suggest` Function that calls the Claude API with an `ANTHROPIC_API_KEY` secret.
- **Check for new moments**: the artifact fired a Claude Code Routine. The button is hidden for now. Next step: have the daily scan write to this app's API (a Routine or a Cloudflare Cron Worker), then wire the button to it.
