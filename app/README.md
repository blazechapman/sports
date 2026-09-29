# Meme Lab (the installed app)

The same Meme Lab as `apps-script/`, installed like a real app on iPhone, iPad, Mac and PC: its own icon, full-screen, no browser bar. It's hosted on Cloudflare (Workers) straight from this repo, and it talks to your Apps Script "engine" with a private key. Your data stays in your Google Sheet, so a change made in the app or in Apps Script shows up in both.

- The page is the Apps Script page (`apps-script/Index.html` and its parts). `npm run build:app` (run automatically by `npx wrangler deploy`) copies it into `app/dist/` with `app/engine.js` (the connection), the icons, the app manifest, the offline shell (`sw.js`) and privacy headers.
- The engine's front door is `apps-script/Api.gs`. It only answers with your key, and only the app's own calls.
- The engine's address and key are stored on each device, never in this repo.
- Search engines are told to stay away (`robots.txt`, `X-Robots-Tag`), and the page can't be framed by other sites.

## One-time setup

### 1. Apps Script (the engine)
1. Add a new **Script** file named `Api` and paste in `apps-script/Api.gs`. Also replace **Code**, **Setup**, **Scan** and **Claude** with the current versions from `apps-script/`: they now only answer you, so the new "Anyone" deployment can't be used without the key.
2. Save. **Deploy → New deployment →** gear → **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click **Deploy** (authorize if asked) and copy the **Web app URL** (ends in `/exec`). Keep your existing "Only myself" deployment too; it keeps working as before.
3. In the toolbar, pick the `Api` file, choose **makeAppKey** in the function menu, click **Run**. The key appears in the **Execution log**. Copy it.

### 2. Cloudflare (the app)
1. Sign in at dash.cloudflare.com.
2. **Compute → Workers & Pages → Create application → Import a repository.** Connect GitHub and give Cloudflare access to **only** the `sports` repo.
3. Set up the application:
   - Project name: `sports` (it has to match `name` in `wrangler.jsonc`)
   - Production branch: `claude/bold-wozniak-0wbuyq` (or `main` once this is merged)
   - Build command: leave empty
   - Deploy command: `npx wrangler deploy` (already filled in; it builds the app first, via `wrangler.jsonc`)
   - Enable Preview builds: off
4. **Deploy.** After a minute the app is at `sports.<your subdomain>.workers.dev`.
5. Your subdomain is the same one your Brackets app uses. To make the address less obvious, rename the subdomain under **Workers & Pages → Account details → Subdomain**. That changes the Brackets address too.

### 3. Each device
- **Computer:** open the app's address, paste the engine link and key, **Connect**. Then install it: in Chrome/Edge, use the install icon in the address bar; in Safari on Mac, use **File → Add to Dock**.
- **Other devices:** on a connected device, tap **⚙ This device → Copy setup code**, and send it to yourself (AirDrop, Notes, Messages).
- **iPhone / iPad:** open the app's address in Safari → **Share → Add to Home Screen**. Open it from the home screen and paste the setup code. (A home screen app keeps its own storage, separate from Safari, which is why the code is pasted there.)

If a device is lost, run **makeAppKey** again: every device needs the new code, and the old key stops working.

## Updates

- Changes to the page, icons or app files: pushed to the repo, and Cloudflare rebuilds the app by itself. Nothing to paste.
- Changes to `.gs` files: paste them into Apps Script as usual, then **Manage deployments →** edit the **app deployment** (Who has access: Anyone) → Version: **New version** → Deploy. The engine link stays the same. Do the same for your "Only myself" deployment if you use it.

## Icons

`node scripts/make-icons.mjs` redraws `app/public/*.png` from `app/icon.svg`.
