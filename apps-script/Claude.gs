/**
 * Claude API calls through UrlFetchApp (Apps Script can't use the Anthropic SDK).
 * The key lives in Script Properties as ANTHROPIC_API_KEY.
 */

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-opus-5-5';

function claudeKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  return key ? key.trim() : null; // pasted keys often carry a stray space or line break
}

/**
 * A UrlFetchApp request asking Claude for JSON that matches `schema`.
 * Low effort keeps these quick tagging and writing jobs fast and cheap; `fallbacks: 'default'`
 * re-runs a declined request on another model server-side.
 */
function claudeRequest_(key, system, userText, schema, maxTokens) {
  return {
    url: CLAUDE_URL,
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    payload: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: schema } },
      system: system,
      messages: [{ role: 'user', content: userText }],
    }),
  };
}

/** Claude's JSON answer from an HTTP response, or throws an Error with a .code. */
function claudeResult_(status, text) {
  if (status === 401) throw codedError_('bad_api_key', 'Claude rejected the API key');
  if (status === 429) throw codedError_('rate_limited', 'Claude rate limit');
  if (status !== 200) {
    const msg = (parseData_(text) || {}).error;
    throw codedError_('api_error', 'Claude API ' + status + (msg && msg.message ? ': ' + msg.message : ''));
  }
  const body = JSON.parse(text);
  if (body.stop_reason === 'refusal') throw codedError_('refusal', 'Claude declined');
  if (body.stop_reason !== 'end_turn') throw codedError_('bad_response', 'Claude stopped: ' + body.stop_reason);
  // With a server-side fallback, the answer is the text after the last fallback block.
  const content = body.content || [];
  const after = content.slice(content.map((b) => b.type).lastIndexOf('fallback') + 1);
  return JSON.parse(after.filter((b) => b.type === 'text').map((b) => b.text).join(''));
}

function codedError_(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

// ---- Suggest use cases (Add template tab) ----

// A function, not a constant: Apps Script may load this file before Rules.gs.
function suggestSchema_() {
  return {
    type: 'object',
    properties: {
      useCases: { type: 'array', items: { type: 'string', enum: Object.keys(USE_CASE_INFO) } },
      format: { type: 'string', enum: ['Reel', 'Carousel', 'Both'] },
      tone: { type: 'string', enum: ['Roast', 'Celebration', 'Disbelief', 'Relatable', 'Hype'] },
      reason: { type: 'string' },
    },
    required: ['useCases', 'format', 'tone', 'reason'],
    additionalProperties: false,
  };
}

function suggestUseCases_(name, how) {
  const key = claudeKey_();
  if (!key) return { error: 'not_configured' };
  if (!name.trim()) return { error: 'missing_name' };
  const system = 'You tag meme templates for @sportsmemery, a sports meme Instagram account. Given a template, ' +
    'pick the use cases it genuinely fits (2 to 5), its best format, and its tone.\n\nUse case ids and meanings:\n' + useCaseList_();
  const req = claudeRequest_(key, system, 'Template: ' + name.slice(0, 200) + '\nHow it works: ' + how.slice(0, 2000), suggestSchema_(), 1024);
  try {
    const url = req.url;
    delete req.url;
    const resp = UrlFetchApp.fetch(url, req);
    const out = claudeResult_(resp.getResponseCode(), resp.getContentText());
    out.useCases = out.useCases.filter((u, i, all) => u in USE_CASE_INFO && all.indexOf(u) === i);
    return out;
  } catch (e) {
    console.warn('suggest failed: ' + e.message);
    return { error: e.code || 'bad_response' };
  }
}

/** Run from the editor to check the API key: prints a suggestion to the log. */
function testClaude() {
  const key = claudeKey_();
  if (!key) {
    Logger.log('No ANTHROPIC_API_KEY in Script Properties.');
    return;
  }
  Logger.log('Key check: starts with "' + key.slice(0, 13) + '…", ' + key.length + ' characters.');
  if (!key.startsWith('sk-ant-')) Logger.log('That is not a secret key. It should start with sk-ant-. Copy the key from the popup shown when you create it, not the Copy button in the key list.');
  else if (key.length < 80) Logger.log('That looks too short for a full key (about 100 characters). It may be the shortened version from the key list.');
  Logger.log(JSON.stringify(suggestUseCases_('This Is Fine', 'A dog sits calmly in a burning room.'), null, 2));
}
