/**
 * The front door for the installed Meme Lab app on Cloudflare (see app/README.md).
 *
 * The app sends {key, fn, args} here and gets back {ok, result} or {ok: false, error}.
 * Only the calls listed below can be made, and only with your key. The key lives in this
 * script's settings and on your devices, never in the app's code.
 *
 * This needs its own deployment: Deploy > New deployment > Web app,
 *   Execute as: Me,  Who has access: Anyone.
 * ("Anyone" lets the app reach it without a Google sign-in; the key is what keeps it yours.)
 *
 * Run makeAppKey() from the editor once to make the key. Running it again makes a new
 * key, and every device has to connect again (use that if a phone is lost).
 */

const APP_KEY_PROPERTY = 'APP_KEY';

/** The calls the app may make. Anything else is refused. */
function apiCalls_() {
  return {
    apiSnapshot: snapshot_,
    apiAdd: add_,
    apiSet: set_,
    apiUpdate: update_,
    apiDelete: delete_,
    apiSuggest: suggest_,
    apiScan: scanButton_,
    apiPlan: plan_,
    apiSaveTeams: saveTeams_,
    apiFinalize: finalize_,
    ping: () => ({ ok: true }),
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Same length and every character compared, so the time taken doesn't hint at the key. */
function sameKey_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'That request couldn\'t be read.' });
  }
  const key = PropertiesService.getScriptProperties().getProperty(APP_KEY_PROPERTY);
  if (!key) return json_({ ok: false, error: 'The app key hasn\'t been made yet. Run makeAppKey in Apps Script.', code: 'nokey' });
  if (!sameKey_(req.key, key)) return json_({ ok: false, error: 'This device\'s key doesn\'t match. Connect it again.', code: 'badkey' });
  const calls = apiCalls_();
  if (!Object.prototype.hasOwnProperty.call(calls, req.fn)) return json_({ ok: false, error: 'Unknown call: ' + req.fn });
  try {
    const result = calls[req.fn].apply(null, Array.isArray(req.args) ? req.args : []);
    return json_({ ok: true, result: result === undefined ? null : result });
  } catch (err2) {
    return json_({ ok: false, error: (err2 && err2.message) || String(err2) });
  }
}

/**
 * Run this once from the Apps Script editor (select it in the toolbar, click Run).
 * The key shows in the Execution log. Paste it into the app with the deployment's web app URL.
 */
function makeAppKey() {
  ownerOnly_();
  const key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty(APP_KEY_PROPERTY, key);
  console.log('Your app key (keep it private): ' + key);
  Logger.log('Your app key (keep it private): ' + key);
  return key;
}
