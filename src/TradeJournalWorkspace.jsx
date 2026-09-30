import React, { useEffect, useState } from "react";

function dateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateLabel(date) {
  const [year, month, day] = String(date || "").split("-");
  return year && month && day ? `${day}/${month}/${year}` : date;
}

function timeLabel(timestamp) {
  return new Date(timestamp).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function percentLabel(value) {
  if (!Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(2));
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}%`;
}

function moneyLabel(value, currency = "USD") {
  if (!Number.isFinite(value)) return "—";
  return `${value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || "USD"}`;
}

function priceLabel(value) {
  return Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 5 }) : "—";
}

function resultTone(trade) {
  const result = Number.isFinite(trade.pnlAmount) ? trade.pnlAmount : trade.pnlPercent;
  return result > 0 ? "positive" : result < 0 ? "negative" : "flat";
}

function tradeStatusLabel(status) {
  return ({
    tracking: "ĐANG THEO DÕI",
    open: "ENTRY ĐÃ CHẠM · CHART",
    target_hit: "CHẠM TP · CHART",
    stop_hit: "CHẠM SL · CHART",
    closed: "ĐÃ GHI KẾT QUẢ",
    cancelled: "ĐÃ HỦY",
  })[status] || "ĐANG THEO DÕI";
}

function ReviewText({ text }) {
  return <div className="journal-review-markdown">{String(text || "").split("\n").map((line, index) => {
    const heading = line.match(/^#{1,3}\s+(.+)/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)/);
    if (heading) return <strong className="journal-review-heading" key={index}>{heading[1]}</strong>;
    if (bullet) return <p className="journal-review-bullet" key={index}>{bullet[1]}</p>;
    return line.trim() ? <p key={index}>{line}</p> : <span className="journal-review-space" key={index} />;
  })}</div>;
}

export default function TradeJournalWorkspace({
  open,
  pageMode = false,
  onClose,
  trades,
  days,
  memories,
  symbol,
  onSaveTrade,
  onDeleteTrade,
  onCheckTrade,
  onSaveDay,
  onReviewTrade,
  onUpdateMemory,
  onDeleteMemory,
}) {
  const [tab, setTab] = useState("journal");
  const [selectedDate, setSelectedDate] = useState(dateKey());
  const [dailyNote, setDailyNote] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [editingTrade, setEditingTrade] = useState(null);
  const [formError, setFormError] = useState("");
  const [operationError, setOperationError] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [savingTrade, setSavingTrade] = useState(false);
  const [reviewingId, setReviewingId] = useState("");
  const [checkingId, setCheckingId] = useState("");
  const [operationNotice, setOperationNotice] = useState("");
  const [memoryDrafts, setMemoryDrafts] = useState({});

  function confirmDiscardUnsavedNote() {
    return !noteDirty || window.confirm("Ghi chú trong ngày chưa lưu. Bỏ thay đổi và tiếp tục?");
  }

  function closeJournal() {
    if (!confirmDiscardUnsavedNote()) return;
    if (noteDirty) {
      setDailyNote(days.find((day) => day.date === selectedDate)?.note || "");
      setNoteDirty(false);
    }
    onClose();
  }

  useEffect(() => {
    if (!noteDirty) setDailyNote(days.find((day) => day.date === selectedDate)?.note || "");
  }, [days, selectedDate, noteDirty, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => { if (event.key === "Escape") closeJournal(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, noteDirty]);

  if (!open) return null;

  const [year, month] = selectedDate.split("-").map(Number);
  const firstOfMonth = new Date(year, month - 1, 1);
  const monthDays = new Date(year, month, 0).getDate();
  const leadingDays = (firstOfMonth.getDay() + 6) % 7;
  const monthLabel = firstOfMonth.toLocaleDateString("vi-VN", { month: "long", year: "numeric" });
  const selectedTrades = trades.filter((trade) => trade.date === selectedDate).sort((left, right) => left.timestamp - right.timestamp);
  const closedTrades = selectedTrades.filter((trade) => trade.status === "closed");
  const dailyPercent = closedTrades.reduce((total, trade) => total + (trade.pnlPercent ?? 0), 0);
  const dailyMoney = closedTrades.reduce((totals, trade) => {
    if (Number.isFinite(trade.pnlAmount)) {
      const currency = trade.pnlCurrency || "USD";
      totals[currency] = (totals[currency] || 0) + trade.pnlAmount;
    }
    return totals;
  }, {});
  const wins = closedTrades.filter((trade) => resultTone(trade) === "positive").length;
  const losses = closedTrades.filter((trade) => resultTone(trade) === "negative").length;
  const watchingCount = selectedTrades.filter((trade) => ["tracking", "open"].includes(trade.status)).length;
  const chartTpCount = selectedTrades.filter((trade) => trade.status === "target_hit").length;
  const chartSlCount = selectedTrades.filter((trade) => trade.status === "stop_hit").length;
  const tradeCounts = new Map();
  const percentByDay = new Map();
  for (const trade of trades) {
    tradeCounts.set(trade.date, (tradeCounts.get(trade.date) || 0) + 1);
    percentByDay.set(trade.date, (percentByDay.get(trade.date) || 0) + (trade.pnlPercent ?? 0));
  }

  function moveMonth(delta) {
    if (!confirmDiscardUnsavedNote()) return;
    const target = new Date(year, month - 1 + delta, 1);
    setSelectedDate(dateKey(target.getTime()));
    setEditingTrade(null);
    setNoteDirty(false);
  }

  function chooseDate(value) {
    if (value !== selectedDate && !confirmDiscardUnsavedNote()) return;
    setSelectedDate(value);
    setEditingTrade(null);
    setNoteDirty(false);
  }

  function openNewTrade() {
    const now = Date.now();
    setFormError("");
    setEditingTrade({
      timestamp: now,
      date: selectedDate,
      time: new Date(now).toTimeString().slice(0, 5),
      symbol,
      side: "long",
      style: "day_trade",
      orderType: "limit",
      entry: "",
      exitPrice: "",
      stopLoss: "",
      takeProfit: "",
      quantity: "",
      pnlAmount: "",
      pnlCurrency: "USD",
      pnlPercent: "",
      status: "closed",
      thesis: "",
      notes: "",
    });
  }

  function editTrade(trade) {
    setFormError("");
    setEditingTrade({ ...trade, time: new Date(trade.timestamp).toTimeString().slice(0, 5) });
  }

  function updateDraft(field, value) {
    setEditingTrade((current) => {
      const next = { ...current, [field]: value };
      if (field === "date" || field === "time") {
        const date = field === "date" ? value : current.date;
        const time = field === "time" ? value : current.time;
        next.timestamp = new Date(`${date}T${time || "12:00"}`).getTime();
      }
      return next;
    });
  }

  async function submitTrade(event) {
    event.preventDefault();
    setSavingTrade(true);
    setFormError("");
    try {
      const hasResult = (editingTrade.pnlPercent !== "" && editingTrade.pnlPercent != null)
        || (editingTrade.pnlAmount !== "" && editingTrade.pnlAmount != null);
      await onSaveTrade({ ...editingTrade, status: hasResult ? "closed" : (editingTrade.status || "tracking") });
      setEditingTrade(null);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSavingTrade(false);
    }
  }

  async function saveDailyNote() {
    setSavingNote(true);
    setOperationError("");
    try {
      await onSaveDay(selectedDate, dailyNote);
      setNoteDirty(false);
    } catch (error) {
      setOperationError(error.message);
    } finally {
      setSavingNote(false);
    }
  }

  async function reviewTrade(trade) {
    setReviewingId(trade.id);
    setOperationError("");
    try { await onReviewTrade(trade.id); }
    catch (error) { setOperationError(error.message); }
    finally { setReviewingId(""); }
  }

  async function checkTrade(trade) {
    setCheckingId(trade.id);
    setOperationError("");
    setOperationNotice("");
    try {
      const { check } = await onCheckTrade(trade);
      const message = check.result === "target_hit"
        ? "Ảnh chart cho thấy đã chạm TP. Đây chưa xác nhận lệnh broker đã khớp hoặc PnL tài khoản."
        : check.result === "stop_hit"
          ? "Ảnh chart cho thấy đã chạm SL. Đây chưa xác nhận lệnh broker đã khớp hoặc PnL tài khoản."
          : check.result === "entry_pending"
            ? "Ảnh chart chưa cho thấy giá chạm Entry limit; kế hoạch vẫn đang chờ."
            : check.result === "open"
              ? "Ảnh chart cho thấy Entry đã chạm nhưng chưa xác minh TP/SL."
              : "Ảnh chưa đủ rõ để kết luận; trạng thái lệnh vẫn được giữ nguyên.";
      setOperationNotice(`${message} ${check.evidence || ""}`.trim());
    } catch (error) {
      setOperationError(error.message);
    } finally {
      setCheckingId("");
    }
  }

  async function deleteTrade(trade) {
    if (!window.confirm(`Xóa lệnh ${trade.symbol} ngày ${dateLabel(trade.date)}? AI memory gắn với lệnh này cũng sẽ bị xóa.`)) return;
    setOperationError("");
    try { await onDeleteTrade(trade.id); }
    catch (error) { setOperationError(error.message); }
  }

  async function toggleMemory(memory, active) {
    setOperationError("");
    try { await onUpdateMemory(memory.id, { active }); }
    catch (error) { setOperationError(error.message); }
  }

  async function saveMemory(memory) {
    setOperationError("");
    try {
      await onUpdateMemory(memory.id, { lesson: memoryDrafts[memory.id] ?? memory.lesson });
      setMemoryDrafts((current) => { const next = { ...current }; delete next[memory.id]; return next; });
    } catch (error) { setOperationError(error.message); }
  }

  async function deleteMemory(memory) {
    setOperationError("");
    try { await onDeleteMemory(memory.id); }
    catch (error) { setOperationError(error.message); }
  }

  return <div className={`journal-overlay ${pageMode ? "page-mode" : ""}`} role={pageMode ? undefined : "presentation"} onMouseDown={pageMode ? undefined : (event) => { if (event.target === event.currentTarget) closeJournal(); }}>
    <section className={`journal-workspace ${pageMode ? "page-mode" : ""}`} role={pageMode ? "region" : "dialog"} aria-modal={pageMode ? undefined : "true"} aria-labelledby="journal-title">
      <header className="journal-workspace-header">
        <div><span className="journal-eyebrow">LOCAL TRADE MEMORY</span><h2 id="journal-title">Sổ giao dịch</h2><p>Dữ liệu lưu trong SQLite trên máy này, không đồng bộ lên cloud.</p></div>
        <button type="button" className={`journal-close ${pageMode ? "journal-back-button" : ""}`} onClick={closeJournal} aria-label={pageMode ? "Quay lại phân tích" : "Đóng sổ giao dịch"} title={pageMode ? "Quay lại phân tích" : "Đóng sổ giao dịch"}>{pageMode ? "← Phân tích" : "×"}</button>
      </header>
      <nav className="journal-tabs" aria-label="Các mục sổ giao dịch">
        <button type="button" className={tab === "journal" ? "active" : ""} onClick={() => setTab("journal")}>Nhật ký theo ngày <span>{trades.length}</span></button>
        <button type="button" className={tab === "memory" ? "active" : ""} onClick={() => setTab("memory")}>AI Memory <span>{memories.length}</span></button>
      </nav>
      {operationError && <div className="journal-error" role="status">{operationError}<button type="button" onClick={() => setOperationError("")}>×</button></div>}
      {operationNotice && <div className="journal-check-notice" role="status">{operationNotice}<button type="button" onClick={() => setOperationNotice("")}>×</button></div>}

      {tab === "journal" ? <div className="journal-layout">
        <aside className="journal-calendar-pane">
          <div className="journal-month-nav"><button type="button" onClick={() => moveMonth(-1)} aria-label="Tháng trước">‹</button><strong>{monthLabel}</strong><button type="button" onClick={() => moveMonth(1)} aria-label="Tháng sau">›</button></div>
          <div className="journal-calendar-grid journal-weekdays">{"T2 T3 T4 T5 T6 T7 CN".split(" ").map((day) => <span key={day}>{day}</span>)}</div>
          <div className="journal-calendar-grid">
            {Array.from({ length: leadingDays }, (_, index) => <span className="journal-calendar-empty" key={`empty-${index}`} />)}
            {Array.from({ length: monthDays }, (_, index) => {
              const day = index + 1;
              const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const result = percentByDay.get(key) || 0;
              const hasNote = days.some((item) => item.date === key && item.note?.trim());
              const hasEntries = tradeCounts.has(key);
              const resultClass = hasEntries ? result > 0 ? "has-profit" : result < 0 ? "has-loss" : "has-trades" : hasNote ? "has-note" : "";
              return <button type="button" key={key} className={`journal-calendar-day ${selectedDate === key ? "selected" : ""} ${resultClass}`} onClick={() => chooseDate(key)} title={`${tradeCounts.get(key) || 0} lệnh${hasNote ? " · có ghi chú" : ""} · ${percentLabel(result)}`}><span>{day}</span>{(hasEntries || hasNote) && <i />}</button>;
            })}
          </div>
          <button type="button" className="journal-today-button" onClick={() => chooseDate(dateKey())}>Về hôm nay</button>
          <div className="journal-storage-note">Tệp cục bộ:<br /><code>~/.xauusd-copilot/data/trading-journal.sqlite</code></div>
        </aside>

        <div className="journal-day-pane">
          <div className="journal-day-heading"><div><span className="journal-eyebrow">NGÀY GIAO DỊCH</span><h3>{dateLabel(selectedDate)}</h3></div><button type="button" className="journal-add-button" onClick={openNewTrade}>＋ Ghi lệnh</button></div>
          <div className="journal-metrics">
            <div><span>Tổng PnL %</span><strong className={dailyPercent > 0 ? "trade-result-positive" : dailyPercent < 0 ? "trade-result-negative" : "trade-result-flat"}>{percentLabel(dailyPercent)}</strong></div>
            <div><span>PnL tiền</span><strong>{Object.entries(dailyMoney).length ? Object.entries(dailyMoney).map(([currency, amount]) => moneyLabel(amount, currency)).join(" · ") : "—"}</strong></div>
            <div><span>Kết quả đã ghi</span><strong>{closedTrades.length} đóng · {wins} thắng · {losses} thua</strong><small>{watchingCount} theo dõi{chartTpCount ? ` · ${chartTpCount} chạm TP trên chart` : ""}{chartSlCount ? ` · ${chartSlCount} chạm SL trên chart` : ""}</small></div>
          </div>

          {editingTrade && <form className="journal-trade-form" onSubmit={submitTrade}>
            <div className="journal-form-heading"><strong>{editingTrade.id ? "Sửa lệnh" : "Ghi lệnh đã đóng"}</strong><button type="button" onClick={() => setEditingTrade(null)}>Hủy</button></div>
            <div className="journal-form-grid">
              <label>Ngày<input type="date" value={editingTrade.date} onChange={(event) => updateDraft("date", event.target.value)} required /></label>
              <label>Giờ<input type="time" value={editingTrade.time || "12:00"} onChange={(event) => updateDraft("time", event.target.value)} required /></label>
              <label>Symbol<input value={editingTrade.symbol} onChange={(event) => updateDraft("symbol", event.target.value.toUpperCase())} placeholder="OANDA:XAUUSD" required /></label>
              <label>Hướng<select value={editingTrade.side} onChange={(event) => updateDraft("side", event.target.value)}><option value="long">Long</option><option value="short">Short</option></select></label>
              <label>Phong cách<select value={editingTrade.style} onChange={(event) => updateDraft("style", event.target.value)}><option value="scalp">Scalp</option><option value="day_trade">Day trade</option><option value="swing">Swing</option></select></label>
              <label>Loại vào lệnh<select value={editingTrade.orderType || "limit"} onChange={(event) => updateDraft("orderType", event.target.value)}><option value="limit">Limit</option><option value="market">Market</option></select></label>
              <label>Khối lượng<input type="number" step="any" value={editingTrade.quantity ?? ""} onChange={(event) => updateDraft("quantity", event.target.value)} placeholder="Tùy chọn" /></label>
              <label>Entry<input type="number" step="any" value={editingTrade.entry ?? ""} onChange={(event) => updateDraft("entry", event.target.value)} /></label>
              <label>Giá thoát<input type="number" step="any" value={editingTrade.exitPrice ?? ""} onChange={(event) => updateDraft("exitPrice", event.target.value)} /></label>
              <label>Stop loss<input type="number" step="any" value={editingTrade.stopLoss ?? ""} onChange={(event) => updateDraft("stopLoss", event.target.value)} /></label>
              <label>Take profit<input type="number" step="any" value={editingTrade.takeProfit ?? ""} onChange={(event) => updateDraft("takeProfit", event.target.value)} /></label>
              <label>PnL tiền<input type="number" step="any" value={editingTrade.pnlAmount ?? ""} onChange={(event) => updateDraft("pnlAmount", event.target.value)} placeholder="Tùy chọn" /></label>
              <label>Đơn vị tiền<input value={editingTrade.pnlCurrency || "USD"} onChange={(event) => updateDraft("pnlCurrency", event.target.value.toUpperCase())} /></label>
              <label>PnL % tài khoản<input type="number" step="0.01" value={editingTrade.pnlPercent ?? ""} onChange={(event) => updateDraft("pnlPercent", event.target.value)} placeholder="Tùy chọn" /></label>
            </div>
            <label className="journal-form-wide">Ý tưởng / lý do vào lệnh<textarea rows={2} value={editingTrade.thesis || ""} onChange={(event) => updateDraft("thesis", event.target.value)} placeholder="Liquidity, vùng POI, trigger dự kiến..." /></label>
            <label className="journal-form-wide">Ghi chú diễn biến và cảm xúc<textarea rows={3} value={editingTrade.notes || ""} onChange={(event) => updateDraft("notes", event.target.value)} placeholder="Có theo đúng kế hoạch không? Điều gì đã xảy ra trước và sau khi vào?" /></label>
            {formError && <p className="journal-error-text">{formError}</p>}
            <div className="journal-form-actions"><span>Nhập PnL tiền hoặc % để ghi kết quả thực tế; để trống nếu chỉ cập nhật ghi chú.</span><button type="submit" disabled={savingTrade}>{savingTrade ? "Đang lưu…" : "Lưu lệnh"}</button></div>
          </form>}

          <section className="journal-day-note"><div><strong>Ghi chú trong ngày{noteDirty && <span className="journal-unsaved-note"> · chưa lưu</span>}</strong><button type="button" onClick={saveDailyNote} disabled={savingNote || !noteDirty}>{savingNote ? "Đang lưu…" : "Lưu ghi chú"}</button></div><textarea rows={3} value={dailyNote} onChange={(event) => { setDailyNote(event.target.value); setNoteDirty(true); }} placeholder="Kế hoạch phiên, trạng thái tâm lý, tin tức, điều muốn cải thiện..." /></section>

          <div className="journal-trade-list-heading"><strong>CÁC LỆNH · {selectedTrades.length}</strong><span>Ghi chú rồi dùng AI review để tạo bài học cho các lần sau.</span></div>
          {selectedTrades.length ? <div className="journal-trade-list">{selectedTrades.map((trade) => {
            const memory = memories.find((item) => item.tradeId === trade.id);
            return <article className="journal-trade-card" key={trade.id}>
              <header><span className="journal-trade-time">{timeLabel(trade.timestamp)}</span><strong>{trade.symbol}</strong><span className={`journal-side journal-side-${trade.side}`}>{trade.side.toUpperCase()}</span><span className="journal-style">{trade.style.replace("_", " ")}</span><span className={`journal-status journal-status-${trade.status || "closed"}`}>{tradeStatusLabel(trade.status || "closed")}</span><strong className={`journal-trade-pnl trade-result-${resultTone(trade)}`}>{trade.status === "target_hit" ? "TP trên chart" : trade.status === "stop_hit" ? "SL trên chart" : (Number.isFinite(trade.pnlPercent) ? percentLabel(trade.pnlPercent) : moneyLabel(trade.pnlAmount, trade.pnlCurrency))}</strong></header>
              <div className="journal-level-line">Entry {priceLabel(trade.entry)} <span>·</span> Exit {priceLabel(trade.exitPrice)} <span>·</span> SL {priceLabel(trade.stopLoss)} <span>·</span> TP {priceLabel(trade.takeProfit)}{Number.isFinite(trade.pnlAmount) && Number.isFinite(trade.pnlPercent) ? <span className="journal-amount-extra">· {moneyLabel(trade.pnlAmount, trade.pnlCurrency)}</span> : null}</div>
              {trade.lastCheckedAt && <div className="journal-last-check"><strong>Kiểm tra chart · {new Date(trade.lastCheckedAt).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}</strong>{Number.isFinite(trade.lastCheckPrice) && <span>Giá đọc từ ảnh ≈ {priceLabel(trade.lastCheckPrice)}</span>}<p>{trade.lastCheckNote || "Không đủ bằng chứng để xác định trạng thái."}</p></div>}
              {trade.thesis && <p className="journal-trade-thesis"><b>Ý tưởng của bạn:</b> {trade.thesis}</p>}
              {trade.notes && <p className="journal-trade-notes"><b>Ghi chú:</b> {trade.notes}</p>}
              {memory && <p className="journal-memory-status">{memory.active ? "Memory đang được dùng trong phân tích sau." : "Memory đang tắt."} {memory.lesson}</p>}
              <div className="journal-trade-actions"><button type="button" onClick={() => editTrade(trade)}>Sửa / ghi PnL</button>{["tracking", "open"].includes(trade.status) && <button type="button" className="journal-check-button" onClick={() => checkTrade(trade)} disabled={checkingId === trade.id}>{checkingId === trade.id ? "Đang chụp và kiểm tra…" : "◉ Kiểm tra chart mới"}</button>}<button type="button" className="journal-review-button" onClick={() => reviewTrade(trade)} disabled={reviewingId === trade.id || trade.status !== "closed"}>{reviewingId === trade.id ? "Đang review…" : trade.review ? "AI review lại" : "✦ AI review + memory"}</button><button type="button" className="journal-delete-button" onClick={() => deleteTrade(trade)}>Xóa</button></div>
              {trade.review && <div className="journal-review-result"><strong>AI REVIEW</strong><ReviewText text={trade.review} />{trade.reviewedAt && <span>Cập nhật {new Date(trade.reviewedAt).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}</span>}</div>}
            </article>;
          })}</div> : <div className="journal-empty-day"><strong>Chưa có lệnh trong ngày này</strong><span>Ghi từ plan Quick Analysis hoặc thêm lệnh thủ công.</span><button type="button" onClick={openNewTrade}>＋ Ghi lệnh</button></div>}
        </div>
      </div> : <div className="journal-memory-pane">
        <div className="journal-memory-intro"><strong>Bài học trade cá nhân</strong><p>Sau AI review, bài học được lưu và chỉ gửi cho phân tích cùng mã giao dịch khi bật. Đây là ghi nhớ cho prompt, không phải huấn luyện lại model.</p></div>
        {memories.length ? memories.map((memory) => <article className={`journal-memory-card ${memory.active ? "" : "memory-disabled"}`} key={memory.id}>
          <header><div><strong>{memory.symbol}</strong><span>{dateLabel(memory.date)} · {Number.isFinite(memory.pnlPercent) ? percentLabel(memory.pnlPercent) : moneyLabel(memory.pnlAmount, memory.pnlCurrency)}</span></div><label><input type="checkbox" checked={memory.active} onChange={(event) => toggleMemory(memory, event.target.checked)} />Dùng cho phân tích sau</label></header>
          <textarea rows={3} value={memoryDrafts[memory.id] ?? memory.lesson} onChange={(event) => setMemoryDrafts((current) => ({ ...current, [memory.id]: event.target.value }))} />
          <div><button type="button" onClick={() => saveMemory(memory)}>Lưu chỉnh sửa</button><button type="button" className="journal-delete-button" onClick={() => deleteMemory(memory)}>Xóa memory</button></div>
        </article>) : <div className="journal-empty-day"><strong>Chưa có AI memory</strong><span>Ghi kết quả lệnh, thêm ghi chú rồi bấm “AI review + memory”.</span></div>}
      </div>}
    </section>
  </div>;
}
