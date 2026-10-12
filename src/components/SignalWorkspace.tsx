"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { BucketType, Holding, HoldingBucketRow, StockQuote, Transaction } from "@/lib/types";
import { currency, numberFmt, percentFmt } from "@/lib/risk";
export type HoldingCardView = {
  holding: Holding;
  quote?: StockQuote;
  longTerm: HoldingBucketRow;
  shortTerm: HoldingBucketRow;
  transactions: Transaction[];
  totals: {
    quantity: number;
    value?: number;
    costBasis?: number;
    unrealizedGain?: number;
    unrealizedGainPercent?: number;
    realizedGain?: number;
  };
};

type IconName = "portfolio" | "transactions" | "planner" | "settings" | "plus" | "refresh" | "arrow";
export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    portfolio: <><rect x="3" y="5" width="18" height="15" rx="1" /><path d="M8 5V3h8v2M3 10h18M9 10v3h6v-3" /></>,
    transactions: <><path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4" /></>,
    planner: <><rect x="4" y="4" width="16" height="17" rx="1" /><path d="M8 2v4m8-4v4M4 10h16M8 14h3m-3 3h6" /></>,
    settings: <><path d="M4 6h16M4 12h16M4 18h16" /><path d="M8 3v6m8 0v6M10 15v6" /></>,
    plus: <path d="M12 4v16M4 12h16" />,
    refresh: <><path d="M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5M4 14a8 8 0 0 0 14 5l3-3m0 5v-5h-5" /></>,
    arrow: <path d="m9 5 7 7-7 7" />,
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function SummaryCard({ label, value, danger = false, good = false }: { label: string; value: string; danger?: boolean; good?: boolean }) {
  return <div className="summary-item"><span className="eyebrow">{label}</span><strong className={danger ? "negative" : good ? "positive" : ""}>{value}</strong></div>;
}

export function MiniMetric({ label, value }: { label: string; value: ReactNode }) {
  return <div className="mini-metric"><dt>{label}</dt><dd>{value}</dd></div>;
}

function Gain({ value, percent }: { value?: number; percent?: number }) {
  return <span className={value === undefined ? "muted" : value < 0 ? "negative" : value > 0 ? "positive" : ""}>{value !== undefined && value > 0 ? "+" : ""}{currency(value)}{percent !== undefined ? <small className="gain-percent">{percent > 0 ? "+" : ""}{percentFmt(percent)}</small> : null}</span>;
}

function QuoteStatus({ quote }: { quote?: StockQuote }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  const stale = quote && now - new Date(quote.fetchedAt).getTime() > 120000;
  return <span className={"quote-status " + (!quote || stale ? "warning" : "muted")}><span className="status-dot" />{!quote ? "No quote" : stale ? "Stale quote" : "Recent quote"}</span>;
}

function RiskStatus({ status }: { status: HoldingBucketRow["status"] }) {
  const labels = { over_limit: "Over limit", under_limit: "Within limit", no_position: "No position", record_only: "Not tracked", incomplete: "Needs quote" };
  return <span className={"risk-status " + (status === "over_limit" ? "negative" : status === "under_limit" ? "positive" : status === "incomplete" ? "warning" : "muted")}><span className="status-dot" />{labels[status]}</span>;
}

function overallStatus(card: HoldingCardView) {
  const states = [card.longTerm.status, card.shortTerm.status];
  return (["over_limit", "incomplete", "under_limit", "record_only", "no_position"] as const).find((status) => states.includes(status))!;
}

