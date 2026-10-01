# Meme Lab on Google Apps Script

The whole Meme Lab as a Google web app: the same five tabs, your data in a Google Sheet, new moments from ESPN's scoreboards, and Claude through your API key. You don't need Cloudflare for this version.

| File | Type | What it does |
|---|---|---|
| `appsscript.json` | Manifest (optional) | Time zone (Eastern), V8 runtime, web app settings |
| `Code` | Script | Serves the page and the functions it calls (only to you) |
| `Api` | Script | The front door for the installed Cloudflare app (see `app/README.md`); optional |
| `Store` | Script | Saves templates and moments in the Google Sheet |
| `Rules` | Script | Use cases, blowout margins, Cat Watch teams |
| `Claude` | Script | Calls the Claude API (use-case suggestions) |
| `Scan` | Script | ESPN scan + Claude write-ups for new moments |
| `Setup` | Script | One-time setup: data sheet and your artifact data |
| `Seed` | Script | Your 15 templates and 26 moments from the artifact |
| `Index`, `Styles`, `DbClient`, `App` | HTML | The page |

## 1. Create the project

1. Go to [script.google.com](https://script.google.com) and click **New project**. Rename it **Meme Lab** (click "Untitled project").
2. That's it. `appsscript.json` is optional: the code uses Eastern time on its own, and you pick the web app settings when you deploy (step 5). If your editor offers **Project Settings → Show "appsscript.json" manifest file in editor**, you can paste this folder's copy, but you don't need to.

## 2. Add the files

Click **+** next to **Files** and pick **Script** or **HTML**. Type the name exactly as shown, without an extension; the editor adds `.gs` or `.html`. Names are case-sensitive, and the order doesn't matter.

- **Script:** `Code` (already exists; replace its contents), `Store`, `Rules`, `Claude`, `Scan`, `Setup`, `Seed`, and `Api` if you'll use the Cloudflare app
- **HTML:** `Index`, `Styles`, `DbClient`, `App`

Paste each file's full contents from this folder, then save (Ctrl/Cmd+S).

## 3. Add your Claude API key (optional)

**Project Settings → Script properties → Add script property**
- Property: `ANTHROPIC_API_KEY`
- Value: your key from [console.anthropic.com](https://console.anthropic.com) (starts with `sk-ant-`)

Without a key, everything still works except Claude: scans save moments without concepts and captions, and "Suggest use cases" matches keywords instead.

## 4. Run setup once

1. In the Editor, pick **setup** in the function dropdown at the top, then click **Run**.
2. Google asks for permission: **Review permissions** → your account → "Google hasn't verified this app" → **Advanced** → **Go to Meme Lab (unsafe)** → **Allow**. The warning appears because this is your own unpublished script. It needs:
   - **Google Sheets**, to store your templates and moments
   - **External requests**, to read ESPN scores and call Claude
3. The **Execution log** prints the link to your new **Meme Lab Data** spreadsheet.

Optional checks, both from the same dropdown:
- **testClaude** prints a sample suggestion, which confirms your key works.
- **runScanNow** runs a scan right away and prints what it found.

## 5. Deploy the web app

1. **Deploy → New deployment**, click the gear next to "Select type", choose **Web app**.
2. **Execute as:** Me. **Who has access:** Only myself.
3. Click **Deploy** and copy the **Web app URL**. On your phone, open it in the browser and use **Add to Home Screen**.

## Updating the code

After you change any file: **Deploy → Manage deployments** → pencil icon → **Version: New version** → **Deploy**. The URL stays the same, but it keeps serving the old code until you do this.

`Index`, `Styles`, `App` and `Seed` are generated from the shared web app files. If `public/` changes, run `npm run build:apps-script` and paste those four again.

## Finding new moments

ESPN refuses requests from Google's (and Cloudflare's) servers, so the page fetches yesterday's and today's scoreboards on your own phone or computer and sends the finished games to the engine, which flags them, has Claude write them up and saves them. It happens when you open the app, if the last check was more than 3 hours ago, and when you press **Check for new moments** (at most every 10 minutes). There are no timed scans; if an older setup installed some, run `removeScanTriggers` (or `setup` again) to remove them. `runScanNow` scans from Google's servers and will show ESPN's 403.

## Good to know

- **Keep this deployment on "Only myself".** For the Cloudflare app, make a second deployment set to "Anyone" (see `app/README.md`). Every function the page or editor can run checks that it's you, and the app's calls need the app key.
- **The data sheet has one row per template or moment.** The `data` column holds the full record as JSON. Read it freely, but make edits in the app: a row with broken JSON is skipped.
- **Free Google accounts have daily quotas** (for example 20,000 URL fetches a day). A check uses one fetch per four new games for Claude, well within them.
- **ESPN's scoreboard feed is unofficial** and can change without notice. If a league's feed fails, the other leagues still scan, and the button shows "feed problem".

## Using clasp instead of copy-paste (optional)

If you use [clasp](https://github.com/google/clasp): run `clasp create --type webapp --title "Meme Lab" --rootDir apps-script` from the repo root. If that replaced `appsscript.json`, restore it with `git checkout apps-script/appsscript.json`. Then run `clasp push` and continue from step 3.
