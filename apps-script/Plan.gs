/**
 * Plan ahead: upcoming games worth prepping a meme for. The page fetches ESPN's upcoming
 * scoreboards on your device and sends them here; games with an angle (cat fight, Gator Watch,
 * ranked showdown, upset watch, rivalry) become plans, and Claude writes "if this happens, post
 * this" ideas for the new ones, using your template library and voice.
 */

const PLAN_ANGLES = {
  gator_watch: 'Gator Watch: a team about to face the Gators (if Florida wins, the loser is Chubbs)',
  cat_fight: 'Cat fight: two cat teams play each other',
  ranked_showdown: 'Ranked showdown: two ranked teams',
  rivalry: 'Rivalry or trophy game',
  upset_watch: 'Upset watch: a top-10 team against an unranked one',
};
const PLAN_PRIORITY = { gator_watch: 5, cat_fight: 4, ranked_showdown: 3, rivalry: 3, upset_watch: 1 };
const PLAN_GAME_MINUTES = { NFL: 210, CFB: 215, MLB: 180, NBA: 150, WNBA: 135, NHL: 150, CBB: 135 };
const PLAN_MAX_ENRICH = 12;

/** One upcoming ESPN event → a plan candidate, or null if it has no angle. */
function evaluateUpcoming_(ev, league) {
  const comp = ev && ev.competitions && ev.competitions[0];
  if (!comp || (((comp.status || {}).type || {}).state || 'pre') !== 'pre') return null;
  const college = COLLEGE_LEAGUES.indexOf(league) >= 0;
  const teams = (comp.competitors || []).map((c) => {
    const t = c.team || {};
    const rank = c.curatedRank && c.curatedRank.current;
    return { name: college ? t.location || t.displayName : t.name || t.displayName, full: t.displayName || '', home: c.homeAway === 'home', rank: rank && rank < 99 ? rank : null };
  });
  if (teams.length !== 2 || !teams[0].name || !teams[1].name) return null;
  const home = teams.find((t) => t.home) || teams[1];
  const away = home === teams[0] ? teams[1] : teams[0];
  const angles = [];
  if (isGators_(away.full) || isGators_(home.full)) angles.push('gator_watch');
  if (isCat_(away.name, away.full) && isCat_(home.name, home.full)) angles.push('cat_fight');
  if (away.rank && home.rank) angles.push('ranked_showdown');
  else if ((away.rank && away.rank <= 10 && !home.rank) || (home.rank && home.rank <= 10 && !away.rank)) angles.push('upset_watch');
  const notes = (comp.notes || []).map((n) => n && n.headline).filter(Boolean).join(' · ');
  if (/rivalry|trophy|cup\b|classic|battle for/i.test(notes)) angles.push('rivalry');
  if (!angles.length) return null;
  const start = new Date(comp.date || ev.date);
  if (isNaN(start.getTime())) return null;
  const gameDate = Utilities.formatDate(start, POST_TZ, 'yyyy-MM-dd');
  return {
    id: 'plan-' + gameDate + '-' + league.toLowerCase() + '-' + slug_(away.name) + '-' + slug_(home.name),
    league: league, gameDate: gameDate, start: start.toISOString(),
    away: away.name, home: home.name, awayFull: away.full, homeFull: home.full, awayRank: away.rank, homeRank: home.rank,
    angles: angles, notes: notes,
  };
}

function planSchema_() {
  return {
    type: 'object',
    properties: {
      plans: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            headline: { type: 'string' },
            scenarios: {
              type: 'array',
              items: {
                type: 'object',
                properties: { outcome: { type: 'string' }, idea: { type: 'string' }, template: { type: 'string' } },
                required: ['outcome', 'idea', 'template'],
                additionalProperties: false,
              },
            },
          },
          required: ['id', 'headline', 'scenarios'],
          additionalProperties: false,
        },
      },
    },
    required: ['plans'],
    additionalProperties: false,
  };
}

/** The active template library, for Claude to pick from. */
function libraryPrompt_() {
  const lines = listDocs_('templates')
    .filter((t) => t.data.status !== 'retired' && t.data.name)
    .slice(0, 60)
    .map((t) => '- ' + t.data.name + ' [' + (t.data.freshness === 'fresh' ? 'Fresh' : 'Classic') + '; fits: ' + (t.data.useCases || []).join(', ') + ']' +
      (t.data.how ? ': ' + String(t.data.how).slice(0, 160) : ''));
  return lines.length ? '\n\nTemplate library (pick from these):\n' + lines.join('\n') : '';
}

