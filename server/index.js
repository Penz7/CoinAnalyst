import http from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CodexAppServer } from "./codex-bridge.js";
import { fetchMarketNews } from "./market-news.js";
import {
  getTrade,
  getDayNote,
  importLegacyTrades,
  listActiveMemories,
  listJournal,
  removeMemory,
  removeTrade,
  saveDayNote,
  saveTrade,
  saveTradeCheck,
  saveTradeReview,
  updateMemory,
} from "./journal-db.js";

const PORT = 4174;
const DEFAULT_SYMBOL = "OANDA:XAUUSD";
const UPLOAD_DIR = path.join(tmpdir(), "xauusd-copilot-runtime", "uploads");
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const INTERVALS = {
  "1m": { value: "1m", label: "1 phút" },
  "3m": { value: "3m", label: "3 phút" },
  "5m": { value: "5m", label: "5 phút" },
  "15m": { value: "15m", label: "15 phút" },
  "1h": { value: "1h", label: "1 giờ" },
  "4h": { value: "4h", label: "4 giờ" },
  "1d": { value: "1D", label: "1 ngày" },
  "1w": { value: "1W", label: "1 tuần" },
  "1mo": { value: "1M", label: "1 tháng" },
};
const QUICK_ANALYSIS_INTERVAL_KEYS = ["4h", "1d", "1w", "1mo", "1h", "15m", "5m", "3m", "1m"];
const codex = new CodexAppServer();

function getInterval(value) {
  return INTERVALS[value] || INTERVALS["1h"];
}

function getSymbol(value) {
  const symbol = typeof value === "string" ? value.trim().toUpperCase() : DEFAULT_SYMBOL;
  if (symbol.length > 64 || !/^[-A-Z0-9._!\/]+:[-A-Z0-9._!\/]+$/.test(symbol)) {
    const error = new Error("Symbol phải theo định dạng EXCHANGE:SYMBOL, ví dụ OANDA:XAUUSD hoặc FX:EURUSD.");
    error.statusCode = 400;
    throw error;
  }
  return symbol;
}

function getIntervals(body) {
  const requested = Array.isArray(body.intervals) ? body.intervals : [body.interval];
  const values = [...new Set(requested.filter((value) => Object.hasOwn(INTERVALS, value)))].slice(0, 4);
  const fallback = Object.hasOwn(INTERVALS, body.interval) ? body.interval : "1h";
  return (values.length ? values : [fallback]).map((value) => INTERVALS[value]);
}

function parseQuickAnalysisResponse(answer) {
  const raw = String(answer || "").trim();
  const candidates = [raw, ...[...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1])];
  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (objectMatch) candidates.push(objectMatch[0]);
  let parsed = null;
  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch { /* Try the next JSON-shaped candidate. */ }
  }
  if (!parsed || typeof parsed !== "object") return { answer: raw, plan: null };

  const rawPlan = parsed.plan && typeof parsed.plan === "object" ? parsed.plan : parsed.tradePlan;
  if (!rawPlan || typeof rawPlan !== "object") return { answer: String(parsed.analysis || raw), plan: null };
  const numberOrNull = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const sideValue = String(rawPlan.side || "").toLowerCase();
  const side = ["long", "buy"].includes(sideValue) ? "long" : ["short", "sell"].includes(sideValue) ? "short" : "none";
  const entry = numberOrNull(rawPlan.entry);
  const stopLoss = numberOrNull(rawPlan.stopLoss);
  const takeProfit = numberOrNull(rawPlan.takeProfit);
  const hasTradeLevels = side !== "none" && entry !== null && stopLoss !== null && takeProfit !== null;
  const status = hasTradeLevels ? "setup" : (rawPlan.status === "no_trade" || side === "none") ? "no_trade" : "incomplete";
  const styleValue = String(rawPlan.style || "day_trade").toLowerCase().replace(/[\s-]+/g, "_");
  const orderTypeValue = String(rawPlan.orderType || "limit").toLowerCase();
  return {
    answer: typeof parsed.analysis === "string" ? parsed.analysis : raw,
    plan: {
      status,
      side,
      style: ["scalp", "day_trade", "swing"].includes(styleValue) ? styleValue : "day_trade",
      orderType: ["market", "limit"].includes(orderTypeValue) ? orderTypeValue : "limit",
      trigger: typeof rawPlan.trigger === "string" ? rawPlan.trigger.slice(0, 300) : "",
      entry,
      stopLoss,
      takeProfit,
      riskReward: numberOrNull(rawPlan.riskReward),
      confidence: typeof rawPlan.confidence === "string" ? rawPlan.confidence.slice(0, 24) : "",
      rationale: typeof rawPlan.rationale === "string" ? rawPlan.rationale.slice(0, 800) : "",
      invalidation: typeof rawPlan.invalidation === "string" ? rawPlan.invalidation.slice(0, 500) : "",
    },
  };
}

