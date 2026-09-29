# Meme Lab: next version

Notes from the user after the first real use (2026-09-29). Start the next session from here.

## Current setup
- Apps Script is the engine (`apps-script/`): data in the "Meme Lab Data" Google Sheet, ESPN scan on triggers, Claude via `ANTHROPIC_API_KEY` in Script Properties.
- The installed app is on Cloudflare Workers (project `sports`, root `wrangler.jsonc`, `app/`), connected to the engine's "Anyone" deployment with the app key (`apps-script/Api.gs`), the same pattern as the Brackets app in `blazechapman/music`.
- After changing `.gs` or HTML files in Apps Script: Manage deployments → edit → New version. Cloudflare redeploys by itself on push.

## Done
- **Tabs across the top showed every page at once.** Fixed on 2026-09-29: the port had dropped the `[hidden]{display:none!important}` rule from the artifact's page wrapper (now in `public/styles.css`). Apps Script needs the regenerated `Styles.html` pasted in, plus a new version.

## To do
0. **Fix first: every ESPN feed fails from Apps Script.** After the first real "Check for new moments", the app showed "10 feed problems" (all 5 leagues × 2 days). Existing moments load fine. Most likely ESPN blocks requests from Google's servers (UrlFetchApp). Steps:
   - Get the codes: run `runScanNow` in the editor and read `errors` (for example "NFL feed 403").
   - If it's a block (403/429/empty): add a small ESPN pass-through to the Cloudflare Worker (for example `/espn/<sport>/<league>/scoreboard?...`, allowing only those paths, with the app key or a shared secret), and point `scoreboardUrl_` in `apps-script/Scan.gs` at it. Cloudflare's servers usually aren't blocked.
   - Also show the first error text on the Today tab (not just the count), so the cause is visible without the editor.
1. **Queued rows go straight into the Meme Queue sheet.** Today "Copy row" only copies tab-separated text for pasting into column C. The Meme Queue drives After Effects automation, so "Mark queued" should append the row itself. Ask the user for the Meme Queue spreadsheet (link or ID), the tab name, and the column layout (the current row is 14 fields starting at column C: date added, blank, post date, post time, urgency, league, storyline, template, pillar, format, concept, caption, hashtags, use cases). Confirm what After Effects reads, so the columns match exactly.
2. **Let the app do more of the thinking, using the user's criteria.** The user wants the app to decide more on its own: pick the template, write the concept and caption, and set timing and priority from their rules (use cases, blowout margins, Cat Watch, off-limits, rotation, post times), so their job is approving rather than filling in. Ask which decisions they still make by hand most often.
3. **Plan-ahead page.** A new tab: choose how far ahead (for example this weekend, 7 days, 14 days), run it, and get meme ideas to prep for upcoming games, as "if this happens, you'll have this meme" scenarios (upset, blowout, rivalry, milestone within reach, revenge game). Likely sources: ESPN scoreboards for future dates (schedules, rankings, odds where present), plus one Claude call to write the scenarios, matched against the template library. Save picks so they surface on the Today tab when the game ends.
4. **Gator Watch for the Chubbs meme.** A use case like Cat Watch, tied to the Chubbs template. The joke is that Chubbs is terrified of gators (one took his hand), so the meme only fits when **a team is spooked by the Gators**: the opponent is Chubbs, and the gator head is Florida.
   - **Flag it when Florida beats a team**, especially a blowout, an upset, or a team Florida keeps beating. The losing team's logo goes on Chubbs.
   - **Plan ahead:** a team about to play Florida is a good "Chubbs opening the present" setup (ties into the plan-ahead page, item 3).
   - **Don't flag Florida losses.** The meme doesn't work when the Gators are the ones losing.
   - Keep the rule from the template notes: no jokes about the window fall.
   - The library has two Chubbs entries. Use the active one, "Chubs Open Present and It's a Gator Head" (id `ftk57j047c1o6unz569w`, tagged blowout and meltdown). The other, "Chubbs Gets the Gator Head (Happy Gilmore)" (`chubbs-gator-head`), is a retired duplicate. Its "how it works" notes include a "Florida loses, the dead gator is the trophy" angle, which the user says doesn't work; don't carry that over.
   - Add `gator_watch` to the use-case lists in `public/app.js`, `apps-script/Rules.gs` and `lib/rules.js`, and check the ESPN names ("Florida" / "Florida Gators") in the scan.
5. **Meme Timer: auto-dismiss stale moments.** A moment on the Today tab that you don't act on (queue, open in matcher, or dismiss) should dismiss itself once its window has passed, so the list only shows what's still postable. Ideas to confirm with the user:
   - how long: a fixed time (for example 24 or 48 hours), or tied to urgency (a "Post today" moment expires at the end of its post date, a batch or Meme of the Week candidate lasts longer)
   - show a countdown on each card ("expires in 5h"), so it's clear what's about to go
   - run the cleanup in the scheduled scan (`apps-script/Scan.gs`), and mark expired moments with their own status (such as `expired`) instead of `dismissed`, so they can be told apart and restored
   - never auto-dismiss something already queued
6. **Always prioritize Fresh templates unless a Classic is truly the best fit.** Today the ranking gives Fresh only +1, against +3 per matching use case (`scoreTemplate` in `public/app.js`; the scan and Claude prompts should follow the same rule). Change it so a Fresh template that fits the moment always ranks above a Classic, and a Classic only comes first when it clearly fits better (for example it matches clearly more of the moment's use cases, or it's the signature meme for that situation, like Chubbs for Gator Watch). Show the reason on the card ("Classic: best fit for …") when a Classic wins.

## Also pending
- The artifact's old scan Routine (`trig_01X3UnRSzVMWYpWz4czfaApb`) still writes moments into the artifact. Turn it off once the Sheet's own scans are confirmed.
- The `sports` repo is public (no secrets, but templates and ideas are visible). The user may make it private.
- The Brackets engine in `blazechapman/music` has the owner-check gap that was fixed here (suggested as a separate task).
