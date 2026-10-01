// The Meme Lab app's Worker. It serves the app's files (app/dist/, via the ASSETS binding) and
// relays ESPN scoreboards for the Apps Script scan, because ESPN refuses requests from Google's
// servers. Only the five scoreboards the scan uses can be fetched, nothing else.
//   GET /espn/<sport>/<league>/scoreboard?dates=YYYYMMDD&limit=300[&groups=80]
const FEEDS = new Set(["football/nfl", "football/college-football", "baseball/mlb", "basketball/nba", "hockey/nhl"]);
const PARAMS = new Set(["dates", "limit", "groups"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/espn/")) return env.ASSETS.fetch(request);
    const m = /^\/espn\/([a-z]+\/[a-z-]+)\/scoreboard$/.exec(url.pathname);
    if (!m || request.method !== "GET" || !FEEDS.has(m[1]) || [...url.searchParams.keys()].some((k) => !PARAMS.has(k))) {
      return new Response("Not found", { status: 404 });
    }
    const upstream = `https://site.api.espn.com/apis/site/v2/sports/${m[1]}/scoreboard?${url.searchParams}`;
    const res = await fetch(upstream, {
      // ESPN's servers turn away requests that don't look like a browser.
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        referer: "https://www.espn.com/",
      },
      cf: { cacheTtl: 300, cacheEverything: true }, // the same scoreboard is reused for 5 minutes
    });
    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "application/json", "cache-control": "no-store", "x-robots-tag": "noindex", "x-memelab-relay": "espn " + res.status },
    });
  },
};