function parseTradeReviewResponse(answer) {
  const raw = String(answer || "").trim();
  const candidates = [raw, ...[...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1])];
  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (objectMatch) candidates.push(objectMatch[0]);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        return {
          review: typeof parsed.review === "string" ? parsed.review.slice(0, 10_000) : raw.slice(0, 10_000),
          lesson: typeof parsed.lesson === "string" ? parsed.lesson.trim().slice(0, 2000) : "",
        };
      }
    } catch { /* Try the next JSON-shaped candidate. */ }
  }
  return { review: raw.slice(0, 10_000), lesson: "" };
}

function parseTradeCheckResponse(answer) {
  const raw = String(answer || "").trim();
  const candidates = [raw, ...[...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1])];
  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (objectMatch) candidates.push(objectMatch[0]);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || typeof parsed !== "object") continue;
      const allowed = ["entry_pending", "open", "target_hit", "stop_hit", "uncertain"];
      const result = allowed.includes(parsed.result) ? parsed.result : "uncertain";
      const latestPrice = typeof parsed.latestPrice === "number" && Number.isFinite(parsed.latestPrice) ? parsed.latestPrice : null;
      const evidence = typeof parsed.evidence === "string" ? parsed.evidence.slice(0, 1000) : "Không đủ bằng chứng trên ảnh để xác định kết quả.";
      return { result, latestPrice, evidence };
    } catch { /* Try the next JSON-shaped candidate. */ }
  }
  return { result: "uncertain", latestPrice: null, evidence: "AI không trả được kết quả có cấu trúc; trạng thái lệnh được giữ nguyên." };
}

function sendJson(response, statusCode, body) {
  const serialized = JSON.stringify(body);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(serialized),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(serialized);
}

