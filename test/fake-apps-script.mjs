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
export function loadProject({ http = () => response(404, "") } = {}) {
  const props = new Map();
  const spreadsheets = new Map();
  const triggers = [];
  const logs = [];
  const requests = [];
  const handle = (req) => { requests.push(req); return http(req); };
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Logger: { log: (m) => logs.push(m) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => randomUUID(),
      formatDate: (d, tz, fmt) => {
        assert.equal(fmt, "yyyy-MM-dd");
        return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
      },
    },
    SpreadsheetApp: {
      create: () => { const id = "ss" + (spreadsheets.size + 1); const ss = fakeSpreadsheet(id); spreadsheets.set(id, ss); return ss; },
      openById: (id) => { if (!spreadsheets.has(id)) throw new Error("not found"); return spreadsheets.get(id); },
      getActiveSpreadsheet: () => null,
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
          create: () => { const t = { spec, getHandlerFunction: () => fn }; triggers.push(t); return t; },
        };
        return b;
      },
    },
  };
  vm.createContext(ctx);
  for (const f of readdirSync(DIR).filter((f) => f.endsWith(".gs")).sort()) {
    vm.runInContext(readFileSync(DIR + f, "utf8"), ctx, { filename: f });
  }
  return { ctx, props, spreadsheets, triggers, logs, requests, run: (code) => vm.runInContext(code, ctx) };
}