export function PositionsWorkspace({ cards, onAdd, onPlan, onRisk, onDeleteHolding, onDeleteTransaction }: {
  cards: HoldingCardView[];
  onAdd: (symbol?: string, bucket?: BucketType) => void;
  onPlan: (symbol?: string, bucket?: BucketType) => void;
  onRisk: (holding: Holding, bucket: BucketType) => void;
  onDeleteHolding: (id: string) => void;
  onDeleteTransaction: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | BucketType>("all");
  const [bucket, setBucket] = useState<BucketType>("long_term");
  const [query, setQuery] = useState("");
  const [mobileDetails, setMobileDetails] = useState(false);
  const inspectorTitle = useRef<HTMLHeadingElement>(null);
  const visible = cards.filter((card) => card.holding.symbol.includes(query.trim().toUpperCase()) && (filter === "all" || (filter === "long_term" ? card.longTerm : card.shortTerm).quantity > 0));
  const selected = visible.find((card) => card.holding.id === selectedId) ?? visible[0];
  const row = selected ? (bucket === "long_term" ? selected.longTerm : selected.shortTerm) : undefined;

  function select(card: HoldingCardView) {
    setSelectedId(card.holding.id);
    if (filter !== "all") setBucket(filter);
    setMobileDetails(true);
    if (window.matchMedia("(max-width: 760px)").matches) requestAnimationFrame(() => inspectorTitle.current?.focus());
  }

  function backToPositions() {
    setMobileDetails(false);
    requestAnimationFrame(() => document.getElementById("position-" + selected?.holding.id)?.focus());
  }

  if (!cards.length) return <section className="empty-state"><div className="empty-icon"><Icon name="portfolio" /></div><h2>No positions yet</h2><div className="header-actions"><button className="btn-primary" onClick={() => onAdd()}><Icon name="plus" />Add first transaction</button><button className="btn-secondary" onClick={() => onPlan()}>Plan a purchase</button></div></section>;

  return <div className={"positions-workspace " + (mobileDetails && selected ? "show-detail" : "")}>
    <section className="positions-panel" aria-label="Positions">
      <div className="section-heading"><h2>Positions <span className="count">{cards.length.toString().padStart(2, "0")}</span></h2><label className="search"><span className="sr-only">Find a symbol</span><input placeholder="Find symbol…" value={query} onChange={(event) => setQuery(event.target.value)} /><span aria-hidden="true">⌕</span></label></div>
      <div className="filter-tabs" aria-label="Position filter">{([['all', 'All positions'], ['long_term', 'Long-term'], ['short_term', 'Short-term']] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); if (value !== "all") setBucket(value); }}>{label}</button>)}</div>
      <div className="table-scroll"><table className="positions-table"><caption className="sr-only">Select a symbol to inspect its positions</caption><thead><tr><th scope="col">Symbol</th><th scope="col" className="desktop-column">Price</th><th scope="col" className="desktop-column">Shares</th><th scope="col">Value / P&amp;L</th><th scope="col" className="risk-column">Risk status</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead><tbody>{visible.map((card) => {
        const activeRow = filter === "all" ? undefined : filter === "long_term" ? card.longTerm : card.shortTerm;
        const value = activeRow ? activeRow.currentValue : card.totals.value;
        return <tr key={card.holding.id} className={selected?.holding.id === card.holding.id ? "selected" : ""}>
          <th scope="row"><button id={"position-" + card.holding.id} className="symbol-button" aria-label={"Inspect " + card.holding.symbol} aria-pressed={selected?.holding.id === card.holding.id} onClick={() => select(card)}>{card.holding.symbol}<span>{card.totals.quantity === 0 ? "Planning / closed" : "Equity position"}</span></button><span className="compact-risk"><RiskStatus status={activeRow ? activeRow.status : overallStatus(card)} /></span></th>
          <td className="desktop-column">{currency(card.quote?.currentPrice)}<QuoteStatus quote={card.quote} /></td><td className="desktop-column">{numberFmt(activeRow ? activeRow.quantity : card.totals.quantity)}</td>
          <td><span className="position-value">{currency(value)}</span><span className="position-gain"><Gain value={activeRow ? activeRow.unrealizedGain : card.totals.unrealizedGain} /></span></td>
          <td className="risk-column"><RiskStatus status={activeRow ? activeRow.status : overallStatus(card)} />{(activeRow ? activeRow.targetReached : card.longTerm.targetReached || card.shortTerm.targetReached) ? <span className="target-hit">Target hit</span> : null}</td>
          <td><button className="icon-button" aria-label={"Open " + card.holding.symbol + " details"} onClick={() => select(card)}><Icon name="arrow" /></button></td>
        </tr>;
      })}</tbody></table></div>
      {!visible.length ? <div className="table-empty">No positions match this view.<button className="text-button" onClick={() => { setFilter("all"); setQuery(""); }}>Clear filters</button></div> : null}
      <div className="table-note"><span>{visible.length} OF {cards.length} POSITIONS</span><span>VALUES IN USD</span></div>
    </section>
    <aside className="position-inspector" aria-label="Position details">
      {selected && row ? <>
        <button className="back-button" onClick={backToPositions}>← Back to positions</button>
        <div className="inspector-kicker"><span className="eyebrow">POSITION DETAILS</span><span className="eyebrow">{String(cards.indexOf(selected) + 1).padStart(2, "0")} / {String(cards.length).padStart(2, "0")}</span></div>
        <div className="inspector-heading"><div><h2 ref={inspectorTitle} tabIndex={-1}>{selected.holding.symbol}</h2><p className="muted">{numberFmt(selected.totals.quantity)} total shares</p></div><div className="inspector-price">{currency(selected.quote?.currentPrice)}<QuoteStatus quote={selected.quote} /></div></div>
        <div className="filter-tabs bucket-tabs" aria-label="Position bucket">{([['long_term', 'Long-term'], ['short_term', 'Short-term']] as const).map(([value, label]) => <button key={value} aria-pressed={bucket === value} onClick={() => setBucket(value)}>{label}</button>)}</div>
        <dl className="inspector-metrics"><MiniMetric label="Quantity" value={numberFmt(row.quantity)} /><MiniMetric label="Unrealized P&L" value={<Gain value={row.unrealizedGain} percent={row.unrealizedGainPercent} />} /><MiniMetric label="Average cost" value={currency(row.averageBuyPrice)} /><MiniMetric label="Realized P&L" value={<Gain value={row.realizedGain} />} /><MiniMetric label="Market value" value={currency(row.currentValue)} /><MiniMetric label="Cost basis" value={currency(row.costBasis)} /></dl>
        <section className="inspector-section"><div className="section-heading"><h3>Risk &amp; target</h3><button className="btn-compact" onClick={() => onRisk(selected.holding, bucket)}>Edit settings ↗</button></div><RiskGauge row={row} /><div className="target-line"><span className="muted">Target price</span><strong>{row.targetEnabled ? currency(row.targetSellPrice) : "Not set"}</strong>{row.targetReached ? <span className="target-hit">Target hit</span> : null}</div>{row.targetEnabled ? <p className="target-description muted">{row.targetMode === "price" ? "Fixed sell price" : percentFmt(row.targetProfitPercent) + " above average cost"}{row.targetSellPrice === undefined ? " · Average cost needed" : ""}</p> : null}</section>
        <section className="inspector-section"><div className="section-heading"><h3>Activity <span className="count">{row.transactionCount}</span></h3><button className="text-button" onClick={() => onAdd(selected.holding.symbol, bucket)}>+ Add transaction</button></div><TransactionHistory compact transactions={selected.transactions.filter((tx) => tx.bucket === bucket)} rows={[row]} onDelete={onDeleteTransaction} /></section>
        {selected.holding.notes ? <section className="inspector-section"><p className="eyebrow">POSITION NOTES</p><p className="position-notes">{selected.holding.notes}</p></section> : null}
        <div className="inspector-actions"><button className="btn-secondary" onClick={() => onPlan(selected.holding.symbol, bucket)}><Icon name="planner" />Plan purchase</button><button className="delete-button" onClick={() => onDeleteHolding(selected.holding.id)}>Delete holding</button></div>
      </> : <div className="inspector-placeholder"><Icon name="portfolio" /><p>Select a position to review<br />its risk, targets, and activity.</p></div>}
    </aside>
  </div>;
}

