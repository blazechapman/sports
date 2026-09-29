/**
 * Meme Lab — Apps Script version.
 * Serves the web app and the functions the page calls through google.script.run.
 * Data lives in a Google Sheet (see Store.gs); run setup() once from the editor first.
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Meme Lab')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** Used by Index.html to pull in Styles, DbClient and App. */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ---- Functions the page calls (google.script.run) ----

const MOMENTS_IN_SNAPSHOT = 300; // newest moments sent to the page
const SCAN_COOLDOWN_MS = 10 * 60 * 1000;

/** Everything the page shows, in one call. */
function apiSnapshot() {
  const moments = listDocs_('moments')
    .sort((a, b) => String(b.data.createdAt || '').localeCompare(String(a.data.createdAt || '')))
    .slice(0, MOMENTS_IN_SNAPSHOT);
  return { templates: listDocs_('templates'), moments: moments, meta: listDocs_('meta') };
}

function apiAdd(col, data) {
  checkData_(data);
  const id = newId_();
  withLock_(() => writeDocs_(sheetFor_(col), col, [{ id: id, data: data }]));
  return { id: id };
}

function apiSet(col, id, data) {
  checkId_(id);
  checkData_(data);
  withLock_(() => writeDocs_(sheetFor_(col), col, [{ id: id, data: data }]));
  return { id: id };
}

function apiUpdate(col, id, patch) {
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

function apiDelete(col, id) {
  checkId_(id);
  withLock_(() => deleteDoc_(sheetFor_(col), id));
  return { id: id };
}

/** "Suggest use cases" on the Add template tab. Returns the suggestion or { error }. */
function apiSuggest(input) {
  input = input || {};
  return suggestUseCases_(String(input.name || ''), String(input.how || ''));
}

/** "Check for new moments" on the Today tab. At most once every 10 minutes. */
function apiScan() {
  const last = getDoc_('meta', 'refresh');
  if (last && last.at && Date.now() - new Date(last.at).getTime() < SCAN_COOLDOWN_MS) {
    return { error: 'cooldown', at: last.at };
  }
  const at = new Date().toISOString();
  withLock_(() => writeDocs_(sheetFor_('meta'), 'meta', [{ id: 'refresh', data: { at: at } }]));
  return runScan_();
}

function checkId_(id) {
  if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Bad id');
}

function checkData_(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Bad data');
}
