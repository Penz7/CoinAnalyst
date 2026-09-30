import React, { useEffect, useId, useRef, useState } from "react";
import TradeJournalWorkspace from "./TradeJournalWorkspace.jsx";

const SINGLE_TIMEFRAMES = [
  { value: "15m", label: "15m", chartInterval: "15" },
  { value: "1h", label: "1H", chartInterval: "60" },
  { value: "4h", label: "4H", chartInterval: "240" },
  { value: "1d", label: "1D", chartInterval: "D" },
];
const CHART_TIMEFRAMES = [
  { value: "1m", label: "1m", chartInterval: "1" },
  { value: "3m", label: "3m", chartInterval: "3" },
  { value: "5m", label: "5m", chartInterval: "5" },
  ...SINGLE_TIMEFRAMES,
  { value: "1w", label: "1W", chartInterval: "W" },
  { value: "1mo", label: "1M", chartInterval: "M" },
];
const MULTI_PRESETS = [
  { key: "bias", label: "Bias", summary: "4H · D · W · M", timeframes: ["4h", "1d", "1w", "1mo"] },
  { key: "trade", label: "Trade", summary: "D · 4H · 1H · 15m", timeframes: ["1d", "4h", "1h", "15m"] },
  { key: "entry", label: "Entry", summary: "15m · 5m · 3m · 1m", timeframes: ["15m", "5m", "3m", "1m"] },
];
const CHART_TIMEFRAME_BY_VALUE = Object.fromEntries(CHART_TIMEFRAMES.map((frame) => [frame.value, frame]));
const MESSAGE_KEY = "xauusd-copilot-screenshot-messages-v1";
const TRADE_LOG_KEY = "xauusd-copilot-trade-log-v1";
const SYMBOL_KEY = "xauusd-copilot-tradingview-symbol-v1";
const DEFAULT_SYMBOL = "OANDA:XAUUSD";
const SYMBOL_PATTERN = /^[-A-Z0-9._!\/]+:[-A-Z0-9._!\/]+$/;
const INITIAL_MESSAGE = {
  id: "welcome-screenshot-v1",
  role: "assistant",
  text: "Chào bạn! Hãy nhập câu hỏi về biểu đồ đang chọn. Lần đầu gửi, chọn tab CoinAnalyst trong hộp thoại chia sẻ; app sẽ tự chụp chart để mình phân tích nến, indicator và đường vẽ đang hiển thị.",
};

function loadSymbol() {
  try {
    const saved = localStorage.getItem(SYMBOL_KEY)?.trim().toUpperCase();
    return saved && saved.length <= 64 && SYMBOL_PATTERN.test(saved) ? saved : DEFAULT_SYMBOL;
  } catch {
    return DEFAULT_SYMBOL;
  }
}

function chartReadyKey(symbol, interval) {
  return `${symbol}:${interval}`;
}

function loadMessages() {
  try {
    const saved = JSON.parse(localStorage.getItem(MESSAGE_KEY) || "[]");
    return Array.isArray(saved) && saved.length
      ? saved.map(({ annotatedImage, chartImage, chartAnnotated, ...message }) => ({
          ...message,
          ...(message.id === INITIAL_MESSAGE.id ? { text: INITIAL_MESSAGE.text } : {}),
          ...(!chartAnnotated && chartImage ? { chartImage } : {}),
        }))
      : [INITIAL_MESSAGE];
  } catch {
    return [INITIAL_MESSAGE];
  }
}

function localDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function planTradeEntry(plan, message) {
  const timestamp = Number.isFinite(message.timestamp) ? message.timestamp : Date.now();
  return {
    id: `plan-${message.id}`,
    planId: message.id,
    timestamp,
    date: localDateKey(timestamp),
    symbol: message.market?.symbol || DEFAULT_SYMBOL,
    side: plan.side,
    style: plan.style || "day_trade",
    orderType: plan.orderType || "limit",
    entry: plan.entry,
    stopLoss: plan.stopLoss,
    takeProfit: plan.takeProfit,
    pnlCurrency: "USD",
    status: "tracking",
    thesis: "",
    notes: "",
    planRationale: plan.rationale || "",
    planTrigger: plan.trigger || "",
    planInvalidation: plan.invalidation || "",
    originalAnalysis: message.text || "",
  };
}

function loadTradeLog() {
  try {
    const saved = JSON.parse(localStorage.getItem(TRADE_LOG_KEY) || "[]");
    if (!Array.isArray(saved)) return [];
    return saved.filter((entry) => entry && typeof entry.id === "string" && Number.isFinite(entry.timestamp) && Number.isFinite(entry.pnlPercent)).slice(0, 500);
  } catch {
    return [];
  }
}

function formatPercent(value) {
  const rounded = Number(value.toFixed(2));
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}%`;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Không đọc được ảnh chart."));
    reader.readAsDataURL(file);
  });
}

function renderInlineMarkdown(text, keyPrefix) {
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  const parts = [];
  let cursor = 0;
  let match;
  let index = 0;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    const token = match[0];
    const content = token.slice(token.startsWith("**") || token.startsWith("__") ? 2 : 1, -(token.startsWith("**") || token.startsWith("__") ? 2 : 1));
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith("**") || token.startsWith("__")) parts.push(<strong key={key}>{content}</strong>);
    else if (token.startsWith("`")) parts.push(<code key={key}>{content}</code>);
    else parts.push(<em key={key}>{content}</em>);
    cursor = pattern.lastIndex;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function extractPriceZones(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].includes("|") || !lines[index + 1].includes("|")) continue;
    const header = splitTableRow(lines[index]).join(" ").toLowerCase();
    const separator = splitTableRow(lines[index + 1]);
    const isTable = separator.length === splitTableRow(lines[index]).length
      && separator.every((cell) => /^:?-{3,}:?$/.test(cell));
    const isPriceZones = /vùng|zone|support|resistance|hỗ trợ|kháng cự|mức giá|price level/.test(header);
    if (!isTable || !isPriceZones) continue;

    let previous = index - 1;
    while (previous >= 0 && !lines[previous].trim()) previous -= 1;
    const start = previous >= 0 && /^\s{0,3}#{1,4}\s+/.test(lines[previous]) ? previous : index;
    let end = index + 2;
    while (end < lines.length && lines[end].trim() && lines[end].includes("|")) end += 1;
    const zoneLines = lines.slice(start, end);
    const remainingLines = [...lines.slice(0, start), ...lines.slice(end)];
    return {
      analysis: remainingLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
      zones: zoneLines.join("\n").trim(),
    };
  }
  return { analysis: String(text || ""), zones: "" };
}

function MarkdownMessage({ text }) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let index = 0;
  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join(" "), key: `p-${index++}` });
      paragraph = [];
    }
  };

  while (lines.length) {
    const line = lines.shift();
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", level: Math.min(heading[1].length, 3), text: heading[2], key: `h-${index++}` });
      continue;
    }

    if (/^\s*```/.test(line)) {
      flushParagraph();
      const codeLines = [];
      while (lines.length && !/^\s*```/.test(lines[0])) codeLines.push(lines.shift());
      if (lines.length) lines.shift();
      blocks.push({ type: "code", text: codeLines.join("\n"), key: `code-${index++}` });
      continue;
    }

    if (line.includes("|") && lines[0]?.includes("|")) {
      const header = splitTableRow(line);
      const separator = splitTableRow(lines[0]);
      if (separator.length === header.length && separator.every((cell) => /^:?-{3,}:?$/.test(cell))) {
        flushParagraph();
        lines.shift();
        const rows = [];
        while (lines.length && lines[0].trim() && lines[0].includes("|")) rows.push(splitTableRow(lines.shift()));
        blocks.push({ type: "table", header, rows, key: `table-${index++}` });
        continue;
      }
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const listType = ordered ? "ol" : "ul";
      const items = [(unordered || ordered)[1]];
      while (lines.length) {
        const next = lines[0].match(listType === "ol" ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/);
        if (!next) break;
        items.push(next[1]);
        lines.shift();
      }
      blocks.push({ type: listType, items, key: `list-${index++}` });
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      blocks.push({ type: "quote", text: quote[1], key: `quote-${index++}` });
      continue;
    }

    if (/^\s*(---|___|\*\*\*)\s*$/.test(line)) {
      flushParagraph();
      blocks.push({ type: "rule", key: `rule-${index++}` });
      continue;
    }

    paragraph.push(line.trim());
  }
  flushParagraph();

  return <div className="markdown-content">
    {blocks.map((block) => {
      if (block.type === "paragraph") return <p key={block.key}>{renderInlineMarkdown(block.text, block.key)}</p>;
      if (block.type === "heading") {
        const Tag = `h${block.level}`;
        return <Tag key={block.key}>{renderInlineMarkdown(block.text, block.key)}</Tag>;
      }
      if (block.type === "ul" || block.type === "ol") {
        const Tag = block.type;
        return <Tag key={block.key}>{block.items.map((item, itemIndex) => <li key={`${block.key}-${itemIndex}`}>{renderInlineMarkdown(item, `${block.key}-${itemIndex}`)}</li>)}</Tag>;
      }
      if (block.type === "table") return <div className="markdown-table-wrap" key={block.key}><table className="markdown-table">
        <thead><tr>{block.header.map((cell, cellIndex) => <th key={`${block.key}-h-${cellIndex}`}>{renderInlineMarkdown(cell, `${block.key}-h-${cellIndex}`)}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, rowIndex) => <tr key={`${block.key}-r-${rowIndex}`}>{block.header.map((_, cellIndex) => <td key={`${block.key}-${rowIndex}-${cellIndex}`}>{renderInlineMarkdown(row[cellIndex] || "", `${block.key}-${rowIndex}-${cellIndex}`)}</td>)}</tr>)}</tbody>
      </table></div>;
      if (block.type === "code") return <pre key={block.key}><code>{block.text}</code></pre>;
      if (block.type === "quote") return <blockquote key={block.key}>{renderInlineMarkdown(block.text, block.key)}</blockquote>;
      return <hr key={block.key} />;
    })}
  </div>;
}

