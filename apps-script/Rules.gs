/** Meme Lab rules shared by the scan and Claude prompts. Keep in sync with App.html (public/app.js). */

const USE_CASE_INFO = {
  blowout: 'Blowout - Won by a big margin',
  upset: 'Upset - Underdog or unranked team wins',
  collapse: 'Collapse - Blown lead, choke, late meltdown on the field',
  rivalry: 'Rivalry - Rival or trophy game result',
  clutch: 'Clutch finish - Walk-off, buzzer-beater, game-winner',
  bad_call: 'Bad call - Refs, replay, controversial call',
  coaching: 'Coaching - Head-scratching decision, hot seat, firing',
  meltdown: 'Fanbase meltdown - A fanbase losing it online',
  streak: 'Streak - Streak extended or snapped',
  rankings: 'Rankings - Polls, snubs, playoff picture',
  transaction: 'Transaction - Trade, signing, draft, portal',
  fantasy: 'Fantasy pain - Lineup regret, waiver misery',
  hype: 'Hype - Before a big game, bold predictions',
  milestone: 'Milestone - Record or career milestone',
  revenge: 'Revenge game - Facing a former team',
  cat_watch: 'Cat Watch - A cat team wins by a decent margin',
  cat_fight: 'Cat fight - Two cat teams play each other',
  gator_watch: 'Gator Watch - Florida beats a team, which gets spooked by the Gators (the Chubbs meme: the loser is Chubbs; never use it when Florida loses)',
};

const BLOWOUT_MARGIN = { NFL: 14, CFB: 14, NBA: 15, WNBA: 15, MLB: 5, NHL: 3, CBB: 15 };
const LEAGUE_WEIGHT = { NFL: 3, CFB: 3, MLB: 2, NBA: 2, WNBA: 1, NHL: 1, CBB: 2 };
const COLLEGE_LEAGUES = ['CFB', 'CBB']; // named by school ("Florida"), not nickname

const CAT_NAMES = ['tiger', 'lion', 'panther', 'jaguar', 'bengal', 'wildcat', 'cougar', 'bobcat', 'bearcat', 'lynx', 'puma', 'leopard', 'cheetah', 'catamount', 'sabercat',
  'jags', 'lsu', 'clemson', 'auburn', 'missouri', 'mizzou', 'memphis tigers', 'kentucky', 'arizona wildcats', 'kansas state', 'k-state', 'northwestern', 'penn state', 'pitt', 'houston cougars', 'byu', 'washington state', 'wsu', 'cincinnati bearcats', 'villanova', 'texas state', 'ohio bobcats', 'montana state', 'towson', 'grambling', 'jackson state', 'tennessee state', 'uab', 'northern iowa', 'prairie view'];

function useCaseList_() {
  return Object.keys(USE_CASE_INFO).map((id) => id + ': ' + USE_CASE_INFO[id]).join('\n');
}

function isCat_(...names) {
  return names.some((name) => {
    const n = ' ' + String(name || '').toLowerCase().replace(/[^a-z\- ]/g, ' ') + ' ';
    return n.trim() !== '' && CAT_NAMES.some((c) => new RegExp('\\b' + c.replace('-', '\\-') + 's?\\b').test(n));
  });
}

function potential_(useCases, league) {
  const p = useCases.length + LEAGUE_WEIGHT[league] + (useCases.includes('upset') || useCases.includes('rivalry') ? 1 : 0);
  return p >= 6 ? 'High' : p >= 4 ? 'Medium' : 'Low';
}

/** Florida Gators (football or basketball), for Gator Watch. */
function isGators_(fullName) {
  return /\bflorida gators\b/i.test(String(fullName || ''));
}

// ---- When to post ----
// Posting windows in Eastern time, as minutes after midnight. A moment gets the first window that
// leaves PREP_MINUTES to make the meme (prepped plans use no lead time).
const POST_WINDOWS = [
  { label: 'Morning', start: 8 * 60, end: 10 * 60 },
  { label: 'Late night', start: 22 * 60, end: 24 * 60 },
];
const PREP_MINUTES = 60;
const POST_TZ = 'America/New_York';

function minutesLabel_(m) {
  const h = Math.floor(m / 60) % 24;
  return (h % 12 || 12) + ':' + String(m % 60).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
}

/** The next posting slot after `from` (+ lead minutes): { date: 'YYYY-MM-DD', time: '10:30 PM', window: 'Late night' }. */
function nextWindow_(from, leadMinutes) {
  const ready = new Date(from.getTime() + (leadMinutes == null ? PREP_MINUTES : leadMinutes) * 60000);
  const hm = Utilities.formatDate(ready, POST_TZ, 'HH:mm').split(':');
  const readyMin = Math.ceil((Number(hm[0]) * 60 + Number(hm[1])) / 15) * 15;
  for (let k = 0; k < 4; k++) {
    const date = Utilities.formatDate(new Date(ready.getTime() + k * 864e5), POST_TZ, 'yyyy-MM-dd');
    for (const w of POST_WINDOWS) {
      const t = Math.max(w.start, k === 0 ? readyMin : 0);
      if (t < w.end) return { date: date, time: minutesLabel_(t), window: w.label };
    }
  }
  return { date: '', time: '', window: '' };
}