function RiskGauge({ row }: { row: HoldingBucketRow }) {
  const limit = row.maxInvestmentValue;
  const ratio = limit && row.currentValue !== undefined ? row.currentValue / limit : undefined;
  const scale = Math.max(1.25, (ratio ?? 0) * 1.1);
  return <div className="risk-gauge"><div className="risk-gauge-label"><RiskStatus status={row.status} /><span className="muted">{ratio === undefined ? "—" : percentFmt(ratio * 100) + " used"}</span></div>{limit !== undefined && row.currentValue !== undefined ? <><div className="gauge-track" role="img" aria-label={`${currency(row.currentValue)} invested against ${currency(limit)} maximum investment`}><div className={"gauge-fill " + (row.status === "over_limit" ? "over" : "")} style={{ width: `${((ratio ?? 0) / scale) * 100}%` }} /><span className="gauge-limit" style={{ left: `${100 / scale}%` }} /></div><div className="gauge-legend"><span>{currency(row.currentValue)} invested</span><span>Limit {currency(limit)}</span></div><p className={row.status === "over_limit" ? "negative capacity" : "muted capacity"}>{currency(Math.abs(row.remainingCapacity ?? 0))}{(row.remainingCapacity ?? 0) < 0 ? " over limit" : " capacity remaining"}</p></> : <p className="risk-explanation">{limit === undefined ? "Set a risk amount and percentage to track your investment capacity." : "Refresh quotes to calculate your investment capacity."}</p>}</div>;
}

