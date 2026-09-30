import { chmodSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = path.join(homedir(), ".xauusd-copilot", "data");
const DATABASE_PATH = path.join(DATA_DIR, "trading-journal.sqlite");
mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
try { chmodSync(DATA_DIR, 0o700); } catch { /* Keep startup working on filesystems without POSIX permissions. */ }

const database = new DatabaseSync(DATABASE_PATH);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    plan_id TEXT,
    timestamp INTEGER NOT NULL,
    trade_date TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('long', 'short')),
    style TEXT NOT NULL,
    order_type TEXT,
    entry REAL,
    exit_price REAL,
    stop_loss REAL,
    take_profit REAL,
    quantity REAL,
    pnl_amount REAL,
    pnl_currency TEXT NOT NULL DEFAULT 'USD',
    pnl_percent REAL,
    thesis TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    plan_rationale TEXT NOT NULL DEFAULT '',
    plan_trigger TEXT NOT NULL DEFAULT '',
    plan_invalidation TEXT NOT NULL DEFAULT '',
    original_analysis TEXT NOT NULL DEFAULT '',
    review TEXT NOT NULL DEFAULT '',
    reviewed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS trades_by_date ON trades(trade_date, timestamp DESC);
  CREATE INDEX IF NOT EXISTS trades_by_plan ON trades(plan_id);

  CREATE TABLE IF NOT EXISTS day_notes (
    trade_date TEXT PRIMARY KEY,
    note TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS trade_memories (
    id TEXT PRIMARY KEY,
    trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE CASCADE,
    lesson TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
`);
const tradeColumns = new Set(database.prepare("PRAGMA table_info(trades)").all().map((column) => column.name));
for (const [name, definition] of [
  ["trade_status", "TEXT NOT NULL DEFAULT 'closed'"],
  ["last_check_price", "REAL"],
  ["last_check_result", "TEXT"],
  ["last_check_note", "TEXT NOT NULL DEFAULT ''"],
  ["last_checked_at", "INTEGER"],
]) {
  if (!tradeColumns.has(name)) database.exec(`ALTER TABLE trades ADD COLUMN ${name} ${definition}`);
}
const clearGeneratedNote = database.prepare("UPDATE trades SET notes = '' WHERE notes = ?");
for (const generatedNote of [
  "Tự động ghi từ Quick Analysis. Đây là kế hoạch theo dõi trên chart, chưa xác nhận người dùng đã vào lệnh thật.",
  "Đã chuyển từ nhật ký trình duyệt cũ.",
]) clearGeneratedNote.run(generatedNote);
try { chmodSync(DATABASE_PATH, 0o600); } catch { /* Preserve app startup if the filesystem does not support chmod. */ }

const TRADE_SELECT = "SELECT * FROM trades ORDER BY timestamp DESC LIMIT 5000";

function localDateKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function cleanText(value, maxLength, field) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > maxLength) throw new Error(`${field} tối đa ${maxLength} ký tự.`);
  return text;
}

function optionalNumber(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 1_000_000_000_000) throw new Error(`${field} không hợp lệ.`);
  return number;
}

function validDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normalizeTrade(input) {
  const now = Date.now();
  const timestamp = Number.isFinite(Number(input.timestamp)) ? Number(input.timestamp) : now;
  const tradeDate = validDateKey(input.date) ? input.date : localDateKey(timestamp);
  const symbol = cleanText(input.symbol || "OANDA:XAUUSD", 64, "Symbol").toUpperCase();
  if (!/^[-A-Z0-9._!/]+:[-A-Z0-9._!/]+$/.test(symbol)) throw new Error("Symbol dùng định dạng EXCHANGE:SYMBOL.");
  const side = String(input.side || "long").toLowerCase();
  if (!["long", "short"].includes(side)) throw new Error("Side phải là long hoặc short.");
  const style = String(input.style || "day_trade").toLowerCase().replace(/[\s-]+/g, "_");
  if (!["scalp", "day_trade", "swing"].includes(style)) throw new Error("Style phải là scalp, day_trade hoặc swing.");

  const pnlAmount = optionalNumber(input.pnlAmount, "PnL tiền");
  const pnlPercent = optionalNumber(input.pnlPercent, "PnL phần trăm");
  const status = String(input.status || "closed").toLowerCase();
  if (!["tracking", "open", "target_hit", "stop_hit", "closed", "cancelled"].includes(status)) throw new Error("Trạng thái lệnh không hợp lệ.");
  if (status === "closed" && pnlAmount === null && pnlPercent === null) throw new Error("Nhập PnL bằng tiền hoặc phần trăm trước khi lưu lệnh đã đóng.");
  const orderType = ["limit", "market"].includes(String(input.orderType || "").toLowerCase()) ? String(input.orderType).toLowerCase() : null;
  const currency = cleanText(input.pnlCurrency || "USD", 8, "Đơn vị PnL").toUpperCase();
  if (currency && !/^[A-Z0-9._-]+$/.test(currency)) throw new Error("Đơn vị PnL không hợp lệ.");

  return {
    id: cleanText(input.id || randomUUID(), 80, "ID lệnh"),
    planId: cleanText(input.planId, 80, "Plan ID") || null,
    timestamp,
    date: tradeDate,
    symbol,
    side,
    style,
    orderType,
    entry: optionalNumber(input.entry, "Entry"),
    exitPrice: optionalNumber(input.exitPrice, "Giá thoát"),
    stopLoss: optionalNumber(input.stopLoss, "Stop loss"),
    takeProfit: optionalNumber(input.takeProfit, "Take profit"),
    quantity: optionalNumber(input.quantity, "Khối lượng"),
    pnlAmount,
    pnlCurrency: currency || "USD",
    pnlPercent,
    status,
    lastCheckPrice: optionalNumber(input.lastCheckPrice, "Giá kiểm tra gần nhất"),
    lastCheckResult: cleanText(input.lastCheckResult, 24, "Kết quả kiểm tra") || null,
    lastCheckNote: cleanText(input.lastCheckNote, 1000, "Ghi chú kiểm tra"),
    lastCheckedAt: Number.isFinite(Number(input.lastCheckedAt)) ? Number(input.lastCheckedAt) : null,
    thesis: cleanText(input.thesis, 3000, "Ý tưởng giao dịch"),
    notes: cleanText(input.notes, 6000, "Ghi chú"),
    planRationale: cleanText(input.planRationale, 3000, "Lý do của plan"),
    planTrigger: cleanText(input.planTrigger, 2000, "Điều kiện vào lệnh"),
    planInvalidation: cleanText(input.planInvalidation, 2000, "Điều kiện vô hiệu"),
    originalAnalysis: cleanText(input.originalAnalysis, 12000, "Phân tích ban đầu"),
    createdAt: Number.isFinite(Number(input.createdAt)) ? Number(input.createdAt) : now,
    updatedAt: now,
  };
}

function toTrade(row) {
  if (!row) return null;
  return {
    id: row.id,
    planId: row.plan_id,
    timestamp: row.timestamp,
    date: row.trade_date,
    symbol: row.symbol,
    side: row.side,
    style: row.style,
    orderType: row.order_type,
    entry: row.entry,
    exitPrice: row.exit_price,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    quantity: row.quantity,
    pnlAmount: row.pnl_amount,
    pnlCurrency: row.pnl_currency,
    pnlPercent: row.pnl_percent,
    status: row.trade_status,
    lastCheckPrice: row.last_check_price,
    lastCheckResult: row.last_check_result,
    lastCheckNote: row.last_check_note,
    lastCheckedAt: row.last_checked_at,
    thesis: row.thesis,
    notes: row.notes,
    planRationale: row.plan_rationale,
    planTrigger: row.plan_trigger,
    planInvalidation: row.plan_invalidation,
    originalAnalysis: row.original_analysis,
    review: row.review,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function insertOrUpdateTrade(trade) {
  database.prepare(`
    INSERT INTO trades (
      id, plan_id, timestamp, trade_date, symbol, side, style, order_type,
      entry, exit_price, stop_loss, take_profit, quantity, pnl_amount, pnl_currency, pnl_percent,
      trade_status, last_check_price, last_check_result, last_check_note, last_checked_at,
      thesis, notes, plan_rationale, plan_trigger, plan_invalidation, original_analysis,
      created_at, updated_at
    ) VALUES (
      @id, @planId, @timestamp, @date, @symbol, @side, @style, @orderType,
      @entry, @exitPrice, @stopLoss, @takeProfit, @quantity, @pnlAmount, @pnlCurrency, @pnlPercent,
      @status, @lastCheckPrice, @lastCheckResult, @lastCheckNote, @lastCheckedAt,
      @thesis, @notes, @planRationale, @planTrigger, @planInvalidation, @originalAnalysis,
      @createdAt, @updatedAt
    ) ON CONFLICT(id) DO UPDATE SET
      plan_id=excluded.plan_id, timestamp=excluded.timestamp, trade_date=excluded.trade_date,
      symbol=excluded.symbol, side=excluded.side, style=excluded.style, order_type=excluded.order_type,
      entry=excluded.entry, exit_price=excluded.exit_price, stop_loss=excluded.stop_loss,
      take_profit=excluded.take_profit, quantity=excluded.quantity, pnl_amount=excluded.pnl_amount,
      pnl_currency=excluded.pnl_currency, pnl_percent=excluded.pnl_percent,
      trade_status=excluded.trade_status, last_check_price=excluded.last_check_price,
      last_check_result=excluded.last_check_result, last_check_note=excluded.last_check_note,
      last_checked_at=excluded.last_checked_at, thesis=excluded.thesis,
      notes=excluded.notes, plan_rationale=excluded.plan_rationale, plan_trigger=excluded.plan_trigger,
      plan_invalidation=excluded.plan_invalidation, original_analysis=excluded.original_analysis,
      updated_at=excluded.updated_at
  `).run(trade);
  return toTrade(database.prepare("SELECT * FROM trades WHERE id = ?").get(trade.id));
}

export function listJournal() {
  const trades = database.prepare(TRADE_SELECT).all().map(toTrade);
  const days = database.prepare("SELECT trade_date AS date, note, updated_at AS updatedAt FROM day_notes ORDER BY trade_date DESC LIMIT 2000").all();
  const memories = database.prepare(`
    SELECT m.id, m.trade_id AS tradeId, m.lesson, m.active, m.created_at AS createdAt,
      m.updated_at AS updatedAt, t.symbol, t.trade_date AS date, t.pnl_amount AS pnlAmount,
      t.pnl_currency AS pnlCurrency, t.pnl_percent AS pnlPercent
    FROM trade_memories m JOIN trades t ON t.id = m.trade_id
    ORDER BY m.updated_at DESC LIMIT 1000
  `).all().map((memory) => ({ ...memory, active: memory.active === 1 }));
  return { trades, days, memories, storage: "SQLite · local" };
}

export function listActiveMemories(limit = 12, symbol = null) {
  return database.prepare(`
    SELECT m.lesson, m.updated_at AS updatedAt, t.symbol, t.trade_date AS date,
      t.pnl_amount AS pnlAmount, t.pnl_currency AS pnlCurrency, t.pnl_percent AS pnlPercent
    FROM trade_memories m JOIN trades t ON t.id = m.trade_id
    WHERE m.active = 1 AND (? IS NULL OR t.symbol = ?)
    ORDER BY m.updated_at DESC LIMIT ?
  `).all(symbol, symbol, Math.max(1, Math.min(30, Math.trunc(limit))));
}

export function getTrade(id) {
  return toTrade(database.prepare("SELECT * FROM trades WHERE id = ?").get(String(id)));
}

export function saveTrade(input) {
  const trade = normalizeTrade(input);
  const previous = getTrade(trade.id);
  const reviewFields = [
    "timestamp", "date", "symbol", "side", "style", "orderType", "entry", "exitPrice",
    "stopLoss", "takeProfit", "quantity", "pnlAmount", "pnlCurrency", "pnlPercent", "status",
    "lastCheckPrice", "lastCheckResult", "lastCheckNote", "lastCheckedAt",
    "thesis", "notes", "planRationale", "planTrigger", "planInvalidation", "originalAnalysis",
  ];
  const changed = previous && reviewFields.some((field) => !Object.is(previous[field], trade[field]));
  database.exec("BEGIN IMMEDIATE");
  try {
    insertOrUpdateTrade(trade);
    if (changed) {
      database.prepare("DELETE FROM trade_memories WHERE trade_id = ?").run(trade.id);
      database.prepare("UPDATE trades SET review = '', reviewed_at = NULL WHERE id = ?").run(trade.id);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return getTrade(trade.id);
}

export function saveTradeCheck(id, check) {
  const trade = getTrade(id);
  if (!trade) throw new Error("Không tìm thấy lệnh giao dịch.");
  if (!["tracking", "open"].includes(trade.status)) throw new Error("Lệnh này đã có kết quả cuối hoặc đã được ghi đóng.");
  const result = String(check.result || "uncertain");
  if (!["entry_pending", "open", "target_hit", "stop_hit", "uncertain"].includes(result)) throw new Error("Kết quả kiểm tra không hợp lệ.");
  const status = result === "entry_pending" ? "tracking"
    : result === "open" ? "open"
      : result === "target_hit" ? "target_hit"
        : result === "stop_hit" ? "stop_hit" : trade.status;
  const checkedAt = Date.now();
  database.prepare(`
    UPDATE trades SET trade_status = ?, last_check_price = ?, last_check_result = ?,
      last_check_note = ?, last_checked_at = ?, updated_at = ? WHERE id = ?
  `).run(
    status,
    optionalNumber(check.latestPrice, "Giá kiểm tra gần nhất"),
    result,
    cleanText(check.evidence, 1000, "Ghi chú kiểm tra"),
    checkedAt,
    checkedAt,
    String(id),
  );
  return getTrade(id);
}

export function removeTrade(id) {
  return database.prepare("DELETE FROM trades WHERE id = ?").run(String(id)).changes > 0;
}

export function importLegacyTrades(entries) {
  if (database.prepare("SELECT COUNT(*) AS count FROM trades").get().count > 0) return 0;
  if (!Array.isArray(entries)) return 0;
  const importable = entries.slice(0, 500);
  database.exec("BEGIN IMMEDIATE");
  let imported = 0;
  try {
    for (const entry of importable) {
      try {
        const trade = normalizeTrade({
          ...entry,
          pnlCurrency: entry.pnlCurrency || "USD",
          notes: entry.notes || "",
        });
        insertOrUpdateTrade(trade);
        imported += 1;
      } catch { /* Skip malformed entries in the old browser log. */ }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return imported;
}

export function saveDayNote(date, note) {
  if (!validDateKey(date)) throw new Error("Ngày ghi chú không hợp lệ.");
  const cleanNote = cleanText(note, 8000, "Ghi chú ngày");
  database.prepare(`
    INSERT INTO day_notes(trade_date, note, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(trade_date) DO UPDATE SET note=excluded.note, updated_at=excluded.updated_at
  `).run(date, cleanNote, Date.now());
  return database.prepare("SELECT trade_date AS date, note, updated_at AS updatedAt FROM day_notes WHERE trade_date = ?").get(date);
}

export function getDayNote(date) {
  if (!validDateKey(date)) return null;
  return database.prepare("SELECT trade_date AS date, note FROM day_notes WHERE trade_date = ?").get(date) || null;
}

export function saveTradeReview(id, review, lesson) {
  const reviewText = cleanText(review, 10_000, "Đánh giá AI");
  const lessonText = cleanText(lesson, 2000, "Bài học AI");
  const now = Date.now();
  database.exec("BEGIN IMMEDIATE");
  try {
    const updated = database.prepare("UPDATE trades SET review = ?, reviewed_at = ?, updated_at = ? WHERE id = ?").run(reviewText, now, now, String(id));
    if (!updated.changes) throw new Error("Không tìm thấy lệnh giao dịch.");
    if (lessonText) {
      database.prepare(`
        INSERT INTO trade_memories(id, trade_id, lesson, active, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
        ON CONFLICT(trade_id) DO UPDATE SET lesson=excluded.lesson, updated_at=excluded.updated_at
      `).run(randomUUID(), String(id), lessonText, now, now);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return getTrade(id);
}

export function updateMemory(id, input) {
  const exists = database.prepare("SELECT id FROM trade_memories WHERE id = ?").get(String(id));
  if (!exists) return false;
  const updates = [];
  const values = [];
  if (Object.hasOwn(input, "lesson")) {
    const lesson = cleanText(input.lesson, 2000, "Bài học AI");
    if (!lesson) throw new Error("Bài học AI không được để trống.");
    updates.push("lesson = ?");
    values.push(lesson);
  }
  if (Object.hasOwn(input, "active")) {
    if (typeof input.active !== "boolean") throw new Error("Trạng thái memory không hợp lệ.");
    updates.push("active = ?");
    values.push(input.active === true ? 1 : 0);
  }
  if (!updates.length) return true;
  updates.push("updated_at = ?");
  values.push(Date.now(), String(id));
  database.prepare(`UPDATE trade_memories SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  return true;
}

export function removeMemory(id) {
  return database.prepare("DELETE FROM trade_memories WHERE id = ?").run(String(id)).changes > 0;
}