function planSystem_() {
  return 'You plan memes ahead of games for @sportsmemery, a sports meme Instagram account. For each upcoming game, write:\n' +
    '- headline: a short hook naming the matchup and the angle (for example "Lions vs Panthers: cat fight")\n' +
    '- scenarios: two or three "if this happens" outcomes (each team winning, or a blowout or upset when it fits). For each: ' +
    'outcome ("If the Lions win"), idea (the meme as setup → punchline), template (a template name from the library, or a well-known meme if none fits).\n\n' +
    'Rules:\n- Prefer Fresh templates. Use a Classic only when it is clearly the best fit.\n' +
    '- Gator Watch: the Chubbs gator-head meme only works when Florida beats a team (that team is Chubbs, spooked by the Gators). Never use it for a Florida loss, and no jokes about the window fall.\n' +
    '- Cat fight: play up two cat teams fighting.\n' +
    '- Punch at moments, not people. Don\'t invent injuries or facts.\n\n' +
    'Angles:\n' + Object.keys(PLAN_ANGLES).map((k) => k + ': ' + PLAN_ANGLES[k]).join('\n') +
    libraryPrompt_() + voicePrompt_();
}

/** Upcoming scoreboards from the page → saved plans. feeds: [{ league, events } or { league, error }]. */
function plan_(feeds) {
  const errors = [];
  const found = [];
  (Array.isArray(feeds) ? feeds : []).forEach((f) => {
    if (!f || !Object.prototype.hasOwnProperty.call(SCAN_FEEDS, f.league)) return;
    if (!Array.isArray(f.events)) { errors.push(f.league + ' schedule ' + String(f.error || 'missing').slice(0, 200)); return; }
    f.events.forEach((ev) => { const c = evaluateUpcoming_(ev, f.league); if (c) found.push(c); });
  });
  const existing = new Set(listIds_('plans'));
  const fresh = found.filter((c, i) => !existing.has(c.id) && found.findIndex((x) => x.id === c.id) === i);
  const score = (c) => Math.max.apply(null, c.angles.map((a) => PLAN_PRIORITY[a] || 0)) * 10 + (LEAGUE_WEIGHT[c.league] || 0);
  fresh.sort((a, b) => score(b) - score(a) || a.start.localeCompare(b.start));

  const extra = {};
  const key = claudeKey_();
  if (key && fresh.length) {
    const system = planSystem_();
    const chunks = [];
    const todo = fresh.slice(0, PLAN_MAX_ENRICH);
    for (let i = 0; i < todo.length; i += SCAN_CHUNK) chunks.push(todo.slice(i, i + SCAN_CHUNK));
    const requests = chunks.map((chunk) => claudeRequest_(key, system, JSON.stringify(chunk.map((c) => ({
      id: c.id, league: c.league, game: (c.awayRank ? '#' + c.awayRank + ' ' : '') + c.awayFull + ' at ' + (c.homeRank ? '#' + c.homeRank + ' ' : '') + c.homeFull,
      when: c.start, angles: c.angles, notes: c.notes,
    }))), planSchema_(), 6000));
    fetchAllSafe_(requests).forEach((r) => {
      try {
        if (r.error) throw new Error(r.error);
        claudeResult_(r.status, r.text).plans.forEach((p) => { extra[p.id] = p; });
      } catch (e) {
        errors.push('Claude: ' + e.message);
      }
    });
  }

  const createdAt = new Date().toISOString();
  const docs = fresh.map((c) => {
    const e = extra[c.id] || {};
    const end = new Date(new Date(c.start).getTime() + (PLAN_GAME_MINUTES[c.league] || 180) * 60000);
    const slot = nextWindow_(end, 0); // prepped ahead, so it can go up at the first window after the game
    return {
      id: c.id,
      data: {
        source: 'plan', status: 'upcoming', createdAt: createdAt,
        league: c.league, gameDate: c.gameDate, start: c.start,
        away: c.away, home: c.home, awayFull: c.awayFull, homeFull: c.homeFull, awayRank: c.awayRank, homeRank: c.homeRank,
        angles: c.angles, notes: c.notes,
        headline: e.headline || c.awayFull + ' at ' + c.homeFull,
        scenarios: Array.isArray(e.scenarios) ? e.scenarios.slice(0, 3) : [],
        postDate: slot.date, postTime: slot.time, postWindow: slot.window,
      },
    };
  });
  const added = docs.length ? withLock_(() => writeDocs_(sheetFor_('plans'), 'plans', docs, { skipExisting: true })) : 0;
  return { found: found.length, added: added, enriched: Object.keys(extra).length, errors: errors };
}