function formatPrice(value) {
  return Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 5 }) : "—";
}

function QuickPlanCard({ plan, onRecordTrade, onTrackPlan, tradeEntry = null }) {
  const isSetup = plan.status === "setup" && ["long", "short"].includes(plan.side);
  const isNoTrade = plan.status === "no_trade";
  const [loggingResult, setLoggingResult] = useState(false);
  const [resultPercent, setResultPercent] = useState("");
  const resultInputId = useId();
  const styleLabel = ({ scalp: "SCALP", day_trade: "DAY TRADE", swing: "SWING" })[plan.style] || "DAY TRADE";
  const entryNow = plan.orderType === "market";

  function submitResult(event) {
    event.preventDefault();
    const value = Number(resultPercent);
    if (!Number.isFinite(value) || resultPercent.trim() === "") return;
    onRecordTrade(value);
    setResultPercent("");
    setLoggingResult(false);
  }

  return <section className={`quick-plan-card ${isSetup ? `quick-plan-${plan.side}` : "quick-plan-no-trade"}`}>
    <div className="quick-plan-heading">
      <div><span className="quick-plan-eyebrow">KẾ HOẠCH GIAO DỊCH</span><strong>{isSetup ? `${plan.side === "long" ? "LONG" : "SHORT"} · ${styleLabel}` : isNoTrade ? "KỊCH BẢN CHƯA ĐỦ DỮ LIỆU" : "SETUP CHƯA ĐỦ DỮ LIỆU"}</strong></div>
      <div className="quick-plan-badges">{Number.isFinite(plan.riskReward) && <span className="quick-plan-rr">R:R 1:{plan.riskReward.toFixed(2)}</span>}{plan.confidence && <span className={`quick-plan-confidence confidence-${plan.confidence.toLowerCase()}`}>{plan.confidence}</span>}</div>
    </div>
    {isSetup && <div className={`quick-plan-order ${entryNow ? "quick-plan-order-now" : "quick-plan-order-limit"}`}><span className="quick-plan-entry-icon">{entryNow ? "↗" : "⌁"}</span><span><strong>{entryNow ? "ENTRY NOW" : "LIMIT ENTRY"}</strong><small>{entryNow ? "Tín hiệu đã xác nhận · giá vào theo chart chụp" : "Chờ giá hồi về vùng Entry"}</small></span></div>}
    {isSetup && <div className="quick-plan-levels">
      <div className="quick-plan-level entry-level"><span>{entryNow ? "ENTRY NOW" : "ENTRY LIMIT"}</span><strong>{formatPrice(plan.entry)}</strong></div>
      <div className="quick-plan-level stop-level"><span>STOP LOSS</span><strong>{formatPrice(plan.stopLoss)}</strong></div>
      <div className="quick-plan-level target-level"><span>TAKE PROFIT</span><strong>{formatPrice(plan.takeProfit)}</strong></div>
    </div>}
    {plan.rationale && <p className="quick-plan-rationale">{plan.rationale}</p>}
    {isSetup && plan.trigger && <div className="quick-plan-detail quick-plan-trigger"><b>{entryNow ? "Xác nhận Entry Now" : "Điều kiện khớp limit"}</b><p>{plan.trigger}</p></div>}
    {plan.invalidation && <div className="quick-plan-detail quick-plan-invalidation"><b>Vô hiệu kế hoạch</b><p>{plan.invalidation}</p></div>}
    {isSetup && onRecordTrade && (tradeEntry
      ? <div className="trade-result-saved">
          {tradeEntry.status === "closed" ? "Đã lưu kết quả vào nhật ký." : tradeEntry.status === "target_hit" ? "Chart gần nhất đã chạm TP · chưa xác nhận khớp lệnh hoặc PnL tài khoản." : tradeEntry.status === "stop_hit" ? "Chart gần nhất đã chạm SL · chưa xác nhận khớp lệnh hoặc PnL tài khoản." : "Kế hoạch đang được theo dõi trong sổ · chưa xác nhận khớp lệnh."}
          {tradeEntry.status !== "closed" && <button className="trade-result-open" type="button" onClick={() => setLoggingResult(true)}>Ghi kết quả thực tế</button>}
          {loggingResult && tradeEntry.status !== "closed" && <form className="trade-result-form" onSubmit={submitResult}><label htmlFor={resultInputId}>Kết quả thực tế (% tài khoản)</label><div><input id={resultInputId} type="number" step="0.01" inputMode="decimal" value={resultPercent} onChange={(event) => setResultPercent(event.target.value)} placeholder="+1.25 hoặc -0.50" autoComplete="off" /><span>%</span><button type="submit" disabled={resultPercent.trim() === ""}>Lưu</button><button className="trade-result-cancel" type="button" onClick={() => setLoggingResult(false)}>Hủy</button></div></form>}
        </div>
      : loggingResult
        ? <form className="trade-result-form" onSubmit={submitResult}>
            <label htmlFor={resultInputId}>Kết quả thực tế (% tài khoản)</label>
            <div><input id={resultInputId} type="number" step="0.01" inputMode="decimal" value={resultPercent} onChange={(event) => setResultPercent(event.target.value)} placeholder="+1.25 hoặc -0.50" autoComplete="off" /><span>%</span><button type="submit" disabled={resultPercent.trim() === ""}>Lưu</button><button className="trade-result-cancel" type="button" onClick={() => setLoggingResult(false)}>Hủy</button></div>
          </form>
        : <><button className="trade-result-open" type="button" onClick={onTrackPlan}>＋ Theo dõi lệnh trong sổ</button><button className="trade-result-open" type="button" onClick={() => setLoggingResult(true)}>＋ Ghi kết quả thực tế</button></>)}
  </section>;
}

function MarketNewsBrief({ news }) {
  if (!news) return null;
  const checkedAt = news.checkedAt && !Number.isNaN(Date.parse(news.checkedAt))
    ? new Date(news.checkedAt).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })
    : "";
  const items = Array.isArray(news.items) ? news.items : [];
  const contextItems = Array.isArray(news.contextItems) ? news.contextItems : [];
  const renderItems = (list) => <ul>{list.map((item, index) => <li key={`${item.url || item.title}-${index}`}>
    <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
    <span>{item.source}{item.publishedAt && !Number.isNaN(Date.parse(item.publishedAt)) ? ` · ${new Date(item.publishedAt).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}` : ""}</span>
  </li>)}</ul>;
  return <section className="market-news-brief" aria-label="Nguồn tin thị trường đã đối chiếu">
    <div className="market-news-heading">
      <strong>TIN TỨC ĐỐI CHIẾU</strong>
      {checkedAt && <span>Kiểm tra {checkedAt}</span>}
    </div>
    <div className="market-news-group">
      <strong>TIN MỚI · 72 GIỜ</strong>
      {items.length ? renderItems(items) : <p>Không tìm thấy headline mới trong 72 giờ. Phân tích không nên gán biến động hiện tại cho tin cũ.</p>}
    </div>
    {contextItems.length > 0 && <div className="market-news-group market-news-context">
      <strong>BỐI CẢNH CŨ · 3–14 NGÀY · KHÔNG PHẢI TIN MỚI</strong>
      {renderItems(contextItems)}
    </div>}
    <p>Headline/snippet tham khảo, không phải toàn văn, lịch sự kiện kinh tế hay dữ liệu giá.</p>
  </section>;
}

