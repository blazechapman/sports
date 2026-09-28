// Shared Meme Lab rules. Keep in sync with public/app.js (USE_CASES, MARGIN, CAT_NAMES).
export const USE_CASES = {
  blowout: "Blowout - Won by a big margin",
  upset: "Upset - Underdog or unranked team wins",
  collapse: "Collapse - Blown lead, choke, late meltdown on the field",
  rivalry: "Rivalry - Rival or trophy game result",
  clutch: "Clutch finish - Walk-off, buzzer-beater, game-winner",
  bad_call: "Bad call - Refs, replay, controversial call",
  coaching: "Coaching - Head-scratching decision, hot seat, firing",
  meltdown: "Fanbase meltdown - A fanbase losing it online",
  streak: "Streak - Streak extended or snapped",
  rankings: "Rankings - Polls, snubs, playoff picture",
  transaction: "Transaction - Trade, signing, draft, portal",
  fantasy: "Fantasy pain - Lineup regret, waiver misery",
  hype: "Hype - Before a big game, bold predictions",
  milestone: "Milestone - Record or career milestone",
  revenge: "Revenge game - Facing a former team",
  cat_watch: "Cat Watch - A cat team wins by a decent margin",
};

export const MARGIN = { NFL: 14, CFB: 14, NBA: 15, MLB: 5, NHL: 3 };
export const LEAGUE_WEIGHT = { NFL: 3, CFB: 3, MLB: 2, NBA: 2, NHL: 1 };

const CAT_NAMES = ["tiger","lion","panther","jaguar","bengal","wildcat","cougar","bobcat","bearcat","lynx","puma","leopard","cheetah","catamount","sabercat",
  "jags","lsu","clemson","auburn","missouri","mizzou","memphis tigers","kentucky","arizona wildcats","kansas state","k-state","northwestern","penn state","pitt","houston cougars","byu","washington state","wsu","cincinnati bearcats","villanova","texas state","ohio bobcats","montana state","towson","grambling","jackson state","tennessee state","uab","northern iowa","prairie view"];

export function isCat(...names) {
  return names.some((name) => {
    const n = " " + (name || "").toLowerCase().replace(/[^a-z\- ]/g, " ") + " ";
    return n.trim() !== "" && CAT_NAMES.some((c) => new RegExp("\\b" + c.replace("-", "\\-") + "s?\\b").test(n));
  });
}

export function potential(useCases, league) {
  const p = useCases.length + LEAGUE_WEIGHT[league] + (useCases.includes("upset") || useCases.includes("rivalry") ? 1 : 0);
  return p >= 6 ? "High" : p >= 4 ? "Medium" : "Low";
}