function isLoopbackRequest(request) {
  const origin = request.headers.origin;
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) return false;
      if (!["5173", String(PORT)].includes(parsed.port)) return false;
    } catch {
      return false;
    }
  }
  const host = request.headers.host || "";
  return [`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(host);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) {
      const error = new Error("Yêu cầu quá lớn.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  } catch {
    const error = new Error("Nội dung JSON không hợp lệ.");
    error.statusCode = 400;
    throw error;
  }
}

async function getStatus() {
  let accountResult;
  try {
    accountResult = { status: "fulfilled", value: await codex.account() };
  } catch (error) {
    accountResult = { status: "rejected", reason: error };
  }

  const codexStatus = accountResult.status === "fulfilled"
    ? {
        available: true,
        authenticated: Boolean(accountResult.value.account),
        email: accountResult.value.account?.email || null,
        planType: accountResult.value.account?.planType || null,
        error: null,
      }
    : {
        available: false,
        authenticated: false,
        email: null,
        planType: null,
        error: accountResult.reason?.message || "Không mở được Codex App Server.",
      };

  return { symbol: DEFAULT_SYMBOL, codex: codexStatus };
}

async function saveScreenshot(dataUrl) {
  const match = typeof dataUrl === "string"
    ? dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/)
    : null;
  if (!match) {
    const error = new Error("Đính kèm ảnh PNG, JPG hoặc WebP của chart.");
    error.statusCode = 400;
    throw error;
  }
  const [, format, encoded] = match;
  const image = Buffer.from(encoded, "base64");
  if (!image.length || image.length > MAX_IMAGE_BYTES) {
    const error = new Error("Ảnh chart phải nhỏ hơn 8 MB.");
    error.statusCode = 413;
    throw error;
  }
  const isPng = format === "png" && image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  const isJpeg = format === "jpeg" && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
  const isWebp = format === "webp" && image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP";
  if (!isPng && !isJpeg && !isWebp) {
    const error = new Error("Tệp tải lên không phải ảnh PNG, JPG hoặc WebP hợp lệ.");
    error.statusCode = 400;
    throw error;
  }
  const extension = format === "jpeg" ? "jpg" : format;
  await mkdir(UPLOAD_DIR, { recursive: true, mode: 0o700 });
  const imagePath = path.join(UPLOAD_DIR, `chart-${randomUUID()}.${extension}`);
  await writeFile(imagePath, image, { flag: "wx", mode: 0o600 });
  return imagePath;
}

const server = http.createServer(async (request, response) => {
  if (!isLoopbackRequest(request)) {
    sendJson(response, 403, { error: "Chỉ chấp nhận kết nối từ ứng dụng cục bộ." });
    return;
  }

  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  const requestId = request.method === "POST" && url.pathname === "/api/chat" ? randomUUID() : null;
  const requestStartedAt = Date.now();
  try {
    if (request.method === "GET" && url.pathname === "/api/status") {
      sendJson(response, 200, await getStatus());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/journal") {
      sendJson(response, 200, listJournal());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/journal/import-legacy") {
      const body = await readJson(request);
      const imported = importLegacyTrades(body.trades);
      sendJson(response, 200, { imported, ...listJournal() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/journal/trades") {
      const body = await readJson(request);
      sendJson(response, 201, { trade: saveTrade(body) });
      return;
    }

    const tradeCheckMatch = url.pathname.match(/^\/api\/journal\/trades\/([^/]+)\/check$/);
    if (request.method === "POST" && tradeCheckMatch) {
      const trade = getTrade(decodeURIComponent(tradeCheckMatch[1]));
      if (!trade) {
        sendJson(response, 404, { error: "Không tìm thấy lệnh giao dịch." });
        return;
      }
      if (!["tracking", "open"].includes(trade.status)) {
        sendJson(response, 409, { error: "Lệnh này đã có kết quả cuối hoặc đã được ghi đóng." });
        return;
      }
      const account = await codex.account();
      if (!account.account) {
        sendJson(response, 401, { error: "Hãy kết nối tài khoản Codex trước khi kiểm tra lệnh." });
        return;
      }
      const body = await readJson(request);
      const imagePath = await saveScreenshot(body.imageDataUrl);
      try {
        const answer = await codex.checkTradeOutcome(trade, imagePath);
        const check = parseTradeCheckResponse(answer);
        sendJson(response, 200, { check, trade: saveTradeCheck(trade.id, check) });
      } finally {
        await unlink(imagePath).catch(() => {});
      }
      return;
    }

    const tradeReviewMatch = url.pathname.match(/^\/api\/journal\/trades\/([^/]+)\/review$/);
    if (request.method === "POST" && tradeReviewMatch) {
      const trade = getTrade(decodeURIComponent(tradeReviewMatch[1]));
      if (!trade) {
        sendJson(response, 404, { error: "Không tìm thấy lệnh giao dịch." });
        return;
      }
      const account = await codex.account();
      if (!account.account) {
        sendJson(response, 401, { error: "Hãy kết nối tài khoản Codex trước khi yêu cầu AI review." });
        return;
      }
      trade.dayNote = getDayNote(trade.date)?.note || "";
      const review = parseTradeReviewResponse(await codex.reviewTrade(trade));
      const savedTrade = saveTradeReview(trade.id, review.review, review.lesson);
      sendJson(response, 200, { trade: savedTrade, lesson: review.lesson });
      return;
    }

    const tradeMatch = url.pathname.match(/^\/api\/journal\/trades\/([^/]+)$/);
    if (request.method === "PUT" && tradeMatch) {
      const body = await readJson(request);
      sendJson(response, 200, { trade: saveTrade({ ...body, id: decodeURIComponent(tradeMatch[1]) }) });
      return;
    }
    if (request.method === "DELETE" && tradeMatch) {
      const deleted = removeTrade(decodeURIComponent(tradeMatch[1]));
      sendJson(response, deleted ? 200 : 404, deleted ? { deleted: true } : { error: "Không tìm thấy lệnh giao dịch." });
      return;
    }

    const dayNoteMatch = url.pathname.match(/^\/api\/journal\/days\/(\d{4}-\d{2}-\d{2})$/);
    if (request.method === "PUT" && dayNoteMatch) {
      const body = await readJson(request);
      sendJson(response, 200, { day: saveDayNote(dayNoteMatch[1], body.note) });
      return;
    }

    const memoryMatch = url.pathname.match(/^\/api\/journal\/memories\/([^/]+)$/);
    if (request.method === "PATCH" && memoryMatch) {
      const body = await readJson(request);
      const updated = updateMemory(decodeURIComponent(memoryMatch[1]), body);
      sendJson(response, updated ? 200 : 404, updated ? { updated: true } : { error: "Không tìm thấy bài học." });
      return;
    }
    if (request.method === "DELETE" && memoryMatch) {
      const deleted = removeMemory(decodeURIComponent(memoryMatch[1]));
      sendJson(response, deleted ? 200 : 404, deleted ? { deleted: true } : { error: "Không tìm thấy bài học." });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      sendJson(response, 200, await codex.beginChatGptLogin());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/chat/clear") {
      codex.clearConversation();
      sendJson(response, 200, { cleared: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      console.info(`[chat ${requestId}] request received`);
      const body = await readJson(request);
      const message = typeof body.message === "string" ? body.message.trim() : "";
      const quickAnalysis = body.quickAnalysis === true;
      const intervals = quickAnalysis
        ? QUICK_ANALYSIS_INTERVAL_KEYS.map((value) => INTERVALS[value])
        : getIntervals(body);
      const symbol = getSymbol(body.symbol);
      const imageDataUrls = Array.isArray(body.imageDataUrls)
        ? body.imageDataUrls
        : body.imageData ? [body.imageData] : [];
      if (message.length > 2_000) {
        sendJson(response, 400, { error: "Câu hỏi tối đa 2.000 ký tự." });
        return;
      }
      if (imageDataUrls.length > 4) {
        sendJson(response, 400, { error: "Có thể gửi tối đa 4 ảnh chart trong một lượt." });
        return;
      }
      if (quickAnalysis && imageDataUrls.length !== 4) {
        sendJson(response, 400, { error: "Quick analysis cần đủ 4 ảnh: lưới Bias, Trade, Entry và chart 15m." });
        return;
      }

      const account = await codex.account();
      if (!account.account) {
        sendJson(response, 401, { error: "Hãy kết nối tài khoản ChatGPT/Codex trước." });
        return;
      }
      if (!imageDataUrls.length) {
        sendJson(response, 400, { error: "Hãy chụp chart và đính kèm ảnh trước khi phân tích." });
        return;
      }

      const imagePaths = [];
      const intervalLabels = intervals.map((item) => item.label);
      let answer;
      let plan = null;
      let news = null;
      const personalTradeMemory = listActiveMemories(12, symbol);
      try {
        const newsPromise = quickAnalysis ? fetchMarketNews(symbol) : Promise.resolve(null);
        for (const imageDataUrl of imageDataUrls) imagePaths.push(await saveScreenshot(imageDataUrl));
        console.info(`[chat ${requestId}] ${imagePaths.length} chart image(s) staged; intervals=${intervals.map((item) => item.value).join(",")}`);
        news = await newsPromise;
        if (quickAnalysis) console.info(`[chat ${requestId}] market-news check: recent=${news?.items?.length || 0}; context=${news?.contextItems?.length || 0}; included-sources=${news?.sources?.join(",") || "none"}; checked-sources=${news?.checkedSources?.join(",") || "none"}`);
        console.info(`[chat ${requestId}] Codex analysis started`);
        answer = await codex.analyze(message || "Hãy phân tích chart trong ảnh này.", intervalLabels, symbol, imagePaths, { quickAnalysis, marketNews: news, personalTradeMemory });
        if (quickAnalysis) {
          const parsed = parseQuickAnalysisResponse(answer);
          answer = parsed.answer;
          plan = parsed.plan;
        }
      } finally {
        await Promise.all(imagePaths.map((imagePath) => unlink(imagePath).catch(() => {})));
      }
      console.info(`[chat ${requestId}] completed in ${Date.now() - requestStartedAt}ms`);
      sendJson(response, 200, {
        answer,
        market: {
          source: quickAnalysis ? "Quick analysis" : "Ảnh chart",
          symbol,
          interval: quickAnalysis ? "15m" : intervals[0].value,
          intervals: intervals.map((item) => item.value),
          intervalLabel: quickAnalysis ? "Bias H4 · D · W · M; Trade D · H4 · H1 · 15m; Entry 15m · 5m · 3m · 1m" : intervalLabels.join(" · "),
        },
        attachedImage: true,
        ...(quickAnalysis ? { plan, news } : {}),
      });
      return;
    }

    sendJson(response, 404, { error: "Không tìm thấy API endpoint." });
  } catch (error) {
    const statusCode = error.statusCode || (error.message?.includes("ENOENT") ? 503 : 500);
    if (requestId) console.error(`[chat ${requestId}] failed (${statusCode}): ${error.message || "unknown error"}`);
    sendJson(response, statusCode, { error: error.message || "Có lỗi ở backend." });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`CoinAnalyst API listening on http://127.0.0.1:${PORT}`);
});