function formatQuickAnalysisText(text) {
  const value = String(text || "").trim();
  if (!value || /^\s*#{1,3}\s/m.test(value)) return value;

  const ictAt = value.search(/\b(?:ICT\s*\/\s*SMC|SMC\s*\/\s*ICT)\b/i);
  const newsAt = value.search(/\b(?:headline|tin tức)\b/i);
  const cuts = [
    ...(ictAt > 80 ? [{ at: ictAt, title: "BẰNG CHỨNG ICT / SMC" }] : []),
    ...(newsAt > 80 ? [{ at: newsAt, title: "TIN TỨC & PHẢN ỨNG" }] : []),
  ].sort((left, right) => left.at - right.at);
  const sections = [];
  let start = 0;
  if (!cuts.length) cuts.push({ at: value.length, title: "" });
  for (const cut of cuts) {
    const body = value.slice(start, cut.at).trim();
    if (body) sections.push({ title: start === 0 ? "BIAS & BỐI CẢNH ĐA KHUNG" : cuts.find((item) => item.at === start)?.title || "PHÂN TÍCH", body });
    start = cut.at;
  }
  const tail = value.slice(start).trim();
  if (tail) sections.push({ title: cuts.find((item) => item.at === start)?.title || "PHÂN TÍCH", body: tail });

  const formatParagraphs = (body) => body
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-Ỵ0-9])/u)
    .reduce((paragraphs, sentence, index) => {
      const slot = Math.floor(index / 2);
      paragraphs[slot] = paragraphs[slot] ? paragraphs[slot] + " " + sentence : sentence;
      return paragraphs;
    }, [])
    .join("\n\n");
  return sections.map((section) => (section.title ? "## " + section.title + "\n\n" : "") + formatParagraphs(section.body)).join("\n\n");
}

function AnalysisResultCard({ message, tradeEntry, onRecordTrade, onTrackPlan }) {
  const chartImage = message.chartImage;
  const { analysis: extractedText, zones: priceZones } = chartImage ? extractPriceZones(message.text) : { analysis: message.text, zones: "" };
  const analysisText = message.quickAnalysis ? formatQuickAnalysisText(extractedText) : extractedText;
  const imageLabel = message.quickAnalysis ? "CHART 15m · ẢNH GỐC" : "CHART ĐÃ CHỤP";
  return <article className="analysis-result-card">
    <header className="analysis-result-card-heading">
      <strong>{message.quickAnalysis ? "QUICK TRADE PLAN" : "CẬP NHẬT PHÂN TÍCH"}</strong>
      {message.market && <span>{message.market.symbol} · {message.market.source}</span>}
    </header>
    <div className={chartImage ? "analysis-result-content has-chart" : "analysis-result-content"}>
      {chartImage && <figure className="analysis-result-figure">
        <figcaption>{imageLabel}{message.quickAnalysis && message.plan?.status === "setup" ? ` · ${message.plan.side.toUpperCase()} · ${message.plan.style.replace(/_/g, " ").toUpperCase()}` : ""}</figcaption>
        <img className="analysis-result-chart" src={chartImage} alt="Chart TradingView được chụp để phân tích" />
        {priceZones && <div className="analysis-result-zones"><MarkdownMessage text={priceZones} /></div>}
      </figure>}
      <div className="analysis-result-copy">
        {message.plan && <QuickPlanCard plan={message.plan} tradeEntry={tradeEntry} onRecordTrade={onRecordTrade} onTrackPlan={onTrackPlan} />}
        <div className="analysis-result-text"><MarkdownMessage text={analysisText} /></div>
        {message.quickAnalysis && <MarketNewsBrief news={message.news} />}
        {message.market && <div className="message-meta">{message.market.source} · {message.market.symbol} · {message.market.intervalLabel}</div>}
      </div>
    </div>
  </article>;
}

function waitForVideoFrame(video) {
  return new Promise((resolve) => {
    let frameId;
    const timer = window.setTimeout(finish, 1500);
    function finish() {
      window.clearTimeout(timer);
      if (frameId && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(frameId);
      }
      resolve();
    }
    if (typeof video.requestVideoFrameCallback === "function") {
      frameId = video.requestVideoFrameCallback(finish);
    } else {
      requestAnimationFrame(finish);
    }
  });
}

function hasRenderedCandles(video, frameElement, canvas, context) {
  if (!video.videoWidth || !video.videoHeight || !frameElement?.isConnected) return false;
  const rect = frameElement.getBoundingClientRect();
  if (rect.width < 120 || rect.height < 100) return false;

  const scaleX = video.videoWidth / window.innerWidth;
  const scaleY = video.videoHeight / window.innerHeight;
  const left = Math.max(0, Math.floor((rect.left + rect.width * 0.07) * scaleX));
  const top = Math.max(0, Math.floor((rect.top + rect.height * 0.08) * scaleY));
  const right = Math.min(video.videoWidth, Math.ceil((rect.right - rect.width * 0.07) * scaleX));
  const bottom = Math.min(video.videoHeight, Math.ceil((rect.bottom - rect.height * 0.08) * scaleY));
  if (right <= left || bottom <= top) return false;

  canvas.width = 128;
  canvas.height = 80;
  try {
    context.drawImage(video, left, top, right - left, bottom - top, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    let candleColorPixels = 0;
    let luminanceTotal = 0;
    let luminanceSquaredTotal = 0;
    const pixelCount = canvas.width * canvas.height;

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      colors.add(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4));
      if ((red > 32 && red > green * 1.2) || (green > 32 && green > red * 1.2)) {
        candleColorPixels += 1;
      }
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      luminanceTotal += luminance;
      luminanceSquaredTotal += luminance * luminance;
    }

    const meanLuminance = luminanceTotal / pixelCount;
    const luminanceDeviation = Math.sqrt(Math.max(0, luminanceSquaredTotal / pixelCount - meanLuminance * meanLuminance));
    return colors.size >= 12 && candleColorPixels >= Math.max(8, pixelCount * 0.0018) && luminanceDeviation >= 12;
  } catch {
    return false;
  }
}

function Icon({ name, size = 18 }) {
  const shared = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  if (name === "spark") return <svg {...shared}><path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4L12 3Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/></svg>;
  if (name === "arrow") return <svg {...shared}><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>;
  if (name === "chart") return <svg {...shared}><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 6-7"/></svg>;
  if (name === "lock") return <svg {...shared}><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>;
  if (name === "refresh") return <svg {...shared}><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 6"/><path d="M18.4 15A7 7 0 0 1 6 18l-2-6"/></svg>;
  if (name === "send") return <svg {...shared}><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>;
  if (name === "close") return <svg {...shared}><path d="m18 6-12 12M6 6l12 12"/></svg>;
  if (name === "image") return <svg {...shared}><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>;
  if (name === "trash") return <svg {...shared}><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>;
  return null;
}

