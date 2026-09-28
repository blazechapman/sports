// Scheduled scan Worker. Shares the memelab D1 database with the Pages site.
import { runScan } from "../lib/scan.js";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScan(env).then((r) => console.log("scan", JSON.stringify(r))));
  },
};
