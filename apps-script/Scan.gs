/**
 * Moment scan: pulls finished games from ESPN's public scoreboards (free), flags meme-worthy
 * ones with the Meme Lab rules (free), then asks Claude to write headlines, concepts and
 * captions and apply the off-limits filter for the new ones. Runs on the triggers setup()
 * installs and from the "Check for new moments" button.
 */

const SCAN_FEEDS = {
  NFL: 'football/nfl',
  CFB: 'football/college-football',
  MLB: 'baseball/mlb',
  NBA: 'basketball/nba',
  NHL: 'hockey/nhl',
};
const SCAN_REGULATION = { NFL: 4, CFB: 4, NBA: 4, NHL: 3, MLB: 9 };
const SCAN_TZ = 'America/New_York';
const SCAN_MAX_ENRICH = 12; // most games sent to Claude per scan
const SCAN_CHUNK = 4; // games per Claude request; requests run in parallel

/** Trigger handler (installed by setup). */
function scheduledScan() {
  console.log('scan ' + JSON.stringify(runScan_()));
}

/** Run from the editor to scan now and see the result in the log. Ignores the button's cooldown. */
function runScanNow() {
  Logger.log(JSON.stringify(runScan_(), null, 2));
}

function scoreboardUrl_(league, ymd) {
  let q = 'dates=' + ymd.replace(/-/g, '') + '&limit=300';
  if (league === 'CFB') q += '&groups=80'; // FBS only
  return 'https://site.api.espn.com/apis/site/v2/sports/' + SCAN_FEEDS[league] + '/scoreboard?' + q;
}

/**
 * Like UrlFetchApp.fetchAll, but returns { status, text, error } instead of throwing. If the batch
 * fails (a network error or timeout on any request), it retries one by one when `retry` is set;
 * leave it off for paid calls so a request that already succeeded isn't sent twice.
 */
function fetchAllSafe_(requests, retry) {
  if (!requests.length) return [];
  try {
    return UrlFetchApp.fetchAll(requests).map((r) => ({ status: r.getResponseCode(), text: r.getContentText() }));
  } catch (e) {
    if (!retry) return requests.map(() => ({ status: 0, text: '', error: e.message }));
    return requests.map((req) => {
      try {
        const opts = Object.assign({}, req);
        delete opts.url;
        const r = UrlFetchApp.fetch(req.url, opts);
        return { status: r.getResponseCode(), text: r.getContentText() };
      } catch (err) {
        return { status: 0, text: '', error: err.message };
      }
    });
  }
}

function slug_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** One ESPN event → a candidate moment, or null if nothing is flagged. */
function evaluateGame_(ev, league, gameDate) {
  const comp = ev.competitions && ev.competitions[0];
  if (!comp || !comp.status || !comp.status.type || !comp.status.type.completed) return null;
  const teams = (comp.competitors || []).map((c) => {
    const t = c.team || {};
    const rank = c.curatedRank && c.curatedRank.current;
    return {
      name: league === 'CFB' ? t.location || t.displayName : t.name || t.displayName,
      full: t.displayName || '',
      score: Number(c.score),
      rank: rank && rank < 99 ? rank : null,
    };
  });
  if (teams.length !== 2 || teams.some((t) => !isFinite(t.score)) || teams[0].score === teams[1].score) return null;
  const w = teams[0].score > teams[1].score ? teams[0] : teams[1];
  const l = w === teams[0] ? teams[1] : teams[0];
  const useCases = [];
  if (w.score - l.score >= BLOWOUT_MARGIN[league]) useCases.push('blowout');
  if (l.rank && (!w.rank || w.rank - l.rank >= 5)) useCases.push('upset');
  if ((comp.status.period || 0) > SCAN_REGULATION[league]) useCases.push('clutch');
  if (useCases.includes('blowout') && isCat_(w.name, w.full)) useCases.push('cat_watch');
  if (!useCases.length) return null;
  const h = (comp.headlines || [])[0] || {};
  const link = (ev.links || []).find((x) => (x.rel || []).includes('recap') || (x.rel || []).includes('summary'));
  return {
    id: gameDate + '-' + league.toLowerCase() + '-' + slug_(w.name) + '-' + slug_(l.name),
    league: league,
    gameDate: gameDate,
    winner: w.name,
    loser: l.name,
    winnerScore: w.score,
    loserScore: l.score,
    winnerRank: w.rank,
    loserRank: l.rank,
    detail: comp.status.type.detail || 'Final',
    recap: [h.shortLinkText, h.description].filter(Boolean).join(' — '),
    useCases: useCases,
    sources: link && link.href ? [link.href] : [],
  };
}

// A function, not a constant: Apps Script may load this file before Rules.gs.
function enrichSchema_() {
  return {
    type: 'object',
    properties: {
      moments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            offLimits: { type: 'boolean' },
            extraUseCases: { type: 'array', items: { type: 'string', enum: Object.keys(USE_CASE_INFO) } },
            headline: { type: 'string' },
            description: { type: 'string' },
            concept: { type: 'string' },
            captionStarter: { type: 'string' },
          },
          required: ['id', 'offLimits', 'extraUseCases', 'headline', 'description', 'concept', 'captionStarter'],
          additionalProperties: false,
        },
      },
    },
    required: ['moments'],
    additionalProperties: false,
  };
}

