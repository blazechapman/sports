// REST API for Meme Lab, backed by Cloudflare D1 (binding: DB).
// Documents are stored as JSON in a single `docs` table keyed by (collection, id).
const COLLECTIONS = new Set(["templates", "moments", "meta"]);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const err = (msg, status) => new Response(msg, { status });
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
const now = () => new Date().toISOString();

export async function onRequest({ request, env, params }) {
  const [col, id, extra] = params.path || [];
  if (!col || extra || !COLLECTIONS.has(col)) return err("Not found", 404);
  const db = env.DB;
  const method = request.method;

  if (!id) {
    if (method === "GET") {
      const url = new URL(request.url);
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "1000", 10) || 1000, 1000);
      const field = url.searchParams.get("orderBy");
      const dir = url.searchParams.get("dir") === "desc" ? "DESC" : "ASC";
      let sql = "SELECT id, data FROM docs WHERE collection = ?";
      const binds = [col];
      if (field) {
        if (!/^[A-Za-z0-9_]+$/.test(field)) return err("Bad orderBy", 400);
        sql += ` ORDER BY json_extract(data, '$.${field}') ${dir}`;
      }
      sql += " LIMIT ?";
      binds.push(limit);
      const { results } = await db.prepare(sql).bind(...binds).all();
      return json(results.map((r) => ({ id: r.id, data: JSON.parse(r.data) })));
    }
    if (method === "POST") {
      const data = await request.json();
      const docId = newId();
      await db.prepare("INSERT INTO docs (collection, id, data, updated_at) VALUES (?, ?, ?, ?)")
        .bind(col, docId, JSON.stringify(data), now()).run();
      return json({ id: docId }, 201);
    }
    return err("Method not allowed", 405);
  }

  const row = await db.prepare("SELECT data FROM docs WHERE collection = ? AND id = ?").bind(col, id).first();
  switch (method) {
    case "GET":
      return row ? json({ id, data: JSON.parse(row.data) }) : err("Not found", 404);
    case "PUT": {
      const data = await request.json();
      await db.prepare(
        "INSERT INTO docs (collection, id, data, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
      ).bind(col, id, JSON.stringify(data), now()).run();
      return json({ id });
    }
    case "PATCH": {
      if (!row) return err("Not found", 404);
      const merged = { ...JSON.parse(row.data), ...(await request.json()) };
      await db.prepare("UPDATE docs SET data = ?, updated_at = ? WHERE collection = ? AND id = ?")
        .bind(JSON.stringify(merged), now(), col, id).run();
      return json({ id });
    }
    case "DELETE":
      await db.prepare("DELETE FROM docs WHERE collection = ? AND id = ?").bind(col, id).run();
      return new Response(null, { status: 204 });
    default:
      return err("Method not allowed", 405);
  }
}