export function TransactionHistory({ transactions, rows, onDelete, compact = false }: { transactions: Transaction[]; rows: HoldingBucketRow[]; onDelete: (id: string) => void; compact?: boolean }) {
  const sorted = [...transactions].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate) || b.createdAt.localeCompare(a.createdAt));
  if (!sorted.length) return <p className="activity-empty">No transactions yet.</p>;
  return <div className={compact ? "activity-list" : "transaction-list"}>{sorted.map((tx) => {
    const row = rows.find((item) => item.holdingId === tx.holdingId && item.bucket === tx.bucket);
    return <article className="transaction-row" key={tx.id}><span className={"trade-mark " + tx.type}>{tx.type === "buy" ? "↙" : "↗"}</span><div className="trade-info"><strong>{tx.type === "buy" ? "Buy" : "Sell"}{!compact ? " · " + tx.symbol : ""}</strong><span>{tx.tradeDate}{!compact ? " · " + (tx.bucket === "long_term" ? "Long-term" : "Short-term") : ""}</span><span>{numberFmt(tx.quantity)} shares × {currency(tx.price)}</span>{tx.notes ? <p>{tx.notes}</p> : null}</div><div className="trade-amount">{currency(tx.quantity * tx.price)}{tx.type === "sell" ? <small>Realized <Gain value={row?.realizedGainByTransactionId[tx.id]} /></small> : <small>Cost</small>}</div><button className="delete-button" aria-label={`Delete ${tx.symbol} ${tx.type} on ${tx.tradeDate}`} onClick={() => onDelete(tx.id)}>Delete</button></article>;
  })}</div>;
}

export function Modal({ title, children, onClose, message }: { title: string; children: ReactNode; onClose: () => void; message?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="signal-dialog" aria-labelledby={titleId} onKeyDown={(event) => {
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }} onCancel={(event) => { event.preventDefault(); onClose(); }}><div className="dialog-heading"><div><p className="eyebrow">NJORDR / WORKSPACE</p><h2 id={titleId}>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog">×</button></div>{message ? <div className="notice dialog-notice" role="alert">{message}</div> : null}<div className="dialog-body">{children}</div></dialog>;
}