async function api(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Lỗi HTTP ${response.status}`);
  return body;
}

function TradingViewChart({ interval, symbol, onReady }) {
  const mountRef = useRef(null);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    mount.replaceChildren();
    let observedFrame = null;
    let frameLoadHandler = null;
    let readyTimer = null;
    const observer = new MutationObserver(() => {
      const frameElement = mount.querySelector("iframe");
      if (!frameElement || frameElement === observedFrame) return;
      observedFrame = frameElement;
      frameLoadHandler = () => {
        readyTimer = window.setTimeout(() => {
          if (frameElement.isConnected) onReadyRef.current?.(interval);
        }, 1800);
      };
      frameElement.addEventListener("load", frameLoadHandler, { once: true });
    });
    observer.observe(mount, { childList: true, subtree: true });

    const frame = CHART_TIMEFRAME_BY_VALUE[interval] || CHART_TIMEFRAME_BY_VALUE["1h"];
    const container = document.createElement("div");
    container.className = "tradingview-widget-container";
    container.style.width = "100%";
    container.style.height = "100%";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.width = "100%";
    widget.style.height = "100%";
    container.appendChild(widget);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.textContent = JSON.stringify({
      autosize: true,
      symbol,
      interval: frame.chartInterval,
      timezone: "Asia/Ho_Chi_Minh",
      theme: "dark",
      style: "1",
      locale: "vi_VN",
      allow_symbol_change: false,
      hide_top_toolbar: true,
      calendar: false,
      support_host: "https://www.tradingview.com",
      withdateranges: true,
      hide_side_toolbar: false,
      details: false,
      hotlist: false,
      save_image: false,
    });
    container.appendChild(script);
    mount.appendChild(container);
    return () => {
      observer.disconnect();
      if (readyTimer) window.clearTimeout(readyTimer);
      if (observedFrame && frameLoadHandler) observedFrame.removeEventListener("load", frameLoadHandler);
      mount.replaceChildren();
    };
  }, [interval, symbol]);

  return <div className="chart-embed" ref={mountRef} aria-label={`TradingView ${symbol} chart`} />;
}

export default function App() {
  const [interval, setInterval] = useState("1h");
  const [chartMode, setChartMode] = useState("single");
  const [multiPreset, setMultiPreset] = useState("trade");
  const [chartCaptureGeneration, setChartCaptureGeneration] = useState(0);
  const [symbol, setSymbol] = useState(loadSymbol);
  const [symbolDraft, setSymbolDraft] = useState(loadSymbol);
  const [readyCharts, setReadyCharts] = useState([]);
  const [status, setStatus] = useState(null);
  const [loginUrl, setLoginUrl] = useState("");
  const [messages, setMessages] = useState(loadMessages);
  const [tradeLog, setTradeLog] = useState(loadTradeLog);
  const [journalDays, setJournalDays] = useState([]);
  const [tradeMemories, setTradeMemories] = useState([]);
  const [activeView, setActiveView] = useState("analysis");
  const [draft, setDraft] = useState("");
  const [captureActive, setCaptureActive] = useState(false);
  const [analysisPhase, setAnalysisPhase] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const chatEndRef = useRef(null);
  const analysisResultsEndRef = useRef(null);
  const chartFrameRef = useRef(null);
  const captureStreamRef = useRef(null);
  const captureVideoRef = useRef(null);
  const readyChartsRef = useRef(new Set());
  const chartReadyWaitRef = useRef(null);

  const refreshStatus = async () => {
    try {
      setStatus(await api("/api/status"));
    } catch (error) {
      setNotice(error.message);
    }
  };

  async function refreshJournal(importBrowserLog = false) {
    let data = await api("/api/journal");
    if (importBrowserLog) {
      const legacyEntries = loadTradeLog();
      if (!data.trades.length && legacyEntries.length) {
        data = await api("/api/journal/import-legacy", {
          method: "POST",
          body: JSON.stringify({ trades: legacyEntries }),
        });
      }
      try { localStorage.removeItem(TRADE_LOG_KEY); } catch { /* The SQLite copy remains the source of truth. */ }
    }
    setTradeLog(Array.isArray(data.trades) ? data.trades : []);
    setJournalDays(Array.isArray(data.days) ? data.days : []);
    setTradeMemories(Array.isArray(data.memories) ? data.memories : []);
    return data;
  }

  async function saveAnalysisPlan(plan, message) {
    if (plan?.status !== "setup" || !["long", "short"].includes(plan.side) || ![plan.entry, plan.stopLoss, plan.takeProfit].every(Number.isFinite)) {
      throw new Error("Phân tích này chưa có đủ Entry, SL và TP để ghi vào sổ.");
    }
    const existing = tradeLog.find((trade) => trade.planId === message.id);
    if (existing) return existing;
    const entry = planTradeEntry(plan, message);
    const result = await api("/api/journal/trades", { method: "POST", body: JSON.stringify(entry) });
    await refreshJournal();
    return result.trade;
  }

  async function trackAnalysisPlan(plan, message) {
    try {
      const trade = await saveAnalysisPlan(plan, message);
      const stateLabel = trade.status === "closed" ? "đã ghi kết quả thực tế" : trade.status === "target_hit" ? "chart đã chạm TP" : trade.status === "stop_hit" ? "chart đã chạm SL" : "đang theo dõi";
      setNotice(`Đã ghi ${trade.symbol} ${trade.side.toUpperCase()} vào Sổ giao dịch · ${stateLabel}.`);
    } catch (error) {
      setNotice(`Không ghi được kế hoạch: ${error.message}`);
    }
  }

  async function saveJournalTrade(trade) {
    const isUpdate = Boolean(trade.id);
    const path = isUpdate ? `/api/journal/trades/${encodeURIComponent(trade.id)}` : "/api/journal/trades";
    await api(path, { method: isUpdate ? "PUT" : "POST", body: JSON.stringify(trade) });
    await refreshJournal();
  }

  async function removeJournalTrade(id) {
    await api(`/api/journal/trades/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshJournal();
  }

  async function saveJournalDay(date, note) {
    await api(`/api/journal/days/${encodeURIComponent(date)}`, { method: "PUT", body: JSON.stringify({ note }) });
    await refreshJournal();
  }

  async function runTradeReview(id) {
    await api(`/api/journal/trades/${encodeURIComponent(id)}/review`, { method: "POST", body: "{}" });
    await refreshJournal();
  }

  async function saveMemory(id, update) {
    await api(`/api/journal/memories/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(update) });
    await refreshJournal();
  }

  async function removeTradeMemory(id) {
    await api(`/api/journal/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshJournal();
  }

  useEffect(() => {
    refreshStatus();
    const timer = window.setInterval(refreshStatus, 7000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    refreshJournal(true).catch((error) => setNotice(`Không tải được sổ giao dịch: ${error.message}`));
  }, []);

  useEffect(() => {
    const lastChartResultId = [...messages].reverse().find((message) => message.role === "assistant" && message.chartImage)?.id;
    const saved = messages.slice(-80).map(({ imagePreview, imagePreviews, annotatedImage, chartImage, ...message }) => ({
      ...message,
      ...(message.id === lastChartResultId && chartImage ? { chartImage } : {}),
    }));
    try {
      localStorage.setItem(MESSAGE_KEY, JSON.stringify(saved));
    } catch {
      try { localStorage.setItem(MESSAGE_KEY, JSON.stringify(saved.map(({ chartImage, ...message }) => message))); } catch { /* Keep the in-memory conversation when browser storage is full. */ }
    }
    const latestMessage = messages.at(-1);
    if (latestMessage?.role === "assistant" && latestMessage.id !== INITIAL_MESSAGE.id) {
      analysisResultsEndRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages]);

  useEffect(() => () => {
    captureStreamRef.current?.getTracks().forEach((track) => track.stop());
    captureVideoRef.current?.remove();
  }, []);

  async function connectCodex() {
    setNotice("");
    try {
      const result = await api("/api/auth/login", { method: "POST", body: "{}" });
      setLoginUrl(result.authUrl || result.verificationUrl || "");
      if (result.authUrl) setNotice("Đã tạo liên kết đăng nhập. Mở liên kết bên dưới để tiếp tục.");
    } catch (error) {
      setNotice(error.message);
    }
  }

  function stopCapture() {
    captureStreamRef.current?.getTracks().forEach((track) => track.stop());
    captureStreamRef.current = null;
    captureVideoRef.current?.remove();
    captureVideoRef.current = null;
    setCaptureActive(false);
  }

  function clearChartReadiness() {
    readyChartsRef.current.clear();
    setReadyCharts([]);
  }

  function markChartReady(readyInterval) {
    const key = chartReadyKey(symbol, readyInterval);
    readyChartsRef.current.add(key);
    setReadyCharts((current) => current.includes(key) ? current : [...current, key]);
    const waiter = chartReadyWaitRef.current;
    if (waiter && waiter.keys.every((requiredKey) => readyChartsRef.current.has(requiredKey))) {
      window.clearTimeout(waiter.timer);
      chartReadyWaitRef.current = null;
      waiter.resolve();
    }
  }

  function waitForChartsReady(intervalsToWait, symbolToWait) {
    const keys = intervalsToWait.map((value) => chartReadyKey(symbolToWait, value));
    if (keys.every((key) => readyChartsRef.current.has(key))) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        chartReadyWaitRef.current = null;
        reject(new Error("Một số chart chưa tải xong. Đợi đến khi các ô hiển thị dữ liệu rồi gửi lại."));
      }, 60000);
      chartReadyWaitRef.current = { keys, timer, resolve };
    });
  }

  async function waitForRenderedCharts(video, intervalsToWait, multipleCharts) {
    const deadline = Date.now() + 90000;
    const readySamples = intervalsToWait.map(() => 0);
    const sampleCanvas = document.createElement("canvas");
    const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
    if (!sampleContext) throw new Error("Không kiểm tra được nội dung chart trước khi chụp.");

    while (Date.now() < deadline) {
      await waitForVideoFrame(video);
      const chartFrame = chartFrameRef.current;
      const frames = multipleCharts
        ? [...(chartFrame?.querySelectorAll(".multi-chart-tile .chart-embed iframe") || [])]
        : [chartFrame?.querySelector(".chart-embed iframe")].filter(Boolean);

      if (frames.length === intervalsToWait.length) {
        frames.forEach((frame, index) => {
          readySamples[index] = hasRenderedCandles(video, frame, sampleCanvas, sampleContext)
            ? readySamples[index] + 1
            : 0;
        });
        if (readySamples.every((samples) => samples >= 2)) return;
      } else {
        readySamples.fill(0);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 450));
    }

    const labels = intervalsToWait.map((value) => CHART_TIMEFRAME_BY_VALUE[value]?.label || value).join(", ");
    throw new Error(`Chart ${labels} chưa hiển thị nến sau khi tải. Đợi đến khi thấy nến trong từng ô rồi thử lại.`);
  }

  function applySymbol(event) {
    event?.preventDefault();
    const nextSymbol = symbolDraft.trim().toUpperCase();
    if (nextSymbol.length > 64 || !SYMBOL_PATTERN.test(nextSymbol)) {
      setNotice("Nhập symbol theo định dạng EXCHANGE:SYMBOL, ví dụ OANDA:XAUUSD hoặc FX:EURUSD.");
      return;
    }
    setSymbolDraft(nextSymbol);
    if (nextSymbol === symbol) return;
    clearChartReadiness();
    setSymbol(nextSymbol);
    setNotice("");
    try { localStorage.setItem(SYMBOL_KEY, nextSymbol); } catch { /* Continue if browser storage is unavailable. */ }
  }

  function changeChartMode() {
    clearChartReadiness();
    setChartMode((mode) => mode === "single" ? "multi" : "single");
  }

  function changeInterval(nextInterval) {
    if (nextInterval === interval) return;
    clearChartReadiness();
    setInterval(nextInterval);
  }

  function changeMultiPreset(nextPreset) {
    if (nextPreset === multiPreset) return;
    clearChartReadiness();
    setMultiPreset(nextPreset);
  }

  async function clearHistory() {
    if (busy) return;
    try {
      await api("/api/chat/clear", { method: "POST", body: "{}" });
      setMessages([INITIAL_MESSAGE]);
      setDraft("");
      setNotice("");
    } catch (error) {
      setNotice(`Không xóa được lịch sử chat: ${error.message}`);
    }
  }

  async function recordTradeResult(plan, resultPercent, message) {
    const roundedResult = Math.round((resultPercent + Number.EPSILON) * 100) / 100;
    const existing = tradeLog.find((item) => item.planId === message.id);
    const entry = {
      ...(existing || {}),
      id: existing?.id || crypto.randomUUID(),
      planId: message.id,
      timestamp: Date.now(),
      date: localDateKey(),
      symbol: message.market?.symbol || symbol,
      side: plan.side,
      style: plan.style || "day_trade",
      orderType: plan.orderType || "limit",
      entry: plan.entry,
      stopLoss: plan.stopLoss,
      takeProfit: plan.takeProfit,
      pnlPercent: roundedResult,
      pnlCurrency: "USD",
      status: "closed",
      thesis: existing?.thesis || "",
      notes: existing?.notes || "",
      planRationale: plan.rationale || "",
      planTrigger: plan.trigger || "",
      planInvalidation: plan.invalidation || "",
      originalAnalysis: message.text || "",
    };
    try {
      await api(existing ? `/api/journal/trades/${encodeURIComponent(existing.id)}` : "/api/journal/trades", {
        method: existing ? "PUT" : "POST",
        body: JSON.stringify(entry),
      });
      await refreshJournal();
      setNotice(`Đã lưu lệnh ${entry.symbol} · ${formatPercent(roundedResult)} vào sổ giao dịch.`);
    } catch (error) {
      setNotice(`Không lưu được lệnh: ${error.message}`);
    }
  }

  async function deleteTradeResult(entryId) {
    try {
      await removeJournalTrade(entryId);
      setNotice("Đã xóa lệnh khỏi sổ giao dịch.");
    } catch (error) {
      setNotice(`Không xóa được lệnh: ${error.message}`);
    }
  }

  async function ensureCaptureVideo() {
    let stream = captureStreamRef.current;
    if (!stream || stream.getVideoTracks().every((track) => track.readyState !== "live")) {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("Trình duyệt này chưa hỗ trợ chụp tab. Hãy mở app bằng Chrome hoặc Edge.");
      }
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
      });
      const track = stream.getVideoTracks()[0];
      const surface = track?.getSettings().displaySurface;
      if (!track || surface !== "browser") {
        stream.getTracks().forEach((item) => item.stop());
        throw new Error("Hãy dùng Chrome hoặc Edge và chọn chia sẻ tab trình duyệt CoinAnalyst để app tự cắt chart.");
      }

      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      Object.assign(video.style, { position: "fixed", left: "-2px", top: "-2px", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" });
      document.body.appendChild(video);
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        stream.getTracks().forEach((item) => item.stop());
        video.remove();
        throw new Error("Không mở được luồng tab. Hãy cho phép chia sẻ tab trình duyệt rồi thử lại.");
      }
      captureStreamRef.current = stream;
      captureVideoRef.current = video;
      setCaptureActive(true);
      track.addEventListener("ended", () => {
        if (captureStreamRef.current !== stream) return;
        captureStreamRef.current = null;
        captureVideoRef.current?.remove();
        captureVideoRef.current = null;
        setCaptureActive(false);
      }, { once: true });
    }

    const video = captureVideoRef.current;
    if (!video) throw new Error("Không tìm thấy luồng chụp tab.");
    return video;
  }

  async function captureVisibleChart(video) {
    const chart = chartFrameRef.current;
    if (!chart) throw new Error("Không tìm thấy chart trên trang.");
    const oldScrollX = window.scrollX;
    const oldScrollY = window.scrollY;
    let restoreScroll = false;
    try {
      let rect = chart.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight || rect.left < 0 || rect.right > window.innerWidth) {
        chart.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
        restoreScroll = true;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        rect = chart.getBoundingClientRect();
      }

      await waitForVideoFrame(video);
      const scaleX = video.videoWidth / window.innerWidth;
      const scaleY = video.videoHeight / window.innerHeight;
      const left = Math.max(0, Math.floor(rect.left * scaleX));
      const top = Math.max(0, Math.floor(rect.top * scaleY));
      const right = Math.min(video.videoWidth, Math.ceil(rect.right * scaleX));
      const bottom = Math.min(video.videoHeight, Math.ceil(rect.bottom * scaleY));
      if (!video.videoWidth || !video.videoHeight || right <= left || bottom <= top) {
        throw new Error("Không lấy được khung chart. Chọn đúng tab CoinAnalyst rồi thử lại.");
      }

      const canvas = document.createElement("canvas");
      canvas.width = right - left;
      canvas.height = bottom - top;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Không tạo được ảnh chart trên trình duyệt.");
      context.drawImage(video, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error("Không mã hóa được ảnh chart.");
      return await readAsDataUrl(blob);
    } finally {
      if (restoreScroll) window.scrollTo(oldScrollX, oldScrollY);
    }
  }

  async function captureChartImages() {
    const video = await ensureCaptureVideo();
    const intervalsToCapture = chartMode === "multi" ? activeMultiTimeframes.map((frame) => frame.value) : [interval];
    setAnalysisPhase("waiting-charts");
    await waitForChartsReady(intervalsToCapture, symbol);
    await waitForRenderedCharts(video, intervalsToCapture, chartMode === "multi");

    setAnalysisPhase("capture");
    return [await captureVisibleChart(video)];
  }

  async function checkTrackedTrade(trade) {
    if (busy) throw new Error("CoinAnalyst đang xử lý lượt khác. Hãy đợi xong rồi kiểm tra.");
    if (!status?.codex?.authenticated) throw new Error("Hãy kết nối tài khoản Codex trước khi kiểm tra chart.");
    const originalWorkspace = { activeView, chartMode, multiPreset, interval, symbol, symbolDraft };
    setBusy(true);
    setAnalysisPhase("capture");
    try {
      const video = await ensureCaptureVideo();
      clearChartReadiness();
      setActiveView("analysis");
      setChartMode("single");
      setMultiPreset("trade");
      setInterval("15m");
      setSymbol(trade.symbol);
      setSymbolDraft(trade.symbol);
      setChartCaptureGeneration((generation) => generation + 1);
      try { localStorage.setItem(SYMBOL_KEY, trade.symbol); } catch { /* Keep this check in memory if local storage is unavailable. */ }
      setAnalysisPhase("waiting-execution");
      await waitForChartsReady(["15m"], trade.symbol);
      await waitForRenderedCharts(video, ["15m"], false);
      setAnalysisPhase("capture");
      const imageDataUrl = await captureVisibleChart(video);
      setAnalysisPhase("analysis");
      const response = await api(`/api/journal/trades/${encodeURIComponent(trade.id)}/check`, {
        method: "POST",
        body: JSON.stringify({ imageDataUrl }),
      });
      await refreshJournal();
      return response;
    } finally {
      clearChartReadiness();
      setActiveView(originalWorkspace.activeView);
      setChartMode(originalWorkspace.chartMode);
      setMultiPreset(originalWorkspace.multiPreset);
      setInterval(originalWorkspace.interval);
      setSymbol(originalWorkspace.symbol);
      setSymbolDraft(originalWorkspace.symbolDraft);
      setChartCaptureGeneration((generation) => generation + 1);
      try { localStorage.setItem(SYMBOL_KEY, originalWorkspace.symbol); } catch { /* Keep the prior chart selection in memory. */ }
      setAnalysisPhase("");
      setBusy(false);
    }
  }

  async function capturePresetForQuickAnalysis(presetKey, video) {
    const preset = MULTI_PRESETS.find((item) => item.key === presetKey);
    if (!preset) throw new Error("Không tìm thấy bộ timeframe để phân tích.");
    clearChartReadiness();
    setChartMode("multi");
    setMultiPreset(preset.key);
    setChartCaptureGeneration((generation) => generation + 1);
    setAnalysisPhase(`waiting-${preset.key}`);
    await waitForChartsReady(preset.timeframes, symbol);
    await waitForRenderedCharts(video, preset.timeframes, true);
    setAnalysisPhase("capture");
    return await captureVisibleChart(video);
  }

  async function captureExecutionChartForQuickAnalysis(video) {
    clearChartReadiness();
    setChartMode("single");
    setInterval("15m");
    setChartCaptureGeneration((generation) => generation + 1);
    setAnalysisPhase("waiting-execution");
    await waitForChartsReady(["15m"], symbol);
    await waitForRenderedCharts(video, ["15m"], false);
    setAnalysisPhase("capture");
    return await captureVisibleChart(video);
  }

  async function sendMessage(event) {
    event?.preventDefault();
    if (busy) return;
    const text = draft.trim();
    if (!text) return;
    if (/(kiểm tra|check|cập nhật).*(lệnh|giá|tp|sl|chart)/i.test(text)) {
      const openTrades = tradeLog.filter((trade) => ["tracking", "open"].includes(trade.status));
      const upperText = text.toUpperCase();
      const mentionedTrades = openTrades.filter((trade) => upperText.includes(trade.symbol.toUpperCase()) || upperText.includes(trade.symbol.split(":").at(-1).toUpperCase()));
      const candidates = mentionedTrades.length ? mentionedTrades : openTrades;
      setDraft("");
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text }]);
      if (candidates.length !== 1) {
        const responseText = candidates.length
          ? `Có ${candidates.length} kế hoạch đang theo dõi. Hãy mở Sổ giao dịch và bấm “Kiểm tra chart mới” ở đúng lệnh cần đối chiếu.`
          : "Chưa có kế hoạch nào đang theo dõi. Chạy Quick phân tích trước hoặc ghi một plan vào Sổ giao dịch.";
        setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: responseText }]);
        return;
      }
      try {
        const { check } = await checkTrackedTrade(candidates[0]);
        const resultText = check.result === "target_hit" ? "Chart cho thấy đã chạm TP"
          : check.result === "stop_hit" ? "Chart cho thấy đã chạm SL"
            : check.result === "entry_pending" ? "Entry limit vẫn đang chờ"
              : check.result === "open" ? "Entry đã chạm trên chart; chưa thấy xác nhận TP/SL"
                : "Ảnh chart chưa đủ rõ để kết luận; giữ nguyên trạng thái";
        const priceText = Number.isFinite(check.latestPrice) ? ` Giá đọc từ ảnh khoảng ${formatPrice(check.latestPrice)}.` : "";
        setMessages((current) => [...current, {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `${resultText}.${priceText} ${check.evidence || ""} Đây là kiểm tra bằng ảnh, không xác nhận khớp lệnh broker hoặc PnL tài khoản.`,
        }]);
      } catch (error) {
        setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: `Không kiểm tra được chart: ${error.message}` }]);
      }
      return;
    }
    if (/(ghi lại|lưu lại|lưu lệnh|ghi lệnh|theo dõi lệnh|ghi vào sổ|lưu vào sổ)/i.test(text)) {
      const sourceMessage = [...messages].reverse().find((message) => message.role === "assistant" && message.plan?.status === "setup");
      if (sourceMessage) {
        setDraft("");
        setBusy(true);
        setMessages((current) => [...current,
          { id: crypto.randomUUID(), role: "user", text },
          { id: crypto.randomUUID(), role: "assistant", text: "Đang ghi kế hoạch gần nhất vào sổ giao dịch…" },
        ]);
        try {
          const entry = await saveAnalysisPlan(sourceMessage.plan, sourceMessage);
          setMessages((current) => [...current, {
            id: crypto.randomUUID(),
            role: "assistant",
            text: `Đã ghi ${entry.symbol} ${entry.side.toUpperCase()} vào sổ. Trạng thái: ${entry.status === "closed" ? "đã ghi kết quả thực tế" : entry.status === "target_hit" ? "chart đã chạm TP" : entry.status === "stop_hit" ? "chart đã chạm SL" : "đang theo dõi"}. Đây là kế hoạch trên chart, chưa xác nhận lệnh broker đã khớp. Mở tab “Sổ giao dịch” rồi bấm “Kiểm tra chart mới” để đối chiếu TP/SL.`,
          }]);
        } catch (error) {
          setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: `Không ghi được kế hoạch: ${error.message}` }]);
        } finally {
          setBusy(false);
        }
        return;
      }
    }
    if (!status?.codex?.authenticated) {
      setNotice("Hãy kết nối tài khoản Codex trước khi gửi câu hỏi.");
      return;
    }

    setDraft("");
    setBusy(true);
    setAnalysisPhase("capture");
    setNotice("");
    try {
      const imageDataUrls = await captureChartImages();
      setAnalysisPhase("analysis");
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "user",
        text,
        hasImage: true,
        ...(imageDataUrls.length > 1 ? { imagePreviews: imageDataUrls } : { imagePreview: imageDataUrls[0] }),
      }]);
      const intervals = chartMode === "multi" ? activeMultiTimeframes.map((frame) => frame.value) : [interval];
      const result = await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, symbol, interval, intervals, imageDataUrls }),
      });
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        text: result.answer,
        market: result.market,
        chartImage: imageDataUrls[0],
      }]);
    } catch (error) {
      setDraft(text);
      setNotice(error.message);
    } finally {
      setAnalysisPhase("");
      setBusy(false);
    }
  }

  async function quickAnalyze() {
    if (busy) return;
    if (!status?.codex?.authenticated) {
      setNotice("Hãy kết nối tài khoản Codex trước khi chạy quick analysis.");
      return;
    }

    const originalWorkspace = { chartMode, multiPreset, interval };
    let captureWorkspaceChanged = false;
    function restoreWorkspace() {
      if (!captureWorkspaceChanged) return;
      clearChartReadiness();
      setChartMode(originalWorkspace.chartMode);
      setMultiPreset(originalWorkspace.multiPreset);
      setInterval(originalWorkspace.interval);
      setChartCaptureGeneration((generation) => generation + 1);
      captureWorkspaceChanged = false;
    }

    setBusy(true);
    setAnalysisPhase("capture");
    setNotice("");
    try {
      const video = await ensureCaptureVideo();
      captureWorkspaceChanged = true;
      const biasImage = await capturePresetForQuickAnalysis("bias", video);
      const tradeImage = await capturePresetForQuickAnalysis("trade", video);
      const entryImage = await capturePresetForQuickAnalysis("entry", video);
      const executionImage = await captureExecutionChartForQuickAnalysis(video);
      restoreWorkspace();

      const imageDataUrls = [biasImage, tradeImage, entryImage, executionImage];
      const imageLabels = ["BIAS · H4 · D · W · M", "TRADE · D · H4 · H1 · 15m", "ENTRY · 15m · 5m · 3m · 1m", "EXECUTION · 15m"];
      const question = "Phân tích Bias, Trade và Entry theo framework ICT/SMC, đối chiếu headline tin tức mới nhất rồi chọn một kịch bản tốt nhất theo scalp, day trade hoặc swing. Luôn dự đoán một lệnh có Entry, SL, TP; nếu thị trường nhiễu hãy đưa ra lệnh có điều kiện và ghi rõ trigger, không trả NO TRADE chỉ vì tín hiệu chưa hoàn hảo. Nêu các xác nhận nhìn thấy, điểm còn thiếu, confidence thực tế và điều kiện vô hiệu.";
      setAnalysisPhase("analysis");
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "user",
        text: "Quick phân tích · ICT/SMC + tin tức",
        hasImage: true,
        quickAnalysis: true,
        imagePreviews: imageDataUrls,
        imageLabels,
      }]);

      const result = await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({ quickAnalysis: true, message: question, symbol, imageDataUrls }),
      });
      const assistantMessage = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        role: "assistant",
        text: result.answer,
        market: result.market,
        quickAnalysis: true,
        plan: result.plan || null,
        news: result.news || null,
        chartImage: executionImage,
      };
      setMessages((current) => [...current, assistantMessage]);
      if (!result.plan) {
        setNotice("AI chưa trả đủ mức Entry/SL/TP. Bạn có thể hỏi tiếp để làm rõ kế hoạch.");
      }
    } catch (error) {
      setNotice(error.message);
    } finally {
      restoreWorkspace();
      setAnalysisPhase("");
      setBusy(false);
    }
  }

  const codexReady = status?.codex?.authenticated;
  const activeMultiPreset = MULTI_PRESETS.find((preset) => preset.key === multiPreset) || MULTI_PRESETS[1];
  const activeMultiTimeframes = activeMultiPreset.timeframes.map((value) => CHART_TIMEFRAME_BY_VALUE[value]);
  const completedAnalyses = messages.filter((message) => message.role === "assistant" && message.id !== INITIAL_MESSAGE.id).reverse();
  const latestAnalysis = completedAnalyses[0] || null;
  const previousAnalyses = completedAnalyses.slice(1);
  const symbolParts = symbol.split(":");
  const exchange = symbolParts[0] || "TRADINGVIEW";
  const instrumentCode = symbolParts.at(-1) || symbol;
  const isGoldSymbol = instrumentCode === "XAUUSD";

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="CoinAnalyst home" onClick={(event) => { event.preventDefault(); setActiveView("analysis"); }}>
          <span className="brand-mark">C</span>
          <span className="brand-word">Coin<span>Analyst</span></span>
        </a>
        <nav className="topbar-nav" aria-label="Điều hướng chính">
          <button type="button" className={activeView === "analysis" ? "active" : ""} aria-current={activeView === "analysis" ? "page" : undefined} onClick={() => setActiveView("analysis")}>Phân tích</button>
          <button type="button" className={activeView === "journal" ? "active" : ""} aria-current={activeView === "journal" ? "page" : undefined} onClick={() => setActiveView("journal")}>Sổ giao dịch</button>
        </nav>
        <div className="topbar-right">
          {codexReady ? (
            <span className="connection-state connected"><span className="state-dot" /> CODEX CONNECTED</span>
          ) : (
            <button className="connect-button" onClick={connectCodex}><Icon name="spark" size={15} /> Kết nối Codex</button>
          )}
          <div className="avatar">P</div>
        </div>
      </header>

      {activeView === "analysis" && <>
      <main className={chartMode === "multi" ? "workspace workspace-multi" : "workspace"} id="top">
        <section className="market-column" aria-label={`Biểu đồ ${symbol}`}>
          <div className="instrument-header">
            <div className="instrument-title-wrap">
              <div className="instrument-badge">{isGoldSymbol ? "Au" : instrumentCode.slice(0, 2)}</div>
              <div>
                <div className="instrument-overline">{exchange} · TRADINGVIEW</div>
                <h1>{isGoldSymbol ? <>Gold <span>/</span> U.S. Dollar</> : instrumentCode}</h1>
              </div>
              <span className="ticker-symbol">{symbol}</span>
            </div>
            <form className="symbol-form" onSubmit={applySymbol}>
              <label className="sr-only" htmlFor="tradingview-symbol">TradingView symbol, định dạng sàn và mã</label>
              <input id="tradingview-symbol" list="tradingview-symbol-examples" value={symbolDraft} onChange={(event) => setSymbolDraft(event.target.value)} placeholder="EXCHANGE:SYMBOL" title="Nhập mã TradingView dạng EXCHANGE:SYMBOL" disabled={busy} />
              <datalist id="tradingview-symbol-examples">
                <option value="OANDA:XAUUSD" /><option value="OANDA:XAGUSD" /><option value="FX:EURUSD" />
                <option value="FX:GBPUSD" /><option value="BINANCE:BTCUSDT" /><option value="NASDAQ:AAPL" />
              </datalist>
              <button type="submit" disabled={busy}>Áp dụng</button>
            </form>
          </div>

          <div className={chartMode === "multi" ? "market-toolbar multi-market-toolbar" : "market-toolbar"}>
            {chartMode === "single" ? <div className="timeframes" aria-label="Khung thời gian">
              {SINGLE_TIMEFRAMES.map((frame) => (
                <button key={frame.value} className={interval === frame.value ? "timeframe active" : "timeframe"} onClick={() => changeInterval(frame.value)} disabled={busy}>
                  {frame.label}
                </button>
              ))}
            </div> : <>
              <div className="multi-presets" role="group" aria-label="Bộ timeframe 4 chart">
                {MULTI_PRESETS.map((preset) => <button key={preset.key} className={multiPreset === preset.key ? "multi-preset-button active" : "multi-preset-button"} type="button" title={preset.summary} aria-pressed={multiPreset === preset.key} onClick={() => changeMultiPreset(preset.key)} disabled={busy}>{preset.label}</button>)}
              </div>
              <div className="multi-timeframe-hint">{activeMultiPreset.summary}</div>
            </>}
            <button className="chart-mode-toggle" onClick={changeChartMode} title={chartMode === "single" ? "Hiện 4 timeframe cùng lúc" : "Quay lại một chart"} disabled={busy}>
              {chartMode === "single" ? "4 chart" : "1 chart"}
            </button>
            <div className="toolbar-separator" />
            <div className="feed-status"><Icon name="chart" size={15} /><span>TradingView embed</span></div>
            <span className="feed-source">{symbol}</span>
          </div>

          <div className={chartMode === "multi" ? "chart-frame multi-chart-frame" : "chart-frame"} ref={chartFrameRef}>
            {chartMode === "single" ? <TradingViewChart key={`${symbol}:${interval}:${chartCaptureGeneration}`} interval={interval} symbol={symbol} onReady={markChartReady} /> : <div className="multi-chart-grid">
              {activeMultiTimeframes.map((frame) => <div className="multi-chart-tile" key={`${multiPreset}:${frame.value}:${chartCaptureGeneration}`}>
                <div className="multi-chart-label"><span>{instrumentCode} · {frame.label}</span><span className={readyCharts.includes(chartReadyKey(symbol, frame.value)) ? "chart-load-state ready" : "chart-load-state"}>{readyCharts.includes(chartReadyKey(symbol, frame.value)) ? "READY" : "LOADING"}</span></div>
                <TradingViewChart interval={frame.value} symbol={symbol} onReady={markChartReady} />
              </div>)}
            </div>}
            {chartMode === "single" && <div className="chart-credit">Biểu đồ nhúng bởi TradingView</div>}
          </div>

          <div className="market-footer">
            <div className="legend"><span className="legend-mark" /> <strong>{symbol}</strong><span>{isGoldSymbol ? "Gold Spot / U.S. Dollar" : "TradingView instrument"}</span></div>
            <div className="footer-right"><span>CHART: TRADINGVIEW</span><span className="footer-divider" /> <span>AI: SCREENSHOT</span></div>
          </div>

          <div className="data-note"><Icon name="lock" size={14} /> {chartMode === "multi" ? "Chỉ chụp lưới 4 timeframe sau khi nến đã hiển thị trong từng ô." : "App đợi nến hiển thị rồi tự chụp vùng chart từ tab trình duyệt được bạn cho phép chia sẻ."}</div>
        </section>

        <aside className="chat-panel" aria-label="AI market analysis">
          <div className="chat-heading">
            <div className="chat-heading-icon"><Icon name="spark" size={18} /></div>
            <div className="chat-heading-copy">
              <h2>CoinAnalyst AI</h2>
              <p>Phân tích ảnh chart cùng Codex</p>
            </div>
            <div className="chat-heading-actions">
              <button className="icon-button" title="Xóa lịch sử chat" aria-label="Xóa lịch sử chat" onClick={clearHistory} disabled={busy}><Icon name="trash" size={16} /></button>
              <button className="icon-button" title="Làm mới trạng thái" aria-label="Làm mới trạng thái" onClick={refreshStatus}><Icon name="refresh" size={17} /></button>
            </div>
          </div>

          <div className="connection-cards">
            <div className={codexReady ? "connection-card ready" : "connection-card"}>
              <span className="card-icon"><Icon name="spark" size={15} /></span>
              <span className="card-copy"><strong>Codex</strong><small>{codexReady ? (status.codex.email || "Đã đăng nhập") : "Chưa kết nối"}</small></span>
              <span className={codexReady ? "card-state ok" : "card-state"}>{codexReady ? "ON" : "OFF"}</span>
            </div>
            <div className={captureActive ? "connection-card ready" : "connection-card"}>
              <span className="card-icon screenshot-icon"><Icon name="image" size={15} /></span>
              <span className="card-copy"><strong>Chụp chart tự động</strong><small>{captureActive ? "Đã cho phép chia sẻ tab" : "Cho phép khi gửi lần đầu"}</small></span>
              <span className={captureActive ? "card-state ok" : "card-state"}>{captureActive ? "ON" : "—"}</span>
            </div>
          </div>

          {!codexReady && status?.codex?.available && (
            <div className="setup-banner">
              <span className="setup-number">01</span>
              <div><strong>Kết nối tài khoản Codex</strong><p>Đăng nhập bằng ChatGPT. Hạn mức sử dụng theo gói tài khoản.</p>
                {loginUrl ? <a className="setup-link" href={loginUrl} target="_blank" rel="noreferrer">Mở trang đăng nhập <Icon name="arrow" size={13} /></a> : <button className="setup-link button-link" onClick={connectCodex}>Tạo liên kết đăng nhập <Icon name="arrow" size={13} /></button>}
              </div>
            </div>
          )}
          {status?.codex && !status.codex.available && (
            <div className="setup-banner warning-banner">
              <span className="setup-number">!</span><div><strong>Không mở được Codex</strong><p>{status.codex.error || "Kiểm tra Codex CLI đã cài và có trong PATH."}</p></div>
            </div>
          )}
          <div className="chat-section-label"><span>CONVERSATION</span><span className="conversation-line" /></div>
          <div className="messages" aria-live="polite">
            {messages.filter((message) => message.role === "user" || message.id === INITIAL_MESSAGE.id).map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                {message.role === "assistant" && <div className="assistant-mark"><Icon name="spark" size={14} /></div>}
                <div className="message-body">
                  <div className="message-author">{message.role === "assistant" ? (message.quickAnalysis ? "CODEX · QUICK TRADE PLAN" : "CODEX · CHART ANALYSIS") : (message.quickAnalysis ? "YOU · QUICK ANALYSIS" : "YOU")}</div>
                  {message.imagePreviews?.length ? <div className="message-images">{message.imagePreviews.map((image, imageIndex) => <figure className="message-image-figure" key={imageIndex}><img className="message-image" src={image} alt={`Ảnh chart ${imageIndex + 1} gửi để phân tích`} />{message.imageLabels?.[imageIndex] && <figcaption>{message.imageLabels[imageIndex]}</figcaption>}</figure>)}</div> : message.imagePreview && <img className="message-image" src={message.imagePreview} alt="Ảnh chart được gửi để phân tích" />}
                  {message.hasImage && !message.imagePreview && !message.imagePreviews?.length && <div className="message-attachment"><Icon name="image" size={13} /> Đã gửi ảnh chart</div>}
                  <div className="message-text">{message.role === "assistant" ? <MarkdownMessage text={message.text} /> : message.text}</div>
                  {message.plan && <QuickPlanCard plan={message.plan} tradeEntry={tradeLog.find((entry) => entry.planId === message.id)} onTrackPlan={() => trackAnalysisPlan(message.plan, message)} onRecordTrade={(pnlPercent) => recordTradeResult(message.plan, pnlPercent, message)} />}
                  {message.market && <div className="message-meta">{message.market.source} · {message.market.symbol} · {message.market.intervalLabel}</div>}
                </div>
              </article>
            ))}
            {busy && <article className="message assistant"><div className="assistant-mark"><Icon name="spark" size={14} /></div><div className="message-body"><div className="message-author">{analysisPhase === "analysis" ? "CODEX · ĐANG PHÂN TÍCH BIAS, TRADE VÀ ENTRY" : analysisPhase === "waiting-bias" ? "ĐANG ĐỢI CHART BIAS H4 · D · W · M" : analysisPhase === "waiting-trade" ? "ĐANG ĐỢI CHART TRADE D · H4 · H1 · 15m" : analysisPhase === "waiting-entry" ? "ĐANG ĐỢI CHART ENTRY 15m · 5m · 3m · 1m" : analysisPhase === "waiting-execution" ? "ĐANG ĐỢI CHART 15m ĐỂ CHỤP ẢNH GỐC" : analysisPhase === "waiting-charts" ? "ĐANG ĐỢI NẾN HIỂN THỊ TRÊN TẤT CẢ CHART" : analysisPhase === "capture" ? (captureActive ? "ĐANG CHỤP CHART" : "MỞ HỘP THOẠI VÀ CHỌN TAB COINANALYST") : "ĐANG XỬ LÝ"}</div><div className="thinking"><span /><span /><span /></div></div></article>}
            <div ref={chatEndRef} />
          </div>

          {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Đóng"><Icon name="close" size={14} /></button></div>}

          <form className="composer" onSubmit={sendMessage}>
            <label className="sr-only" htmlFor="message-input">Hỏi về biểu đồ {symbol}</label>
            <textarea id="message-input" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(event); } }} placeholder="Hỏi về xu hướng, vùng giá, kịch bản..." maxLength={2000} rows={2} disabled={busy} />
            <div className="composer-bottom">
              <div className="composer-actions">
                {captureActive ? (
                  <button className="attach-button capture-active" type="button" onClick={stopCapture} disabled={busy}><Icon name="image" size={14} /> Dừng chia sẻ</button>
                ) : (
                  <span className="capture-hint"><Icon name="image" size={14} /> Chụp tự động khi gửi</span>
                )}
                <span className="composer-context">{chartMode === "multi" ? `${instrumentCode} · ${activeMultiPreset.summary}` : `${SINGLE_TIMEFRAMES.find((frame) => frame.value === interval)?.label} · ${instrumentCode}`}</span>
              </div>
              <div className="composer-submit-actions">
                <button className="quick-analysis-button" type="button" onClick={quickAnalyze} disabled={busy} title="Chọn kịch bản scalp, day trade hoặc swing; ghi kết quả để theo dõi P&L ngày"><Icon name="spark" size={14} /> Quick phân tích</button>
                <button className="send-button" type="submit" disabled={busy || !draft.trim()} aria-label="Gửi câu hỏi"><Icon name="send" size={16} /></button>
              </div>
            </div>
          </form>
          <div className="chat-disclaimer">Ảnh chỉ gửi cùng câu hỏi của bạn. Codex dùng hạn mức tài khoản ChatGPT/Codex.</div>
        </aside>
      </main>
      {latestAnalysis && <section className="analysis-results" aria-label="Kết quả phân tích mới nhất">
        <div className="analysis-results-heading">
          <div><span>KẾT QUẢ MỚI NHẤT</span><h2>Phân tích thị trường</h2></div>
          {previousAnalyses.length > 0 && <span className="analysis-results-count">{previousAnalyses.length} kết quả trước đó</span>}
        </div>
        <div className="analysis-current-result" ref={analysisResultsEndRef}>
          <AnalysisResultCard message={latestAnalysis} tradeEntry={tradeLog.find((entry) => entry.planId === latestAnalysis.id)} onTrackPlan={() => trackAnalysisPlan(latestAnalysis.plan, latestAnalysis)} onRecordTrade={(pnlPercent) => recordTradeResult(latestAnalysis.plan, pnlPercent, latestAnalysis)} />
        </div>
        {previousAnalyses.length > 0 && <details className="analysis-results-history">
          <summary>Xem các kết quả trước ({previousAnalyses.length})</summary>
          <div className="analysis-results-list">{previousAnalyses.map((message) => <AnalysisResultCard key={message.id} message={message} tradeEntry={tradeLog.find((entry) => entry.planId === message.id)} onTrackPlan={() => trackAnalysisPlan(message.plan, message)} onRecordTrade={(pnlPercent) => recordTradeResult(message.plan, pnlPercent, message)} />)}</div>
        </details>}
      </section>}
      </>}
      <TradeJournalWorkspace
        open={activeView === "journal"}
        pageMode
        onClose={() => setActiveView("analysis")}
        trades={tradeLog}
        days={journalDays}
        memories={tradeMemories}
        symbol={symbol}
        onSaveTrade={saveJournalTrade}
        onDeleteTrade={deleteTradeResult}
        onCheckTrade={checkTrackedTrade}
        onSaveDay={saveJournalDay}
        onReviewTrade={runTradeReview}
        onUpdateMemory={saveMemory}
        onDeleteMemory={removeTradeMemory}
      />
      <footer className="page-footer"><span>COINANALYST · LOCAL · SCREENSHOT INPUT</span><span>NO OANDA TOKEN · NO TRADINGVIEW MCP</span></footer>
    </div>
  );
}
