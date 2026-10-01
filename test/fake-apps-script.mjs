// Fake Google services for running apps-script/*.gs in Node (used by the tests).
import assert from "node:assert/strict";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

const DIR = new URL("../apps-script/", import.meta.url).pathname;

function fakeSheet() {
  const grid = [];
  let maxRows = 1000;
  const cell = (r, c) => (grid[r] && grid[r][c] !== undefined ? grid[r][c] : "");
  return {
    grid,
    getLastRow: () => {
      let n = grid.length;
      while (n > 0 && grid[n - 1].every((v) => v === "")) n--;
      return n;
    },
    getMaxRows: () => maxRows,
    insertRowsAfter: (_after, n) => { maxRows += n; },
    deleteRow: (r) => { grid.splice(r - 1, 1); },
    setFrozenRows() {},
    getRange(row, col, numRows = 1, numCols = 1) {
      if (typeof row === "string") return { setNumberFormat() { return this; } };
      if (row + numRows - 1 > maxRows) throw new Error("The coordinates of the range are outside the dimensions of the sheet.");
      return {
        getValues: () => Array.from({ length: numRows }, (_, i) => Array.from({ length: numCols }, (_, j) => cell(row - 1 + i, col - 1 + j))),
        setValues(values) {
          values.forEach((vals, i) => {
            while (grid.length < row + i) grid.push(["", "", "", ""]);
            vals.forEach((v, j) => { grid[row - 1 + i][col - 1 + j] = v; });
          });
          return this;
        },
        setNumberFormat() { return this; },
      };
    },
  };
}

function fakeSpreadsheet(id) {
  const sheets = new Map([["Sheet1", fakeSheet()]]);
  return {
    sheets,
    getId: () => id,
    getUrl: () => `https://docs.google.com/spreadsheets/d/${id}`,
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = fakeSheet(); sheets.set(n, s); return s; },
    getSheets: () => [...sheets.values()],
    deleteSheet: (s) => { for (const [k, v] of sheets) if (v === s) sheets.delete(k); },
  };
}

export const response = (status, body) => ({
  getResponseCode: () => status,
  getContentText: () => (typeof body === "string" ? body : JSON.stringify(body)),
});

/** Loads every .gs file (alphabetically, to catch load-order dependencies) into a fresh context. */
export function loadProject({ http = () => response(404, ""), user = "me@example.com" } = {}) {
  const props = new Map();
  const spreadsheets = new Map();
  const triggers = [];
  const logs = [];
  const requests = [];
  const handle = (req) => { requests.push(req); return http(req); };
  const session = { user };
  const drive = { folders: [] };
  let uidCount = 0;
  const ctx = {
    Session: {
      getActiveUser: () => ({ getEmail: () => session.user }),
      getEffectiveUser: () => ({ getEmail: () => "me@example.com" }),
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
    console: { log() {}, warn() {}, error() {} },
    Logger: { log: (m) => logs.push(m) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => randomUUID(),
      formatDate: (d, tz, fmt) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
          .formatToParts(d).map((x) => [x.type, x.value]));
        const known = { "yyyy-MM-dd": `${p.year}-${p.month}-${p.day}`, "HH:mm": `${p.hour}:${p.minute}`, "yyyyMMdd-HHmmss": `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}` };
        assert.ok(fmt in known, "unsupported date format " + fmt);
        return known[fmt];
      },
    },
    SpreadsheetApp: {
      create: () => { const id = "ss" + (spreadsheets.size + 1); const ss = fakeSpreadsheet(id); spreadsheets.set(id, ss); return ss; },
      openById: (id) => { if (!spreadsheets.has(id)) throw new Error("not found"); return spreadsheets.get(id); },
      getActiveSpreadsheet: () => null,
    },
    MimeType: { CSV: "text/csv" },
    DriveApp: {
      createFolder: (name) => { const folder = { name, id: "folder" + (drive.folders.length + 1), files: [], getId() { return this.id; },
        createFile(fname, content, mime) { const f = { name: fname, content, mime, getUrl: () => "https://drive.google.com/file/" + fname }; this.files.push(f); return f; } };
        drive.folders.push(folder); return folder; },
      getFolderById: (id) => { const f = drive.folders.find((x) => x.id === id); if (!f) throw new Error("no folder"); return f; },
    },
    UrlFetchApp: {
      fetchAll: (reqs) => reqs.map(handle),
      fetch: (url, opts) => handle({ url, ...opts }),
    },
    ScriptApp: {
      WeekDay: { SATURDAY: "SATURDAY", SUNDAY: "SUNDAY" },
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger(fn) {
        const spec = { fn };
        const b = {
          timeBased: () => b,
          everyDays: (n) => { spec.everyDays = n; return b; },
          onWeekDay: (d) => { spec.weekDay = d; return b; },
          atHour: (h) => { spec.hour = h; return b; },
          inTimezone: (tz) => { spec.tz = tz; return b; },
          create: () => { const uid = "uid" + (++uidCount); const t = { spec, getHandlerFunction: () => fn, getUniqueId: () => uid }; triggers.push(t); return t; },
        };
        return b;
      },
    },
  };
  vm.createContext(ctx);
  for (const f of readdirSync(DIR).filter((f) => f.endsWith(".gs")).sort()) {
    vm.runInContext(readFileSync(DIR + f, "utf8"), ctx, { filename: f });
  }
  return { ctx, props, spreadsheets, triggers, logs, requests, session, drive, run: (code) => vm.runInContext(code, ctx) };
}
