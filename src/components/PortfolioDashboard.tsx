"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, BucketType, Holding, HoldingBucketRow, HoldingInput, StockQuote, TargetMode, Transaction, TransactionInput, TransactionType } from "@/lib/types";
import { buildBucketRows, currency, maxInvestmentValue, numberFmt, percentFmt } from "@/lib/risk";
import { Icon, MiniMetric, Modal, PositionsWorkspace, SummaryCard, TransactionHistory, type HoldingCardView } from "./SignalWorkspace";
import { portfolioRepository } from "@/lib/repositories/portfolioRepository";
import { fetchQuotes, isQuoteFresh } from "@/lib/quotes";

const today = () => new Date().toISOString().slice(0, 10);

const emptyTransactionForm = (symbol = "", bucket: BucketType = "short_term"): TransactionInput => ({
  symbol,
  bucket,
  type: "buy",
  quantity: 0,
  price: 0,
  tradeDate: today(),
  notes: "",
});

type TransactionModalState = {
  open: boolean;
  form: TransactionInput;
};

type RiskModalState = {
  holding: Holding;
  bucket: BucketType;
  riskEnabled: boolean;
  maxRiskAmount: number;
  riskPercent: number;
  targetEnabled: boolean;
  targetMode: TargetMode;
  targetProfitPercent: number;
  targetPrice: number;
  notes: string;
};

type PlanModalState = {
  symbol: string;
  bucket: BucketType;
  maxRiskAmount: number;
  riskPercent: number;
  price: number;
  quote?: StockQuote;
  isFetchingQuote: boolean;
};


