/**
 * The meme voice library: a "Meme Voice" tab with house-style rules and example captions.
 * Every caption and on-image text Claude writes follows it. Edit the tab freely: add rows with
 * Kind "Rule" or "Example" (your best past captions); delete the placeholder example.
 */

const VOICE_TAB = 'Meme Voice';
const VOICE_PLACEHOLDER = 'Paste a caption you liked here, one per row (then delete this one).';

function voiceStarter_() {
  return [
    ['Rule', 'Punch at moments, not people. No jokes about injuries, deaths, legal or personal matters.'],
    ['Rule', 'Fanbases, refs, coaching decisions and bad losses are fair game. Players\' personal lives are not.'],
    ['Rule', 'On-image text is short: under 8 words per line, and it only lands with the picture.'],
    ['Rule', 'Captions state the result first (who won, the score), then the joke, in one or two sentences.'],
    ['Rule', 'Sound like a group chat, not a news anchor: plain words, a little smug, never mean-spirited.'],
    ['Rule', 'At most one emoji. No hashtags in on-image text. Keep it Instagram-safe (no swearing).'],
    ['Example', VOICE_PLACEHOLDER],
  ];
}

function voiceTab_() {
  const sh = plainTab_(VOICE_TAB, ['Kind', 'Text'], true);
  if (sh.getLastRow() === 1) withLock_(() => appendRows_(sh, voiceStarter_(), true));
  return sh;
}

/** The voice library as prompt text for Claude (empty if the tab is blank). */
function voicePrompt_() {
  let rows;
  try { rows = tabRows_(voiceTab_(), 2); } catch (e) { return ''; }
  const pick = (kind) => rows
    .filter((r) => String(r[0]).trim().toLowerCase() === kind && String(r[1]).trim() && String(r[1]).trim() !== VOICE_PLACEHOLDER)
    .map((r) => '- ' + String(r[1]).trim().slice(0, 300));
  const rules = pick('rule').slice(0, 30);
  const examples = pick('example').slice(0, 30);
  let out = '';
  if (rules.length) out += '\n\nHouse style for @sportsmemery (follow it):\n' + rules.join('\n');
  if (examples.length) out += '\n\nCaptions in our voice (match this tone):\n' + examples.join('\n');
  return out;
}
