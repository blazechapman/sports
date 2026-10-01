/**
 * Finalize: turns a moment and its template into a Meme Queue row (a readable tab in the
 * data sheet) and a one-row CSV in your Drive's "Meme Lab Exports" folder, for After Effects.
 * Claude writes the on-image text (Text 1–3) and the Instagram caption in your meme voice.
 * Team numbers come from the "Teams <league>" tabs (see Teams.gs).
 */

const QUEUE_TAB = 'Meme Queue';
const QUEUE_HEADER = ['Queue ID', 'Finalized', 'Post date', 'Post window', 'Post time', 'League', 'Template', 'Format',
  'Winner', 'Winner #', 'Loser', 'Loser #', 'Winner score', 'Loser score', 'Text 1', 'Text 2', 'Text 3',
  'Instagram caption', 'Hashtags', 'Moment'];
const EXPORT_FOLDER = 'Meme Lab Exports';

function memeTextSchema_() {
  return {
    type: 'object',
    properties: { text1: { type: 'string' }, text2: { type: 'string' }, text3: { type: 'string' }, caption: { type: 'string' } },
    required: ['text1', 'text2', 'text3', 'caption'],
    additionalProperties: false,
  };
}

/** On-image text and caption for a moment + template: Claude if there's a key, else from the moment. */
function memeText_(m, t) {
  const fallback = {
    text1: m.concept || m.headline || '', text2: '', text3: '',
    caption: m.captionStarter || (m.winner + ' ' + m.winnerScore + '-' + m.loserScore + ' over ' + m.loser + '.'),
  };
  const key = claudeKey_();
  if (!key) return fallback;
  const system = 'You write the text for a sports meme for @sportsmemery, to be placed in After Effects. ' +
    'text1, text2 and text3 are the on-image text layers in the order the template uses them (top/bottom, panels, labels); ' +
    'leave unused ones as "". caption is the Instagram caption.' + voicePrompt_();
  const facts = {
    template: t ? t.name : '(none picked)', how_the_template_works: t ? t.how || '' : '',
    league: m.league, winner: m.winner, loser: m.loser, score: m.winnerScore + '-' + m.loserScore,
    headline: m.headline || '', what_happened: m.description || '', concept: m.concept || '', angles: m.useCases || [],
  };
  try {
    const req = claudeRequest_(key, system, JSON.stringify(facts), memeTextSchema_(), 2000);
    const url = req.url;
    delete req.url;
    const r = UrlFetchApp.fetch(url, req);
    return Object.assign(fallback, claudeResult_(r.getResponseCode(), r.getContentText()));
  } catch (e) {
    console.warn('meme text failed: ' + e.message);
    return fallback;
  }
}

function csvCell_(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('EXPORT_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* deleted: make a new one */ }
  }
  const folder = DriveApp.createFolder(EXPORT_FOLDER);
  props.setProperty('EXPORT_FOLDER_ID', folder.getId());
  return folder;
}

/** input: { momentId, templateId, hashtags }. Returns { queueId, csvName, csvUrl, texts }. */
function finalize_(input) {
  input = input || {};
  const momentId = String(input.momentId || '');
  const m = momentId && getDoc_('moments', momentId);
  if (!m) throw new Error('That moment is gone. Refresh and try again.');
  const templateId = input.templateId ? String(input.templateId) : '';
  const t = templateId ? getDoc_('templates', templateId) : null;
  const texts = memeText_(m, t);
  const now = new Date();
  const queueId = Utilities.formatDate(now, POST_TZ, 'yyyyMMdd-HHmmss');
  const fmt = t && t.format === 'Carousel' ? 'Carousel' : 'Reel';
  const row = [queueId, now.toISOString(), m.postDate || '', m.postWindow || '', m.postTime || '', m.league || '', t ? t.name : '', fmt,
    m.winner || '', teamNumber_(m.league, m.winner), m.loser || '', teamNumber_(m.league, m.loser),
    m.winnerScore == null ? '' : m.winnerScore, m.loserScore == null ? '' : m.loserScore,
    texts.text1, texts.text2, texts.text3, texts.caption, String(input.hashtags || '').slice(0, 300), m.headline || m.description || ''];

  withLock_(() => appendRows_(plainTab_(QUEUE_TAB, QUEUE_HEADER, true), [row.map((v) => String(v))], true));
  const csv = [QUEUE_HEADER, row].map((r) => r.map(csvCell_).join(',')).join('\r\n') + '\r\n';
  const name = [m.postDate || queueId, m.league, (m.winner || '') + '-' + (m.loser || ''), t ? t.name : ''].filter(Boolean).join(' ')
    .replace(/[\\/:*?"<>|]+/g, '').slice(0, 120) + '.csv';
  const file = exportFolder_().createFile(name, csv, MimeType.CSV);

  withLock_(() => {
    writeDocs_(sheetFor_('moments'), 'moments', [{ id: momentId, data: Object.assign({}, m, {
      status: 'queued', templateId: templateId || m.templateId || null, finalizedAt: now.toISOString(), queueId: queueId,
      csvUrl: file.getUrl(), csvName: name, text1: texts.text1, text2: texts.text2, text3: texts.text3, finalCaption: texts.caption,
    }) }]);
    if (t) writeDocs_(sheetFor_('templates'), 'templates', [{ id: templateId, data: Object.assign({}, t, { lastUsed: now.toISOString(), timesUsed: (t.timesUsed || 0) + 1 }) }]);
  });
  return { queueId: queueId, csvName: name, csvUrl: file.getUrl(), texts: texts };
}