export function PortfolioDashboard() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [quotes, setQuotes] = useState<Record<string, StockQuote | undefined>>({});
  const [settings, setSettings] = useState<AppSettings>({ autoRefreshEnabled: false, refreshIntervalSeconds: 60 });
  const [transactionModal, setTransactionModal] = useState<TransactionModalState>({ open: false, form: emptyTransactionForm() });
  const [riskModal, setRiskModal] = useState<RiskModalState | null>(null);
  const [planModal, setPlanModal] = useState<PlanModalState | null>(null);
  const [view, setView] = useState<"portfolio" | "transactions" | "settings">("portfolio");
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    if (holdings.length > 0) void refreshQuotes(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings.map((h) => h.symbol).join(",")]);

  useEffect(() => {
    if (!settings.autoRefreshEnabled) return;
    const tick = () => {
      if (document.visibilityState === "visible") void refreshQuotes(false);
    };
    const interval = window.setInterval(tick, settings.refreshIntervalSeconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoRefreshEnabled, settings.refreshIntervalSeconds, holdings.length]);

  const rows = useMemo(() => buildBucketRows(holdings, quotes, transactions), [holdings, quotes, transactions]);
  const cards = useMemo(() => buildHoldingCards(holdings, rows, quotes, transactions), [holdings, rows, quotes, transactions]);
  const summary = useMemo(() => buildSummary(rows), [rows]);
  const lastRefreshText = summary.lastRefreshAt ? new Date(summary.lastRefreshAt).toLocaleTimeString() : "—";

  async function loadInitialData() {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const [savedHoldings, savedTransactions, savedSettings] = await Promise.all([
        portfolioRepository.getHoldings(),
        portfolioRepository.getTransactions(),
        portfolioRepository.getSettings(),
      ]);
      setHoldings(savedHoldings);
      setTransactions(savedTransactions);
      setSettings(savedSettings);
      const symbols = Array.from(new Set([...savedHoldings.map((h) => h.symbol), ...savedTransactions.map((t) => t.symbol)]));
      setQuotes(await portfolioRepository.getCachedQuotes(symbols));
    } catch (error) {
      setLoadFailed(true);
      setMessage(error instanceof Error ? error.message : "Could not load your portfolio.");
    } finally {
      setIsLoading(false);
    }
  }

  async function reloadPortfolioData() {
    const [savedHoldings, savedTransactions] = await Promise.all([portfolioRepository.getHoldings(), portfolioRepository.getTransactions()]);
    setHoldings(savedHoldings);
    setTransactions(savedTransactions);
    return savedHoldings;
  }

  async function refreshQuotes(force: boolean) {
    const symbols = Array.from(new Set(holdings.map((h) => h.symbol)));
    if (symbols.length === 0) return;
    setIsRefreshing(true);
    setMessage("");
    try {
      const cached = await portfolioRepository.getCachedQuotes(symbols);
      const staleSymbols = force ? symbols : symbols.filter((symbol) => !isQuoteFresh(cached[symbol], 60));
      let updated = cached;
      if (staleSymbols.length > 0) {
        const fetched = await fetchQuotes(staleSymbols);
        await portfolioRepository.saveQuotes(fetched);
        updated = { ...cached, ...Object.fromEntries(fetched.map((q) => [q.symbol, q])) };
      }
      setQuotes(updated);
      setMessage(force ? "Prices refreshed." : staleSymbols.length > 0 ? "Stale prices refreshed." : "Prices are up to date.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not refresh prices.");
    } finally {
      setIsRefreshing(false);
    }
  }

  function openTransactionModal(symbol = "", bucket: BucketType = "short_term") {
    setMessage("");
    setTransactionModal({ open: true, form: emptyTransactionForm(symbol, bucket) });
  }

  function closeTransactionModal() {
    setTransactionModal({ open: false, form: emptyTransactionForm() });
  }

  function openPlanModal(symbol = "", bucket: BucketType = "short_term") {
    setMessage("");
    const existing = holdings.find((holding) => holding.symbol === symbol.toUpperCase());
    const isLongTerm = bucket === "long_term";
    setPlanModal({
      symbol: symbol.toUpperCase(),
      bucket,
      maxRiskAmount: existing ? (isLongTerm ? existing.longTermMaxRiskAmount : existing.shortTermMaxRiskAmount) : 0,
      riskPercent: existing ? (isLongTerm ? existing.longTermRiskPercent : existing.shortTermRiskPercent) : 0,
      price: quotes[symbol.toUpperCase()]?.currentPrice ?? 0,
      quote: quotes[symbol.toUpperCase()],
      isFetchingQuote: false,
    });
  }

  async function fetchPlanQuote() {
    if (!planModal) return;
    const symbol = planModal.symbol.trim().toUpperCase();
    if (!/^[A-Z.\-]{1,10}$/.test(symbol)) return setMessage("Enter a valid US ticker symbol to fetch a planning price.");
    setPlanModal({ ...planModal, symbol, isFetchingQuote: true });
    setMessage("");
    try {
      const [quote] = await fetchQuotes([symbol]);
      if (!quote) throw new Error("No quote returned for " + symbol + ".");
      await portfolioRepository.saveQuotes([quote]);
      setQuotes((current) => ({ ...current, [symbol]: quote }));
      setPlanModal((current) => current ? { ...current, symbol, price: quote.currentPrice, quote, isFetchingQuote: false } : current);
    } catch (error) {
      setPlanModal((current) => current ? { ...current, isFetchingQuote: false } : current);
      setMessage(error instanceof Error ? error.message : "Could not fetch planning quote.");
    }
  }

  async function savePlanAsRiskSettings() {
    if (!planModal) return;
    const validation = validatePlan(planModal);
    if (validation) return setMessage(validation);
    const symbol = planModal.symbol.trim().toUpperCase();
    const existing = holdings.find((holding) => holding.symbol === symbol);
    const isLongTerm = planModal.bucket === "long_term";
    const input: HoldingInput = existing ? {
      symbol: existing.symbol,
      notes: existing.notes ?? "",
      longTermQuantity: existing.longTermQuantity,
      longTermMaxRiskAmount: isLongTerm ? planModal.maxRiskAmount : existing.longTermMaxRiskAmount,
      longTermRiskPercent: isLongTerm ? planModal.riskPercent : existing.longTermRiskPercent,
      longTermTargetEnabled: existing.longTermTargetEnabled,
      longTermTargetMode: existing.longTermTargetMode,
      longTermTargetProfitPercent: existing.longTermTargetProfitPercent ?? 0,
      longTermTargetPrice: existing.longTermTargetPrice ?? 0,
      shortTermQuantity: existing.shortTermQuantity,
      shortTermMaxRiskAmount: !isLongTerm ? planModal.maxRiskAmount : existing.shortTermMaxRiskAmount,
      shortTermRiskPercent: !isLongTerm ? planModal.riskPercent : existing.shortTermRiskPercent,
      shortTermTargetEnabled: existing.shortTermTargetEnabled,
      shortTermTargetMode: existing.shortTermTargetMode,
      shortTermTargetProfitPercent: existing.shortTermTargetProfitPercent ?? 0,
      shortTermTargetPrice: existing.shortTermTargetPrice ?? 0,
    } : {
      symbol,
      notes: "Planning-only risk record. Add transactions when you buy.",
      longTermQuantity: 0,
      longTermMaxRiskAmount: isLongTerm ? planModal.maxRiskAmount : 0,
      longTermRiskPercent: isLongTerm ? planModal.riskPercent : 0,
      longTermTargetEnabled: false,
      longTermTargetMode: "percent",
      longTermTargetProfitPercent: 0,
      longTermTargetPrice: 0,
      shortTermQuantity: 0,
      shortTermMaxRiskAmount: !isLongTerm ? planModal.maxRiskAmount : 0,
      shortTermRiskPercent: !isLongTerm ? planModal.riskPercent : 0,
      shortTermTargetEnabled: false,
      shortTermTargetMode: "percent",
      shortTermTargetProfitPercent: 0,
      shortTermTargetPrice: 0,
    };

    try {
      if (existing) {
        await portfolioRepository.updateHolding(existing.id, input);
      } else {
        await portfolioRepository.createHolding(input);
      }
      await reloadPortfolioData();
      setPlanModal(null);
      setMessage(symbol + " " + bucketLabel(planModal.bucket) + " plan saved as risk settings.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save planning settings.");
    }
  }

  async function submitTransaction(event: FormEvent) {
    event.preventDefault();
    const validation = validateTransaction(transactionModal.form);
    if (validation) return setMessage(validation);

    try {
      const created = await portfolioRepository.createTransaction(transactionModal.form);
      const savedHoldings = await reloadPortfolioData();
      closeTransactionModal();
      setMessage(created.symbol + " " + bucketLabel(created.bucket) + " transaction added. Quantity, P&L, and risk were re-evaluated.");
      if (!quotes[created.symbol]) setQuotes(await portfolioRepository.getCachedQuotes(savedHoldings.map((h) => h.symbol)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save transaction.");
    }
  }

  function openRiskModal(holding: Holding, bucket: BucketType) {
    setMessage("");
    const isLongTerm = bucket === "long_term";
    const maxRiskAmount = isLongTerm ? holding.longTermMaxRiskAmount : holding.shortTermMaxRiskAmount;
    const riskPercent = isLongTerm ? holding.longTermRiskPercent : holding.shortTermRiskPercent;
    const targetProfitPercent = isLongTerm ? holding.longTermTargetProfitPercent ?? 0 : holding.shortTermTargetProfitPercent ?? 0;
    const targetPrice = isLongTerm ? holding.longTermTargetPrice ?? 0 : holding.shortTermTargetPrice ?? 0;
    const targetMode = isLongTerm ? holding.longTermTargetMode ?? "percent" : holding.shortTermTargetMode ?? "percent";
    const storedTargetEnabled = isLongTerm ? holding.longTermTargetEnabled : holding.shortTermTargetEnabled;
    setRiskModal({
      holding,
      bucket,
      riskEnabled: maxRiskAmount > 0 && riskPercent > 0,
      maxRiskAmount,
      riskPercent,
      targetEnabled: storedTargetEnabled ?? targetProfitPercent > 0,
      targetMode,
      targetProfitPercent,
      targetPrice,
      notes: holding.notes ?? "",
    });
  }

  async function submitRiskSettings(event: FormEvent) {
    event.preventDefault();
    if (!riskModal) return;
    const validation = validateRiskModal(riskModal);
    if (validation) return setMessage(validation);

    const isLongTerm = riskModal.bucket === "long_term";
    const input = {
      symbol: riskModal.holding.symbol,
      notes: riskModal.notes,
      longTermQuantity: riskModal.holding.longTermQuantity,
      longTermMaxRiskAmount: isLongTerm ? (riskModal.riskEnabled ? riskModal.maxRiskAmount : 0) : riskModal.holding.longTermMaxRiskAmount,
      longTermRiskPercent: isLongTerm ? (riskModal.riskEnabled ? riskModal.riskPercent : 0) : riskModal.holding.longTermRiskPercent,
      longTermTargetEnabled: isLongTerm ? riskModal.targetEnabled : riskModal.holding.longTermTargetEnabled,
      longTermTargetMode: isLongTerm ? riskModal.targetMode : riskModal.holding.longTermTargetMode,
      longTermTargetProfitPercent: isLongTerm ? riskModal.targetProfitPercent : riskModal.holding.longTermTargetProfitPercent ?? 0,
      longTermTargetPrice: isLongTerm ? riskModal.targetPrice : riskModal.holding.longTermTargetPrice ?? 0,
      shortTermQuantity: riskModal.holding.shortTermQuantity,
      shortTermMaxRiskAmount: !isLongTerm ? (riskModal.riskEnabled ? riskModal.maxRiskAmount : 0) : riskModal.holding.shortTermMaxRiskAmount,
      shortTermRiskPercent: !isLongTerm ? (riskModal.riskEnabled ? riskModal.riskPercent : 0) : riskModal.holding.shortTermRiskPercent,
      shortTermTargetEnabled: !isLongTerm ? riskModal.targetEnabled : riskModal.holding.shortTermTargetEnabled,
      shortTermTargetMode: !isLongTerm ? riskModal.targetMode : riskModal.holding.shortTermTargetMode,
      shortTermTargetProfitPercent: !isLongTerm ? riskModal.targetProfitPercent : riskModal.holding.shortTermTargetProfitPercent ?? 0,
      shortTermTargetPrice: !isLongTerm ? riskModal.targetPrice : riskModal.holding.shortTermTargetPrice ?? 0,
    };

    try {
      const saved = await portfolioRepository.updateHolding(riskModal.holding.id, input);
      await reloadPortfolioData();
      setRiskModal(null);
      setMessage(saved.symbol + " " + bucketLabel(riskModal.bucket) + " risk/target settings updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save risk settings.");
    }
  }

  async function deleteHolding(id: string) {
    const holding = holdings.find((h) => h.id === id);
    if (!holding || !window.confirm("Delete " + holding.symbol + " and all transactions for it?")) return;
    try {
      await portfolioRepository.deleteHolding(id);
      await reloadPortfolioData();
      setMessage(holding.symbol + " deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete holding.");
    }
  }

  async function deleteTransaction(id: string) {
    const transaction = transactions.find((t) => t.id === id);
    if (!transaction || !window.confirm("Delete " + transaction.symbol + " " + bucketLabel(transaction.bucket) + " transaction?")) return;
    try {
      await portfolioRepository.deleteTransaction(id);
      await reloadPortfolioData();
      setMessage("Transaction deleted. Quantity, P&L, and risk were re-evaluated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete transaction.");
    }
  }

  async function updateAutoRefresh(enabled: boolean) {
    const previous = settings;
    const next = { ...settings, autoRefreshEnabled: enabled, refreshIntervalSeconds: 60 };
    setSettings(next);
    try {
      await portfolioRepository.updateSettings(next);
    } catch (error) {
      setSettings(previous);
      setMessage(error instanceof Error ? error.message : "Could not save preferences.");
    }
  }

  async function exportBackup() {
    try {
      const backup = await portfolioRepository.exportBackup();
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "njordr-backup-" + today() + ".json";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not export portfolio.");
    }
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (!window.confirm("Importing will replace all existing holdings, transactions, and cached quotes. Continue?")) return;
      await portfolioRepository.importBackup(JSON.parse(await file.text()));
      await loadInitialData();
      setMessage("Backup imported.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      event.target.value = "";
    }
  }

  return (
    <div className="signal-app">
      <aside className="sidebar">
        <a className="wordmark" href="#main" aria-label="Njordr home"><span className="brand-mark">N</span>NJORDR<span className="brand-dot">.</span></a>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button aria-current={view === "portfolio" ? "page" : undefined} onClick={() => setView("portfolio")}><Icon name="portfolio" />Portfolio<span className="nav-count">{holdings.length.toString().padStart(2, "0")}</span></button>
          <button aria-current={view === "transactions" ? "page" : undefined} onClick={() => setView("transactions")}><Icon name="transactions" />Transactions</button>
          <button onClick={() => openPlanModal()}><Icon name="planner" />Planner<small>↗</small></button>
          <button aria-current={view === "settings" ? "page" : undefined} onClick={() => setView("settings")}><Icon name="settings" />Settings</button>
        </nav>
        <div className="sidebar-bottom"><span className="local-dot" />Local workspace<span className="edition">SIGNAL / 01</span></div>
      </aside>
      <main id="main" className="workspace">
        <header className="workspace-header">
          <div><p className="eyebrow">PERSONAL INVESTING / {view === "portfolio" ? "OVERVIEW" : view.toUpperCase()}</p><h1>{view === "portfolio" ? "Portfolio" : view === "transactions" ? "Transactions" : "Settings"}<span className="heading-dot">.</span></h1></div>
          <div className="header-actions"><button className="btn-secondary" onClick={() => openPlanModal()}><Icon name="planner" />Plan purchase</button><button className="btn-primary" onClick={() => openTransactionModal()}><Icon name="plus" />Add transaction</button></div>
        </header>
        {message && !planModal && !riskModal && !transactionModal.open ? <div className="notice" role="status">{message}<button aria-label="Dismiss notification" onClick={() => setMessage("")}>×</button></div> : null}
        <input ref={fileRef} type="file" accept="application/json" className="hidden" aria-label="Import backup" onChange={(event) => void importBackup(event)} />
        {isLoading ? <div className="empty-state" role="status"><span className="eyebrow">OPENING WORKSPACE</span><h2>Loading your portfolio…</h2></div> : loadFailed ? <div className="empty-state"><h2>Unable to open your portfolio</h2><button className="btn-primary" onClick={() => void loadInitialData()}>Try again</button></div> : <>
          {view === "portfolio" ? <>
            <section className="summary-strip" aria-label="Portfolio summary">
              <SummaryCard label="Portfolio value" value={currency(summary.totalValue)} />
              <SummaryCard label="Cost basis" value={currency(summary.totalCostBasis)} />
              <SummaryCard label="Unrealized P&L" value={currency(summary.totalUnrealizedGain)} danger={summary.totalUnrealizedGain !== undefined && summary.totalUnrealizedGain < 0} good={summary.totalUnrealizedGain !== undefined && summary.totalUnrealizedGain > 0} />
              <SummaryCard label="Realized P&L" value={currency(summary.totalRealizedGain)} danger={summary.totalRealizedGain !== undefined && summary.totalRealizedGain < 0} good={summary.totalRealizedGain !== undefined && summary.totalRealizedGain > 0} />
              <SummaryCard label="Buckets over limit" value={String(summary.overLimitCount).padStart(2, "0")} danger={summary.overLimitCount > 0} />
              <SummaryCard label="Targets hit" value={String(summary.targetReachedCount).padStart(2, "0")} good={summary.targetReachedCount > 0} />
            </section>
            <PositionsWorkspace cards={cards} onAdd={openTransactionModal} onPlan={openPlanModal} onRisk={openRiskModal} onDeleteHolding={(id) => void deleteHolding(id)} onDeleteTransaction={(id) => void deleteTransaction(id)} />
          </> : view === "transactions" ? <section className="page-section"><div className="section-heading"><h2>Transaction history <span className="count">{transactions.length}</span></h2><span className="eyebrow">MOST RECENT FIRST</span></div><TransactionHistory transactions={transactions} rows={rows} onDelete={(id) => void deleteTransaction(id)} /></section> : <section className="settings-page">
            <div className="settings-section"><div><span className="eyebrow">01 / MARKET DATA</span><h2>Quote preferences</h2><p className="muted">Refresh prices while your workspace is visible.</p></div><div><label className="switch-label"><input type="checkbox" checked={settings.autoRefreshEnabled} onChange={(e) => void updateAutoRefresh(e.target.checked)} /><span>Auto-refresh every 60 seconds</span></label><button className="btn-secondary" disabled={isRefreshing || !holdings.length} onClick={() => void refreshQuotes(true)}>{isRefreshing ? "Refreshing…" : "Refresh prices now"}</button></div></div>
            <div className="settings-section"><div><span className="eyebrow">02 / YOUR DATA</span><h2>Portfolio backup</h2><p className="muted">Save a copy of your holdings, transactions, and preferences.</p></div><div className="space-y-4"><div className="header-actions"><button className="btn-secondary" onClick={() => void exportBackup()}>Export JSON</button><button className="btn-secondary" onClick={() => fileRef.current?.click()}>Import JSON</button></div><p className="muted">Import replaces your current portfolio after confirmation.</p></div></div>
          </section>}
        </>}
        {!isLoading ? <footer className="status-bar"><button className="refresh-button" disabled={isRefreshing || !holdings.length} onClick={() => void refreshQuotes(true)}><Icon name="refresh" />{isRefreshing ? "Refreshing prices…" : "Refresh prices"}</button><span>Last refreshed <strong>{lastRefreshText}</strong></span><label className="switch-label"><input type="checkbox" checked={settings.autoRefreshEnabled} onChange={(e) => void updateAutoRefresh(e.target.checked)} />Auto-refresh <span className="muted">/ 60s</span></label><span className="status-caption">LOCAL STORAGE · USD</span></footer> : null}
      </main>

      {planModal ? (
        <Modal message={message} title="Plan purchase" onClose={() => setPlanModal(null)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-300">Use this before buying. Enter a risk amount, risk percent, and expected/current price to estimate max investment and share count. You can save it as risk settings without adding any transaction.</p>
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <Field label="Symbol" value={planModal.symbol} onChange={(value) => setPlanModal({ ...planModal, symbol: value.toUpperCase(), quote: undefined })} placeholder="AAPL" />
              <div className="flex items-end"><button className="btn-secondary h-10" type="button" onClick={() => void fetchPlanQuote()} disabled={planModal.isFetchingQuote}>{planModal.isFetchingQuote ? "Fetching…" : "Use live price"}</button></div>
            </div>
            <label className="block text-sm text-slate-200">Bucket
              <select aria-label="Bucket" className="input mt-1" value={planModal.bucket} onChange={(e) => setPlanModal({ ...planModal, bucket: e.target.value as BucketType })}>
                <option value="long_term">Long-term</option>
                <option value="short_term">Short-term</option>
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Max risk amount" type="number" min={0} step="any" value={planModal.maxRiskAmount} onChange={(v) => setPlanModal({ ...planModal, maxRiskAmount: Number(v) })} />
              <Field label="Risk percent" type="number" min={0} step="any" value={planModal.riskPercent} onChange={(v) => setPlanModal({ ...planModal, riskPercent: Number(v) })} />
              <Field label="Share price" type="number" min={0} step="any" value={planModal.price} onChange={(v) => setPlanModal({ ...planModal, price: Number(v) })} />
            </div>
            <PlanResults plan={planModal} />
            <div className="flex flex-wrap gap-3">
              <button className="btn-primary flex-1" type="button" onClick={() => void savePlanAsRiskSettings()}>Save as risk settings</button>
              <button className="btn-secondary" type="button" onClick={() => { const symbol = planModal.symbol; const bucket = planModal.bucket; setPlanModal(null); openTransactionModal(symbol, bucket); }}>Add transaction instead</button>
              <button className="btn-secondary" type="button" onClick={() => setPlanModal(null)}>Close</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {transactionModal.open ? (
        <Modal message={message} title="Add transaction" onClose={closeTransactionModal}>
          <form onSubmit={(event) => void submitTransaction(event)} className="space-y-4">
            <p className="text-sm text-slate-300">Buys add to a position. Sells reduce it using average-cost accounting and record realized P&L.</p>
            <Field label="Symbol" value={transactionModal.form.symbol} onChange={(value) => setTransactionModal({ ...transactionModal, form: { ...transactionModal.form, symbol: value.toUpperCase() } })} placeholder="AAPL" />
            <label className="block text-sm text-slate-200">Transaction type
              <select aria-label="Transaction type" className="input mt-1" value={transactionModal.form.type} onChange={(e) => setTransactionModal({ ...transactionModal, form: { ...transactionModal.form, type: e.target.value as TransactionType } })}>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </label>
            <label className="block text-sm text-slate-200">Bucket
              <select aria-label="Bucket" className="input mt-1" value={transactionModal.form.bucket} onChange={(e) => setTransactionModal({ ...transactionModal, form: { ...transactionModal.form, bucket: e.target.value as BucketType } })}>
                <option value="long_term">Long-term</option>
                <option value="short_term">Short-term</option>
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Quantity" type="number" min={0} step="any" value={transactionModal.form.quantity} onChange={(v) => setTransactionModal({ ...transactionModal, form: { ...transactionModal.form, quantity: Number(v) } })} />
              <Field label={transactionModal.form.type === "sell" ? "Sell price" : "Buy price"} type="number" min={0} step="any" value={transactionModal.form.price} onChange={(v) => setTransactionModal({ ...transactionModal, form: { ...transactionModal.form, price: Number(v) } })} />
            </div>
            <Field label="Trade date" type="date" value={transactionModal.form.tradeDate} onChange={(v) => setTransactionModal({ ...transactionModal, form: { ...transactionModal.form, tradeDate: v } })} />
            <label className="block text-sm text-slate-200">Notes<textarea className="input mt-1 min-h-20" value={transactionModal.form.notes ?? ""} onChange={(e) => setTransactionModal({ ...transactionModal, form: { ...transactionModal.form, notes: e.target.value } })} placeholder="Optional transaction notes" /></label>
            <div className="flex gap-3">
              <button className="btn-primary flex-1" type="submit">Add {transactionModal.form.type}</button>
              <button className="btn-secondary" type="button" onClick={closeTransactionModal}>Cancel</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {riskModal ? (
        <Modal message={message} title={riskModal.holding.symbol + " " + bucketLabel(riskModal.bucket) + " settings"} onClose={() => setRiskModal(null)}>
          <form onSubmit={(event) => void submitRiskSettings(event)} className="space-y-4">
            <p className="text-sm text-slate-300">Risk and target settings are optional and apply only to this bucket. Transactions remain separate.</p>

            <TogglePanel
              label="Enable risk tracking"
              description="Calculate max investment, available capacity, and over/under status."
              checked={riskModal.riskEnabled}
              onChange={(checked) => setRiskModal({ ...riskModal, riskEnabled: checked })}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Max risk amount" type="number" min={0} step="any" value={riskModal.maxRiskAmount} onChange={(v) => setRiskModal({ ...riskModal, maxRiskAmount: Number(v) })} />
                <Field label="Risk percent" type="number" min={0} step="any" value={riskModal.riskPercent} onChange={(v) => setRiskModal({ ...riskModal, riskPercent: Number(v) })} />
              </div>
            </TogglePanel>

            <TogglePanel
              label="Enable target profit"
              description="Set a fixed sell price or calculate one as a percentage above average buy price."
              checked={riskModal.targetEnabled}
              onChange={(checked) => setRiskModal({ ...riskModal, targetEnabled: checked })}
            >
              <div className="space-y-4">
                <label className="block text-sm text-slate-200">Target type
                  <select aria-label="Target type" className="input mt-1" value={riskModal.targetMode} onChange={(e) => setRiskModal({ ...riskModal, targetMode: e.target.value as TargetMode })}>
                    <option value="percent">Percent above average buy</option>
                    <option value="price">Fixed target price</option>
                  </select>
                </label>
                {riskModal.targetMode === "percent"
                  ? <Field label="Target increase %" type="number" min={0} step="any" value={riskModal.targetProfitPercent} onChange={(v) => setRiskModal({ ...riskModal, targetProfitPercent: Number(v) })} />
                  : <Field label="Target price" type="number" min={0} step="any" value={riskModal.targetPrice} onChange={(v) => setRiskModal({ ...riskModal, targetPrice: Number(v) })} />}
              </div>
            </TogglePanel>

            <label className="block text-sm text-slate-200">Stock notes<textarea className="input mt-1 min-h-20" value={riskModal.notes} onChange={(e) => setRiskModal({ ...riskModal, notes: e.target.value })} placeholder="Optional stock notes" /></label>

            <div className="flex gap-3">
              <button className="btn-primary flex-1" type="submit">Save settings</button>
              <button className="btn-secondary" type="button" onClick={() => setRiskModal(null)}>Cancel</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

function TogglePanel({ label, description, checked, onChange, children }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void; children: React.ReactNode }) {
  return (
    <section className="form-panel">
      <label className="flex cursor-pointer items-start gap-3">
        <input className="mt-1" type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span><span className="block font-semibold text-white">{label}</span><span className="block text-sm text-slate-400">{description}</span></span>
      </label>
      {checked ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

function PlanResults({ plan }: { plan: PlanModalState }) {
  const maxValue = maxInvestmentValue(plan.maxRiskAmount, plan.riskPercent);
  const maxShares = maxValue !== undefined && plan.price > 0 ? Math.floor(maxValue / plan.price) : undefined;
  const plannedCapital = maxShares !== undefined ? maxShares * plan.price : undefined;
  const impliedRisk = plannedCapital !== undefined ? plannedCapital * (plan.riskPercent / 100) : undefined;
  const validation = validatePlan(plan);
  return (
    <section className="form-panel">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-white">Planning result</h3>
        {plan.quote?.fetchedAt ? <span className="text-xs text-slate-400">Quote {new Date(plan.quote.fetchedAt).toLocaleTimeString()}</span> : null}
      </div>
      {validation ? <p className="mb-3 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">{validation}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <MiniMetric label="Max investment" value={currency(maxValue)} />
        <MiniMetric label="Max shares" value={numberFmt(maxShares, 0)} />
        <MiniMetric label="Capital used by max shares" value={currency(plannedCapital)} />
        <MiniMetric label="Implied risk" value={currency(impliedRisk)} />
      </div>
      {maxShares !== undefined ? <p className="mt-3 text-sm text-slate-300">At {currency(plan.price)} per share, risking {currency(plan.maxRiskAmount)} at {percentFmt(plan.riskPercent)} allows up to <span className="font-semibold text-white">{numberFmt(maxShares, 0)} shares</span>.</p> : null}
    </section>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", min, step }: { label: string; value: string | number; onChange: (value: string) => void; placeholder?: string; type?: string; min?: number; step?: number | "any" }) {
  return <label className="block text-sm text-slate-200">{label}<input className="input mt-1" type={type} value={value} placeholder={placeholder} min={min} step={step} inputMode={type === "number" ? "decimal" : undefined} onChange={(e) => onChange(e.target.value)} /></label>;
}

function buildHoldingCards(holdings: Holding[], rows: HoldingBucketRow[], quotes: Record<string, StockQuote | undefined>, transactions: Transaction[]): HoldingCardView[] {
  return holdings.map((holding) => {
    const longTerm = rows.find((row) => row.holdingId === holding.id && row.bucket === "long_term");
    const shortTerm = rows.find((row) => row.holdingId === holding.id && row.bucket === "short_term");
    if (!longTerm || !shortTerm) throw new Error("Missing bucket row");
    const holdingTransactions = transactions.filter((transaction) => transaction.holdingId === holding.id);
    const value = quotes[holding.symbol] ? (longTerm.currentValue ?? 0) + (shortTerm.currentValue ?? 0) : longTerm.quantity + shortTerm.quantity === 0 ? 0 : undefined;
    const costBasis = sumWhenKnown(longTerm.costBasis, shortTerm.costBasis);
    const unrealizedGain = sumWhenKnown(longTerm.unrealizedGain, shortTerm.unrealizedGain);
    const realizedGain = sumWhenKnown(longTerm.realizedGain, shortTerm.realizedGain);
    const unrealizedGainPercent = costBasis !== undefined && unrealizedGain !== undefined && costBasis > 0 ? (unrealizedGain / costBasis) * 100 : undefined;
    return { holding, quote: quotes[holding.symbol], longTerm, shortTerm, transactions: holdingTransactions, totals: { quantity: longTerm.quantity + shortTerm.quantity, value, costBasis, unrealizedGain, unrealizedGainPercent, realizedGain } };
  });
}

function buildSummary(rows: HoldingBucketRow[]) {
  const summary = rows.reduce((acc, row) => {
    acc.totalValue += row.currentValue ?? 0;
    acc.totalCostBasis += row.costBasis ?? 0;
    acc.totalUnrealizedGain += row.unrealizedGain ?? 0;
    acc.totalRealizedGain += row.realizedGain ?? 0;
    if (row.realizedGain === undefined) acc.realizedGainKnown = false;
    if (row.status === "over_limit") acc.overLimitCount += 1;
    if (row.targetReached) acc.targetReachedCount += 1;
    if (row.quoteFetchedAt && (!acc.lastRefreshAt || row.quoteFetchedAt > acc.lastRefreshAt)) acc.lastRefreshAt = row.quoteFetchedAt;
    return acc;
  }, { totalValue: 0, totalCostBasis: 0, totalUnrealizedGain: 0, totalRealizedGain: 0, realizedGainKnown: true, overLimitCount: 0, targetReachedCount: 0, lastRefreshAt: "" });
  const missingQuote = rows.some((row) => row.quantity > 0 && row.currentPrice === undefined);
  const missingCost = rows.some((row) => row.quantity > 0 && row.costBasis === undefined);
  return { ...summary, totalValue: missingQuote ? undefined : summary.totalValue, totalCostBasis: missingCost ? undefined : summary.totalCostBasis, totalUnrealizedGain: missingQuote || missingCost ? undefined : summary.totalUnrealizedGain, totalRealizedGain: summary.realizedGainKnown ? summary.totalRealizedGain : undefined };
}

function sumWhenKnown(left: number | undefined, right: number | undefined): number | undefined {
  return left === undefined || right === undefined ? undefined : left + right;
}

function bucketLabel(bucket: BucketType) {
  return bucket === "long_term" ? "Long-term" : "Short-term";
}

function validateRiskModal(input: RiskModalState): string | null {
  if (input.riskEnabled && input.maxRiskAmount <= 0) return "Max risk amount must be greater than zero when risk tracking is enabled.";
  if (input.riskEnabled && input.riskPercent <= 0) return "Risk percent must be greater than zero when risk tracking is enabled.";
  if (input.targetEnabled && input.targetMode === "percent" && (!Number.isFinite(input.targetProfitPercent) || input.targetProfitPercent <= 0)) return "Target increase percent must be a finite number greater than zero.";
  if (input.targetEnabled && input.targetMode === "price" && (!Number.isFinite(input.targetPrice) || input.targetPrice <= 0)) return "Target price must be a finite number greater than zero.";
  if (input.maxRiskAmount < 0 || input.riskPercent < 0 || input.targetProfitPercent < 0 || input.targetPrice < 0) return "Risk and target values cannot be negative.";
  return null;
}

function validateTransaction(input: TransactionInput): string | null {
  const symbol = input.symbol.trim().toUpperCase();
  if (!/^[A-Z.\-]{1,10}$/.test(symbol)) return "Enter a valid US ticker symbol for the transaction.";
  if (input.quantity <= 0) return "Transaction quantity must be greater than zero.";
  if (input.price <= 0) return `${input.type === "sell" ? "Sell" : "Buy"} price must be greater than zero.`;
  if (!input.tradeDate) return "Trade date is required.";
  return null;
}


function validatePlan(input: PlanModalState): string | null {
  const symbol = input.symbol.trim().toUpperCase();
  if (!/^[A-Z.\-]{1,10}$/.test(symbol)) return "Enter a valid US ticker symbol.";
  if (input.maxRiskAmount <= 0) return "Max risk amount must be greater than zero.";
  if (input.riskPercent <= 0) return "Risk percent must be greater than zero.";
  if (input.price <= 0) return "Share price must be greater than zero. Enter one manually or fetch the live price.";
  return null;
}
