// Builds data/seed.sql from the JSON export of the Meme Lab artifact (data/export/<collection>/<id>.json).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../data/", import.meta.url).pathname;
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const stamp = new Date().toISOString();
const lines = [];
for (const col of readdirSync(join(root, "export"))) {
  for (const file of readdirSync(join(root, "export", col)).filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(join(root, "export", col, file), "utf8"));
    lines.push(`INSERT OR REPLACE INTO docs (collection, id, data, updated_at) VALUES (${q(col)}, ${q(file.slice(0, -5))}, ${q(JSON.stringify(data))}, ${q(stamp)});`);
  }
}
writeFileSync(join(root, "seed.sql"), lines.join("\n") + "\n");
console.log(`Wrote ${lines.length} rows to data/seed.sql`);
