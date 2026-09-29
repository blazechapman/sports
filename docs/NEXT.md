# Meme Lab: next version

Notes from the user after the first real use (2026-09-29). Start the next session from here.

## Current setup
- Apps Script is the engine (`apps-script/`): data in the "Meme Lab Data" Google Sheet, ESPN scan on triggers, Claude via `ANTHROPIC_API_KEY` in Script Properties.
- The installed app is on Cloudflare Workers (project `sports`, root `wrangler.jsonc`, `app/`), connected to the engine's "Anyone" deployment with the app key (`apps-script/Api.gs`), the same pattern as the Brackets app in `blazechapman/music`.
- After changing `.gs` or HTML files in Apps Script: Manage deployments → edit → New version. Cloudflare redeploys by itself on push.

## Done
- **Tabs across the top showed every page at once.** Fixed on 2026-09-29: the port had dropped the `[hidden]{display:none!important}` rule from the artifact's page wrapper (now in `public/styles.css`). Apps Script needs the regenerated `Styles.html` pasted in, plus a new version.

## To do
1. **Queued rows go straight into the Meme Queue sheet.** Today "Copy row" only copies tab-separated text for pasting into column C. The Meme Queue drives After Effects automation, so "Mark queued" should append the row itself. Ask the user for the Meme Queue spreadsheet (link or ID), the tab name, and the column layout (the current row is 14 fields starting at column C: date added, blank, post date, post time, urgency, league, storyline, template, pillar, format, concept, caption, hashtags, use cases). Confirm what After Effects reads, so the columns match exactly.
2. **Let the app do more of the thinking, using the user's criteria.** The user wants the app to decide more on its own: pick the template, write the concept and caption, and set timing and priority from their rules (use cases, blowout margins, Cat Watch, off-limits, rotation, post times), so their job is approving rather than filling in. Ask which decisions they still make by hand most often.
3. **Plan-ahead page.** A new tab: choose how far ahead (for example this weekend, 7 days, 14 days), run it, and get meme ideas to prep for upcoming games, as "if this happens, you'll have this meme" scenarios (upset, blowout, rivalry, milestone within reach, revenge game). Likely sources: ESPN scoreboards for future dates (schedules, rankings, odds where present), plus one Claude call to write the scenarios, matched against the template library. Save picks so they surface on the Today tab when the game ends.

## Also pending
- The artifact's old scan Routine (`trig_01X3UnRSzVMWYpWz4czfaApb`) still writes moments into the artifact. Turn it off once the Sheet's own scans are confirmed.
- The `sports` repo is public (no secrets, but templates and ideas are visible). The user may make it private.
- The Brackets engine in `blazechapman/music` has the owner-check gap that was fixed here (suggested as a separate task).
