/**
 * One-time setup. Run setup() from the Apps Script editor (select it, then Run).
 * It is safe to run again: existing data is kept and the triggers are replaced.
 */
function setup() {
  ownerOnly_();
  const props = PropertiesService.getScriptProperties();
  let ss = null;
  const id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  }
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet(); // script made from a spreadsheet: use that one
  if (!ss) ss = SpreadsheetApp.create('Meme Lab Data');
  props.setProperty('SPREADSHEET_ID', ss.getId());

  MEMELAB_COLLECTIONS.forEach((col) => {
    const sh = ss.getSheetByName(col) || ss.insertSheet(col);
    sh.getRange('A:D').setNumberFormat('@');
    if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, 4).setValues([MEMELAB_HEADER]);
    sh.setFrozenRows(1);
  });
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  // Load the templates and moments exported from the Meme Lab artifact into empty tabs.
  let seeded = 0;
  ['templates', 'moments'].forEach((col) => {
    const sh = ss.getSheetByName(col);
    if (sh.getLastRow() <= 1 && SEED_DATA[col]) {
      seeded += withLock_(() => writeDocs_(sh, col, SEED_DATA[col]));
    }
  });

  voiceTab_(); // the Meme Voice tab, with a starter style guide
  removeScanTriggers_(); // ESPN blocks Google's servers; the app scans from your device instead

  Logger.log('Data spreadsheet: ' + ss.getUrl());
  Logger.log(seeded ? 'Loaded ' + seeded + ' templates and moments from the artifact.' : 'Existing data kept.');
  Logger.log('New moments are found when you open the app (at most every 3 hours) or press Check for new moments.');
  Logger.log(props.getProperty('ANTHROPIC_API_KEY')
    ? 'Claude API key found.'
    : 'No ANTHROPIC_API_KEY yet. Add it under Project Settings → Script properties to turn on Claude.');
}

function removeScanTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'scheduledScan')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/** Removes the scheduled scans an earlier setup installed (they fail: ESPN blocks Google). */
function removeScanTriggers() {
  ownerOnly_();
  voiceTab_(); // the Meme Voice tab, with a starter style guide
  removeScanTriggers_();
  Logger.log('Scheduled scans removed.');
}