function enrichSystem_() {
  return 'You write meme ideas for @sportsmemery, a sports meme Instagram account. Brand rule: punch at moments, not people. ' +
    'Set offLimits true when the facts given involve a serious injury, death, or a legal or personal matter.\n\n' +
    'For each game, using only the facts given (do not invent plays or quotes):\n' +
    '- headline: one punchy line, under 90 characters\n' +
    '- description: one factual sentence\n' +
    '- concept: a meme concept as setup → punchline, naming a well-known template if one fits\n' +
    '- captionStarter: an Instagram caption opener that states the result\n' +
    '- extraUseCases: any other use cases the facts clearly support, else []\n\n' +
    'Use case ids:\n' + useCaseList_();
}

/** Claude's write-ups keyed by moment id. Failed chunks are reported in errors. */
function enrich_(key, candidates, errors) {
  const system = enrichSystem_();
  const chunks = [];
  for (let i = 0; i < candidates.length; i += SCAN_CHUNK) chunks.push(candidates.slice(i, i + SCAN_CHUNK));
  const requests = chunks.map((chunk) => {
    const facts = chunk.map((c) => ({
      id: c.id,
      league: c.league,
      result: (c.winnerRank ? '#' + c.winnerRank + ' ' : '') + c.winner + ' ' + c.winnerScore + ', ' +
        (c.loserRank ? '#' + c.loserRank + ' ' : '') + c.loser + ' ' + c.loserScore + ' (' + c.detail + ')',
      flagged: c.useCases,
      recap: c.recap || '',
    }));
    return claudeRequest_(key, system, JSON.stringify(facts), enrichSchema_(), 6000);
  });
  const out = {};
  fetchAllSafe_(requests).forEach((r) => {
    try {
      if (r.error) throw new Error(r.error);
      claudeResult_(r.status, r.text).moments.forEach((m) => { out[m.id] = m; });
    } catch (e) {
      errors.push('Claude: ' + e.message);
    }
  });
  return out;
}

/** Runs a scan and saves new moments. Returns a summary. */
function runScan_(opts) {
  const now = (opts && opts.now) || new Date();
  const today = Utilities.formatDate(now, SCAN_TZ, 'yyyy-MM-dd');
  const yesterday = Utilities.formatDate(new Date(now.getTime() - 864e5), SCAN_TZ, 'yyyy-MM-dd');

  const jobs = [];
  Object.keys(SCAN_FEEDS).forEach((league) => [yesterday, today].forEach((day) => jobs.push({ league: league, day: day })));
  const feeds = fetchAllSafe_(jobs.map((j) => ({ url: scoreboardUrl_(j.league, j.day), muteHttpExceptions: true, headers: { accept: 'application/json' } })), true);

  const candidates = [];
  const errors = [];
  feeds.forEach((r, i) => {
    const j = jobs[i];
    if (r.status !== 200) {
      errors.push(j.league + ' feed ' + (r.error || r.status));
      return;
    }
    const body = parseData_(r.text);
    if (!body) {
      errors.push(j.league + ' feed unreadable');
      return;
    }
    (body.events || []).forEach((ev) => {
      const c = evaluateGame_(ev, j.league, j.day);
      if (c) candidates.push(c);
    });
  });

  // Skip games already saved, including ones you dismissed.
  const existing = new Set(listIds_('moments'));
  const fresh = candidates.filter((c, i) => !existing.has(c.id) && candidates.findIndex((x) => x.id === c.id) === i);
  const rank = { High: 2, Medium: 1, Low: 0 };
  fresh.sort((a, b) => rank[potential_(b.useCases, b.league)] - rank[potential_(a.useCases, a.league)]);

  const key = claudeKey_();
  const extra = key && fresh.length ? enrich_(key, fresh.slice(0, SCAN_MAX_ENRICH), errors) : {};

  const createdAt = now.toISOString();
  const docs = fresh.map((c) => {
    const e = extra[c.id] || {};
    const off = !!e.offLimits;
    const useCases = c.useCases.concat((e.extraUseCases || []).filter((u) => u in USE_CASE_INFO))
      .filter((u, i, all) => all.indexOf(u) === i);
    return {
      id: c.id,
      data: {
        source: 'auto',
        status: 'new',
        createdAt: createdAt,
        league: c.league,
        gameDate: c.gameDate,
        winner: c.winner,
        loser: c.loser,
        winnerScore: c.winnerScore,
        loserScore: c.loserScore,
        headline: e.headline || c.winner + ' ' + c.winnerScore + ', ' + c.loser + ' ' + c.loserScore,
        description: e.description || c.recap || c.winner + ' beat ' + c.loser + ' ' + c.winnerScore + '-' + c.loserScore + ' (' + c.detail + ').',
        concept: e.concept || '',
        captionStarter: e.captionStarter || c.winner + ' ' + c.winnerScore + '-' + c.loserScore + ' over ' + c.loser + '.',
        useCases: off ? [] : useCases,
        offLimits: off,
        potential: off ? 'Low' : potential_(useCases, c.league),
        urgency: off ? '' : 'Post today',
        postDate: off ? '' : today,
        postTime: off ? '' : '7:00 PM',
        sources: c.sources,
      },
    };
  });
  const added = docs.length ? withLock_(() => writeDocs_(sheetFor_('moments'), 'moments', docs, { skipExisting: true })) : 0;
  return { checked: candidates.length, added: added, enriched: Object.keys(extra).length, errors: errors };
}
