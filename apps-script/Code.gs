/**
 * Meme Lab — Apps Script version.
 * Serves the web app and the functions the page calls through google.script.run.
 * Data lives in a Google Sheet (see Store.gs); run setup() once from the editor first.
 */

function doGet() {
  // The Cloudflare app's deployment ("Execute as: Me", "Anyone") only answers the app, with your
  // key (Api.gs). This page is only handed to you, so on that deployment a stranger with the
  // address gets nothing.
  if (!isOwner_()) {
    return HtmlService.createHtmlOutput('<p style="font:16px sans-serif;padding:24px">This is the engine behind the Meme Lab app. ' +
      'Open the app instead.</p>').setTitle('Meme Lab');
  }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Meme Lab')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** True when the person running this is you (the script's owner). */
function isOwner_() {
  let who = '', me = '';
  try { who = Session.getActiveUser().getEmail(); me = Session.getEffectiveUser().getEmail(); } catch (e) { /* no one */ }
  return !!who && who === me;
}

/**
 * Called first by every function the page or the editor can run. On the "Anyone" deployment,
 * anyone with the address could otherwise call them from the page without the app key.
 */
function ownerOnly_() {
  if (!isOwner_()) throw new Error('Only the owner of this script can do that.');
}

/** Used by Index.html to pull in Styles, DbClient and App. */
function include(name) {
  if (['Styles', 'DbClient', 'App'].indexOf(name) < 0) throw new Error('Unknown page part: ' + name);
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ---- Functions the page calls (google.script.run) ----

const MOMENTS_IN_SNAPSHOT = 300; // newest moments sent to the page
const SCAN_COOLDOWN_MS = 10 * 60 * 1000;

// Each apiX is what the Apps Script page calls (owner only); the Cloudflare app reaches the same
// work through Api.gs with its key.
function apiSnapshot() { ownerOnly_(); return snapshot_(); }
function apiAdd(col, data) { ownerOnly_(); return add_(col, data); }
function apiSet(col, id, data) { ownerOnly_(); return set_(col, id, data); }
function apiUpdate(col, id, patch) { ownerOnly_(); return update_(col, id, patch); }
function apiDelete(col, id) { ownerOnly_(); return delete_(col, id); }
function apiSuggest(input) { ownerOnly_(); return suggest_(input); }
function apiScan(feeds) { ownerOnly_(); return scanButton_(feeds); }

/** Everything the page shows, in one call. */
function snapshot_() {
  const moments = listDocs_('moments')
    .sort((a, b) => String(b.data.createdAt || '').localeCompare(String(a.data.createdAt || '')))
    .slice(0, MOMENTS_IN_SNAPSHOT);
  return { templates: listDocs_('templates'), moments: moments, meta: listDocs_('meta') };
}

function add_(col, data) {
  checkData_(data);
  const id = newId_();
  withLock_(() => writeDocs_(sheetFor_(col), col, [{ id: id, data: data }]));
  return { id: id };
}

function set_(col, id, data) {
  checkId_(id);
  checkData_(data);
  withLock_(() => writeDocs_(sheetFor_(col), col, [{ id: id, data: data }]));
  return { id: id };
}

function update_(col, id, patch) {
  checkId_(id);
  checkData_(patch);
  withLock_(() => {
    const sh = sheetFor_(col);
    const current = findDoc_(sh, id);
    if (!current) throw new Error('Not found: ' + col + '/' + id);
    writeDocs_(sh, col, [{ id: id, data: Object.assign({}, current, patch) }]);
  });
  return { id: id };
}

function delete_(col, id) {
  checkId_(id);
  withLock_(() => deleteDoc_(sheetFor_(col), id));
  return { id: id };
}

/** "Suggest use cases" on the Add template tab. Returns the suggestion or { error }. */
function suggest_(input) {
  input = input || {};
  return suggestUseCases_(String(input.name || ''), String(input.how || ''));
}

/**
 * "Check for new moments" on the Today tab, and the check when the app opens. `feeds` are the
 * ESPN scoreboards fetched on your device (ESPN blocks Google). At most once every 10 minutes.
 */
function scanButton_(feeds) {
  const last = getDoc_('meta', 'refresh');
  if (last && last.at && Date.now() - new Date(last.at).getTime() < SCAN_COOLDOWN_MS) {
    return { error: 'cooldown', at: last.at };
  }
  const at = new Date().toISOString();
  withLock_(() => writeDocs_(sheetFor_('meta'), 'meta', [{ id: 'refresh', data: { at: at } }]));
  return runScan_(Array.isArray(feeds) ? { feeds: feeds } : undefined);
}

function checkId_(id) {
  if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Bad id');
}

function checkData_(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Bad data');
}
