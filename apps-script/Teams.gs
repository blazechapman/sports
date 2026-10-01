/**
 * Team numbers for After Effects: one tab per league ("Teams NFL", "Teams CFB", …) numbered
 * alphabetically (pro teams by nickname, college teams by school). A team keeps its number
 * forever so After Effects comps never shift; teams that appear later are added at the end.
 * The page fetches ESPN's team lists on your device (ESPN blocks Google) and sends them here.
 */

const TEAM_HEADER = ['#', 'Team', 'Full name', 'Abbr', 'ESPN id'];

function teamTab_(league) {
  return plainTab_('Teams ' + league, TEAM_HEADER, false);
}

/** lists: [{ league, teams: [{ id, name, location, displayName, abbr }] }]. Returns per-league counts. */
function saveTeams_(lists) {
  const out = {};
  (Array.isArray(lists) ? lists : []).forEach((list) => {
    if (!list || !Object.prototype.hasOwnProperty.call(SCAN_FEEDS, list.league) || !Array.isArray(list.teams)) return;
    const college = COLLEGE_LEAGUES.indexOf(list.league) >= 0;
    const teams = list.teams
      .filter((t) => t && t.id && (college ? t.location : t.name))
      .map((t) => ({ id: String(t.id), key: String(college ? t.location : t.name), full: String(t.displayName || ''), abbr: String(t.abbr || '') }))
      .sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true, sensitivity: 'base' }) || a.full.localeCompare(b.full));
    out[list.league] = withLock_(() => {
      const sh = teamTab_(list.league);
      const rows = tabRows_(sh, TEAM_HEADER.length);
      const known = new Set(rows.map((r) => String(r[4])));
      let next = rows.reduce((m, r) => Math.max(m, Number(r[0]) || 0), 0);
      const added = teams.filter((t) => !known.has(t.id)).map((t) => [++next, t.key, t.full, t.abbr, t.id]);
      appendRows_(sh, added, false);
      return { total: rows.length + added.length, added: added.length };
    });
  });
  return out;
}

/** The After Effects number for a team, as the app names it (nickname, or school for college); '' if unknown. */
function teamNumber_(league, name) {
  if (!name || !Object.prototype.hasOwnProperty.call(SCAN_FEEDS, league)) return '';
  const ss = memelabSpreadsheet_();
  const sh = ss.getSheetByName('Teams ' + league);
  if (!sh) return '';
  const want = String(name).trim().toLowerCase();
  const row = tabRows_(sh, TEAM_HEADER.length).find((r) => String(r[1]).trim().toLowerCase() === want || String(r[2]).trim().toLowerCase() === want);
  return row ? row[0] : '';
}
