/*
 * The same page runs in two places:
 *   - inside Apps Script, where google.script.run is already there;
 *   - as the installed Meme Lab app on Cloudflare, where it talks to the engine
 *     (apps-script/Api.gs) over the web with this device's key.
 * The engine's address and key are kept on this device only, never in the app's code.
 */
(function () {
  if (window.google && google.script && google.script.run) return;
  const STORE = "memelab-connection";
  let connection = null;
  try { connection = JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) {}
  const save = (c) => { connection = c; try { localStorage.setItem(STORE, JSON.stringify(c)); } catch (e) {} };
  const forget = () => { connection = null; try { localStorage.removeItem(STORE); } catch (e) {} };

  /** One line with the engine's address and key, to set up another device. */
  const code = (c) => "MLAB1." + btoa(JSON.stringify({ u: c.url, k: c.key }));
  /** A setup code, a setup link, or nothing usable (null). */
  function parse(text) {
    const m = /MLAB1\.([A-Za-z0-9+\/=_-]+)/.exec(String(text || ""));
    if (!m) return null;
    try {
      const o = JSON.parse(atob(m[1].replace(/-/g, "+").replace(/_/g, "/")));
      return o.u && o.k ? { url: o.u, key: o.k } : null;
    } catch (e) { return null; }
  }

  function call(fn, args, c) {
    const conn = c || connection;
    if (!conn) return Promise.reject(new Error("This device isn’t connected yet."));
    return fetch(conn.url, {
      method: "POST", redirect: "follow", credentials: "omit",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // a plain request, so no extra permission check
      body: JSON.stringify({ key: conn.key, fn, args: args || [] }),
    }).then((r) => {
      if (!r.ok) throw new Error("The engine answered " + r.status + ". Check the engine link.");
      return r.json().catch(() => {
        throw new Error("The engine sent back something unexpected. Check it’s deployed as Execute as: Me, Who has access: Anyone.");
      });
    }, () => {
      throw new Error("Couldn’t reach the engine. Check your connection.");
    }).then((res) => {
      if (res.ok) return res.result;
      const err = new Error(res.error || "Something went wrong.");
      err.code = res.code;
      if ((res.code === "badkey" || res.code === "nokey") && !c) showConnect(err.message);
      throw err;
    });
  }

  // google.script.run, answered by the engine, so the rest of the page works unchanged.
  function runner(h) {
    return new Proxy({}, { get(_, fn) {
      if (fn === "withSuccessHandler") return (f) => runner({ ok: f, fail: h.fail });
      if (fn === "withFailureHandler") return (f) => runner({ ok: h.ok, fail: f });
      return (...args) => { call(fn, args).then((r) => h.ok && h.ok(r), (e) => h.fail && h.fail(e)); };
    } });
  }
  window.google = { script: { run: runner({}) } };

  // ---- Connect screen and the "This device" panel ----
  const css = document.createElement("style");
  css.textContent = `
    .cx-veil{position:fixed;inset:0;z-index:50;background:var(--bg);overflow:auto;padding:max(24px,env(safe-area-inset-top)) 16px 32px}
    .cx-card{max-width:520px;margin:0 auto;display:grid;gap:12px}
    .cx-card textarea{min-height:64px;font-family:var(--mono);font-size:13px}
    .cx-card .box{font-family:var(--mono);font-size:12px;background:var(--sunk);border-radius:4px;padding:8px;word-break:break-all}
    .cx-msg{color:var(--bad);font-weight:600}
    .cx-device{position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));z-index:40}`;
  document.head.appendChild(css);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  let veil = null;
  function open(html) {
    close();
    veil = document.createElement("div");
    veil.className = "cx-veil";
    veil.innerHTML = `<div class="panel cx-card">${html}</div>`;
    document.body.appendChild(veil);
    return veil;
  }
  function close() { if (veil) veil.remove(); veil = null; }
  const setupLink = () => location.origin + location.pathname + "#connect=" + code(connection);

  function copy(text) {
    const done = () => { const t = document.getElementById("toast"); if (t) { t.textContent = "Copied"; t.hidden = false; setTimeout(() => { t.hidden = true; }, 1800); } };
    const fallback = () => { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} ta.remove(); done(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  function showConnect(message, prefill) {
    const v = open(`<h2>Connect this device</h2>
      <p class="sub">Paste the setup code from a connected device. The first time, use the engine link and app key from Apps Script instead.</p>
      <label>Setup code <textarea id="cx-code" autocomplete="off" autocapitalize="off" spellcheck="false">${esc(prefill || "")}</textarea></label>
      <p class="note">or, the first time</p>
      <label>Engine link (the app deployment’s Web app URL, ending in /exec)
        <input type="text" id="cx-url" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label>App key (from makeAppKey in Apps Script)
        <input type="text" id="cx-key" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <p class="cx-msg" id="cx-msg">${esc(message || "")}</p>
      <div class="actions"><button class="btn primary" type="button" id="cx-go">Connect</button></div>
      <p class="note">The link and key stay on this device. Nothing about them is in the app’s code.</p>`);
    const go = v.querySelector("#cx-go");
    go.addEventListener("click", () => {
      const val = (id) => v.querySelector(id).value.trim();
      let c = parse(val("#cx-code"));
      if (!c && val("#cx-url") && val("#cx-key")) c = { url: val("#cx-url"), key: val("#cx-key") };
      const msg = v.querySelector("#cx-msg");
      if (!c) { msg.textContent = "Paste a setup code, or the engine link and the key."; return; }
      if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(c.url)) { msg.textContent = "The engine link should start with https://script.google.com/"; return; }
      go.disabled = true; go.textContent = "Connecting…"; msg.textContent = "";
      call("ping", [], c).then(() => {
        save(c);
        history.replaceState(null, "", location.pathname + location.search);
        location.reload();
      }, (err) => { go.disabled = false; go.textContent = "Connect"; msg.textContent = err.message; });
    });
    if (prefill) go.click();
  }

  function showDevice() {
    const v = open(`<h2>This device</h2>
      <p class="sub">Connected to your engine.</p>
      <h3>Set up another device</h3>
      <p class="note">Send this link to yourself (AirDrop, Notes, Messages) and open it there. On iPhone and iPad, add the app to the home screen first, open it from there, and paste the setup code.</p>
      <div class="box">${esc(setupLink())}</div>
      <div class="actions"><button class="btn" type="button" data-copy="link">Copy setup link</button><button class="btn" type="button" data-copy="code">Copy setup code</button></div>
      <p class="note">The link and code contain your key, so only send them to yourself. If one gets out, run makeAppKey again in Apps Script and reconnect your devices.</p>
      <div class="actions"><button class="btn primary" type="button" id="cx-done">Done</button><button class="btn" type="button" id="cx-forget">Disconnect this device</button></div>`);
    v.querySelector('[data-copy="link"]').addEventListener("click", () => copy(setupLink()));
    v.querySelector('[data-copy="code"]').addEventListener("click", () => copy(code(connection)));
    v.querySelector("#cx-done").addEventListener("click", close);
    v.querySelector("#cx-forget").addEventListener("click", () => { forget(); showConnect(); });
  }

  const fromLink = parse(decodeURIComponent(location.hash));
  if (fromLink && (!connection || connection.key !== fromLink.key || connection.url !== fromLink.url)) {
    showConnect("", code(fromLink));
  } else {
    if (fromLink) history.replaceState(null, "", location.pathname + location.search);
    if (!connection) showConnect();
  }
  const btn = document.createElement("button");
  btn.className = "btn small cx-device";
  btn.type = "button";
  btn.textContent = "⚙ This device";
  btn.addEventListener("click", () => (connection ? showDevice() : showConnect()));
  document.body.appendChild(btn);

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
  }
})();
