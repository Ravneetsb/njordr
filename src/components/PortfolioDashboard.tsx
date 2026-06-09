"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, BucketType, Holding, HoldingBucketRow, HoldingInput, StockQuote, Transaction, TransactionInput } from "@/lib/types";
import { buildBucketRows, currency, maxInvestmentValue, numberFmt, percentFmt } from "@/lib/risk";
import { portfolioRepository } from "@/lib/repositories/portfolioRepository";
import { fetchQuotes, isQuoteFresh } from "@/lib/quotes";

const today = () => new Date().toISOString().slice(0, 10);

const emptyTransactionForm = (symbol = "", bucket: BucketType = "short_term"): TransactionInput => ({
  symbol,
  bucket,
  quantity: 0,
  buyPrice: 0,
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
  targetProfitPercent: number;
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

type HoldingCardView = {
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
  };
};

export function PortfolioDashboard() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [quotes, setQuotes] = useState<Record<string, StockQuote | undefined>>({});
  const [settings, setSettings] = useState<AppSettings>({ autoRefreshEnabled: false, refreshIntervalSeconds: 60 });
  const [transactionModal, setTransactionModal] = useState<TransactionModalState>({ open: false, form: emptyTransactionForm() });
  const [riskModal, setRiskModal] = useState<RiskModalState | null>(null);
  const [planModal, setPlanModal] = useState<PlanModalState | null>(null);
  const [expandedTransactions, setExpandedTransactions] = useState<string | null>(null);
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
    setTransactionModal({ open: true, form: emptyTransactionForm(symbol, bucket) });
  }

  function closeTransactionModal() {
    setTransactionModal({ open: false, form: emptyTransactionForm() });
  }

  function openPlanModal(symbol = "", bucket: BucketType = "short_term") {
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
      longTermTargetProfitPercent: existing.longTermTargetProfitPercent ?? 0,
      shortTermQuantity: existing.shortTermQuantity,
      shortTermMaxRiskAmount: !isLongTerm ? planModal.maxRiskAmount : existing.shortTermMaxRiskAmount,
      shortTermRiskPercent: !isLongTerm ? planModal.riskPercent : existing.shortTermRiskPercent,
      shortTermTargetProfitPercent: existing.shortTermTargetProfitPercent ?? 0,
    } : {
      symbol,
      notes: "Planning-only risk record. Add transactions when you buy.",
      longTermQuantity: 0,
      longTermMaxRiskAmount: isLongTerm ? planModal.maxRiskAmount : 0,
      longTermRiskPercent: isLongTerm ? planModal.riskPercent : 0,
      longTermTargetProfitPercent: 0,
      shortTermQuantity: 0,
      shortTermMaxRiskAmount: !isLongTerm ? planModal.maxRiskAmount : 0,
      shortTermRiskPercent: !isLongTerm ? planModal.riskPercent : 0,
      shortTermTargetProfitPercent: 0,
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
    const isLongTerm = bucket === "long_term";
    const maxRiskAmount = isLongTerm ? holding.longTermMaxRiskAmount : holding.shortTermMaxRiskAmount;
    const riskPercent = isLongTerm ? holding.longTermRiskPercent : holding.shortTermRiskPercent;
    const targetProfitPercent = isLongTerm ? holding.longTermTargetProfitPercent ?? 0 : holding.shortTermTargetProfitPercent ?? 0;
    setRiskModal({
      holding,
      bucket,
      riskEnabled: maxRiskAmount > 0 && riskPercent > 0,
      maxRiskAmount,
      riskPercent,
      targetEnabled: targetProfitPercent > 0,
      targetProfitPercent,
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
      longTermTargetProfitPercent: isLongTerm ? (riskModal.targetEnabled ? riskModal.targetProfitPercent : 0) : riskModal.holding.longTermTargetProfitPercent ?? 0,
      shortTermQuantity: riskModal.holding.shortTermQuantity,
      shortTermMaxRiskAmount: !isLongTerm ? (riskModal.riskEnabled ? riskModal.maxRiskAmount : 0) : riskModal.holding.shortTermMaxRiskAmount,
      shortTermRiskPercent: !isLongTerm ? (riskModal.riskEnabled ? riskModal.riskPercent : 0) : riskModal.holding.shortTermRiskPercent,
      shortTermTargetProfitPercent: !isLongTerm ? (riskModal.targetEnabled ? riskModal.targetProfitPercent : 0) : riskModal.holding.shortTermTargetProfitPercent ?? 0,
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
    await portfolioRepository.deleteHolding(id);
    await reloadPortfolioData();
    setMessage(holding.symbol + " deleted.");
  }

  async function deleteTransaction(id: string) {
    const transaction = transactions.find((t) => t.id === id);
    if (!transaction || !window.confirm("Delete " + transaction.symbol + " " + bucketLabel(transaction.bucket) + " transaction?")) return;
    await portfolioRepository.deleteTransaction(id);
    await reloadPortfolioData();
    setMessage("Transaction deleted. Quantity, P&L, and risk were re-evaluated.");
  }

  async function updateAutoRefresh(enabled: boolean) {
    setSettings(await portfolioRepository.updateSettings({ ...settings, autoRefreshEnabled: enabled, refreshIntervalSeconds: 60 }));
  }

  async function exportBackup() {
    const backup = await portfolioRepository.exportBackup();
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "njordr-backup-" + today() + ".json";
    anchor.click();
    URL.revokeObjectURL(url);
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
    <main className="min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">Njordr</p>
            <h1 className="mt-2 text-4xl font-bold text-white">Stock Risk Assessment</h1>
            <p className="mt-2 max-w-2xl text-slate-300">Add buys first. Njordr calculates quantity, average cost, P&L, risk, and target status per long-term and short-term bucket.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => openTransactionModal()}>+ Add transaction</button>
            <button className="btn-secondary" onClick={() => openPlanModal()}>Plan purchase</button>
            <button className="btn-secondary" onClick={() => void refreshQuotes(true)} disabled={isRefreshing || holdings.length === 0}>{isRefreshing ? "Refreshing…" : "Refresh prices"}</button>
            <button className="btn-secondary" onClick={exportBackup}>Export JSON</button>
            <button className="btn-secondary" onClick={() => fileRef.current?.click()}>Import JSON</button>
            <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(event) => void importBackup(event)} />
          </div>
        </header>

        {message ? <div className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">{message}</div> : null}

        <section className="grid gap-4 md:grid-cols-3 lg:grid-cols-7">
          <SummaryCard label="Portfolio" value={currency(summary.totalValue)} />
          <SummaryCard label="Cost basis" value={currency(summary.totalCostBasis)} />
          <SummaryCard label="Unrealized P&L" value={currency(summary.totalUnrealizedGain)} danger={summary.totalUnrealizedGain < 0} good={summary.totalUnrealizedGain > 0} />
          <SummaryCard label="Transactions" value={String(transactions.length)} />
          <SummaryCard label="Over-limit" value={String(summary.overLimitCount)} danger={summary.overLimitCount > 0} />
          <SummaryCard label="Targets hit" value={String(summary.targetReachedCount)} good={summary.targetReachedCount > 0} />
          <SummaryCard label="Last refresh" value={lastRefreshText} />
        </section>

        <section className="card">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Portfolio</h2>
              <p className="text-sm text-slate-300">One card per stock. Use bucket actions for transactions, risk rules, and profit targets.</p>
            </div>
            <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
              <input type="checkbox" checked={settings.autoRefreshEnabled} onChange={(e) => void updateAutoRefresh(e.target.checked)} />
              Auto-refresh every 60s
            </label>
          </div>

          {cards.length === 0 ? (
            <EmptyState onAdd={() => openTransactionModal()} />
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {cards.map((card) => (
                <StockCard
                  key={card.holding.id}
                  card={card}
                  expandedTransactions={expandedTransactions === card.holding.id}
                  onToggleTransactions={() => setExpandedTransactions(expandedTransactions === card.holding.id ? null : card.holding.id)}
                  onAddTransaction={(bucket) => openTransactionModal(card.holding.symbol, bucket)}
                  onPlanPurchase={(bucket) => openPlanModal(card.holding.symbol, bucket)}
                  onEditRisk={(bucket) => openRiskModal(card.holding, bucket)}
                  onDeleteHolding={() => void deleteHolding(card.holding.id)}
                  onDeleteTransaction={(id) => void deleteTransaction(id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {planModal ? (
        <Modal title="Plan purchase" onClose={() => setPlanModal(null)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-300">Use this before buying. Enter a risk amount, risk percent, and expected/current price to estimate max investment and share count. You can save it as risk settings without adding any transaction.</p>
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <Field label="Symbol" value={planModal.symbol} onChange={(value) => setPlanModal({ ...planModal, symbol: value.toUpperCase(), quote: undefined })} placeholder="AAPL" />
              <div className="flex items-end"><button className="btn-secondary h-10" type="button" onClick={() => void fetchPlanQuote()} disabled={planModal.isFetchingQuote}>{planModal.isFetchingQuote ? "Fetching…" : "Use live price"}</button></div>
            </div>
            <label className="block text-sm text-slate-200">Bucket
              <select className="input mt-1" value={planModal.bucket} onChange={(e) => setPlanModal({ ...planModal, bucket: e.target.value as BucketType })}>
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
        <Modal title="Add transaction" onClose={closeTransactionModal}>
          <form onSubmit={(event) => void submitTransaction(event)} className="space-y-4">
            <p className="text-sm text-slate-300">This is the main workflow. Adding a buy updates quantity, average buy price, cost basis, P&L, and risk exposure automatically.</p>
            <Field label="Symbol" value={transactionModal.form.symbol} onChange={(value) => setTransactionModal({ ...transactionModal, form: { ...transactionModal.form, symbol: value.toUpperCase() } })} placeholder="AAPL" />
            <label className="block text-sm text-slate-200">Bucket
              <select className="input mt-1" value={transactionModal.form.bucket} onChange={(e) => setTransactionModal({ ...transactionModal, form: { ...transactionModal.form, bucket: e.target.value as BucketType } })}>
                <option value="long_term">Long-term</option>
                <option value="short_term">Short-term</option>
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Quantity" type="number" min={0} step="any" value={transactionModal.form.quantity} onChange={(v) => setTransactionModal({ ...transactionModal, form: { ...transactionModal.form, quantity: Number(v) } })} />
              <Field label="Buy price" type="number" min={0} step="any" value={transactionModal.form.buyPrice} onChange={(v) => setTransactionModal({ ...transactionModal, form: { ...transactionModal.form, buyPrice: Number(v) } })} />
            </div>
            <Field label="Trade date" type="date" value={transactionModal.form.tradeDate} onChange={(v) => setTransactionModal({ ...transactionModal, form: { ...transactionModal.form, tradeDate: v } })} />
            <label className="block text-sm text-slate-200">Notes<textarea className="input mt-1 min-h-20" value={transactionModal.form.notes ?? ""} onChange={(e) => setTransactionModal({ ...transactionModal, form: { ...transactionModal.form, notes: e.target.value } })} placeholder="Optional transaction notes" /></label>
            <div className="flex gap-3">
              <button className="btn-primary flex-1" type="submit">Add transaction</button>
              <button className="btn-secondary" type="button" onClick={closeTransactionModal}>Cancel</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {riskModal ? (
        <Modal title={riskModal.holding.symbol + " " + bucketLabel(riskModal.bucket) + " settings"} onClose={() => setRiskModal(null)}>
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
              description="Show a target sell price based on average buy price and flag when the current price reaches it."
              checked={riskModal.targetEnabled}
              onChange={(checked) => setRiskModal({ ...riskModal, targetEnabled: checked })}
            >
              <Field label="Target profit %" type="number" min={0} step="any" value={riskModal.targetProfitPercent} onChange={(v) => setRiskModal({ ...riskModal, targetProfitPercent: Number(v) })} />
            </TogglePanel>

            <label className="block text-sm text-slate-200">Stock notes<textarea className="input mt-1 min-h-20" value={riskModal.notes} onChange={(e) => setRiskModal({ ...riskModal, notes: e.target.value })} placeholder="Optional stock notes" /></label>

            <div className="flex gap-3">
              <button className="btn-primary flex-1" type="submit">Save settings</button>
              <button className="btn-secondary" type="button" onClick={() => setRiskModal(null)}>Cancel</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </main>
  );
}

function StockCard({
  card,
  expandedTransactions,
  onToggleTransactions,
  onAddTransaction,
  onPlanPurchase,
  onEditRisk,
  onDeleteHolding,
  onDeleteTransaction,
}: {
  card: HoldingCardView;
  expandedTransactions: boolean;
  onToggleTransactions: () => void;
  onAddTransaction: (bucket: BucketType) => void;
  onPlanPurchase: (bucket: BucketType) => void;
  onEditRisk: (bucket: BucketType) => void;
  onDeleteHolding: () => void;
  onDeleteTransaction: (id: string) => void;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-2xl font-bold text-white">{card.holding.symbol}</h3>
            <PriceCell quote={card.quote} />
          </div>
          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
            <MiniMetric label="Value" value={currency(card.totals.value)} />
            <MiniMetric label="Cost" value={currency(card.totals.costBasis)} />
            <MiniMetric label="P&L" value={<GainText amount={card.totals.unrealizedGain} percent={card.totals.unrealizedGainPercent} />} />
          </div>
          {card.holding.notes ? <p className="mt-3 text-sm text-slate-300">{card.holding.notes}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <button className="btn-secondary" onClick={() => onAddTransaction("short_term")}>Add buy</button>
          <button className="btn-secondary" onClick={onToggleTransactions}>{expandedTransactions ? "Hide tx" : "Transactions"}</button>
          <button className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-400/20" onClick={onDeleteHolding}>Delete</button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <BucketSummary row={card.longTerm} onAddTransaction={() => onAddTransaction("long_term")} onPlanPurchase={() => onPlanPurchase("long_term")} onEditRisk={() => onEditRisk("long_term")} />
        <BucketSummary row={card.shortTerm} onAddTransaction={() => onAddTransaction("short_term")} onPlanPurchase={() => onPlanPurchase("short_term")} onEditRisk={() => onEditRisk("short_term")} />
      </div>

      {expandedTransactions ? (
        <div className="mt-4 border-t border-white/10 pt-4">
          <h4 className="font-semibold text-white">Transactions</h4>
          {card.transactions.length === 0 ? <p className="mt-2 text-sm text-slate-400">No transactions for this stock yet.</p> : (
            <div className="mt-3 grid gap-2">
              {card.transactions.map((transaction) => (
                <div key={transaction.id} className="flex flex-col gap-2 rounded-xl bg-slate-950/50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="font-semibold text-white">{bucketLabel(transaction.bucket)}</span>
                    <span className="text-slate-400"> · {transaction.tradeDate} · {numberFmt(transaction.quantity)} shares @ {currency(transaction.buyPrice)} · Cost {currency(transaction.quantity * transaction.buyPrice)}</span>
                    {transaction.notes ? <div className="text-slate-300">{transaction.notes}</div> : null}
                  </div>
                  <button className="self-start text-rose-300 hover:text-rose-100 sm:self-auto" onClick={() => onDeleteTransaction(transaction.id)}>Delete</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}

function BucketSummary({ row, onAddTransaction, onPlanPurchase, onEditRisk }: { row: HoldingBucketRow; onAddTransaction: () => void; onPlanPurchase: () => void; onEditRisk: () => void }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-white">{row.bucketLabel}</h4>
          <p className="text-xs text-slate-400">{row.transactionCount} transaction{row.transactionCount === 1 ? "" : "s"}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={row.status} />
          {row.targetReached ? <span className="rounded-full border border-fuchsia-400/30 bg-fuchsia-400/15 px-2.5 py-1 text-xs font-semibold text-fuchsia-200">Target hit</span> : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <MiniMetric label="Qty" value={numberFmt(row.quantity)} />
        <MiniMetric label="Avg buy" value={currency(row.averageBuyPrice)} />
        <MiniMetric label="Value" value={currency(row.currentValue)} />
        <MiniMetric label="P&L" value={<GainText amount={row.unrealizedGain} percent={row.unrealizedGainPercent} />} />
      </div>

      <div className="mt-3 space-y-2 rounded-xl bg-white/[0.03] p-3 text-sm">
        <div className="flex justify-between gap-3"><span className="text-slate-400">Risk</span><span className="text-right font-medium text-slate-100">{riskSummary(row)}</span></div>
        <div className="flex justify-between gap-3"><span className="text-slate-400">Target</span><span className="text-right font-medium text-slate-100">{targetSummary(row)}</span></div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="rounded-xl bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200" onClick={onAddTransaction}>Add {row.bucket === "long_term" ? "LT" : "ST"} buy</button>
        <button className="btn-secondary text-sm" onClick={onPlanPurchase}>Plan</button>
        <button className="btn-secondary text-sm" onClick={onEditRisk}>Risk / target</button>
      </div>
    </section>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-10 text-center">
      <h3 className="text-xl font-semibold text-white">No holdings yet</h3>
      <p className="mx-auto mt-2 max-w-lg text-slate-300">Start by adding a transaction. The app will create the stock record, classify it as long-term or short-term, and calculate quantity, average buy price, P&L, and risk status.</p>
      <button className="btn-primary mt-5" onClick={onAdd}>+ Add your first transaction</button>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-slate-950 p-5 shadow-2xl shadow-black/40">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          <button className="rounded-lg px-2 py-1 text-slate-300 hover:bg-white/10 hover:text-white" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function TogglePanel({ label, description, checked, onChange, children }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
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
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
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

function SummaryCard({ label, value, danger = false, good = false }: { label: string; value: string; danger?: boolean; good?: boolean }) {
  const cls = danger ? "border-rose-400/30 bg-rose-400/10" : good ? "border-emerald-400/30 bg-emerald-400/10" : "border-white/10 bg-white/5";
  return <div className={"rounded-2xl border p-4 " + cls}><p className="text-xs uppercase tracking-wider text-slate-400">{label}</p><p className="mt-2 text-2xl font-bold text-white">{value}</p></div>;
}

function MiniMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-xl bg-slate-950/50 p-3"><div className="text-xs uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 break-words font-semibold text-slate-100">{value}</div></div>;
}

function Field({ label, value, onChange, placeholder, type = "text", min, step }: { label: string; value: string | number; onChange: (value: string) => void; placeholder?: string; type?: string; min?: number; step?: number | "any" }) {
  return <label className="block text-sm text-slate-200">{label}<input className="input mt-1" type={type} value={value} placeholder={placeholder} min={min} step={step} inputMode={type === "number" ? "decimal" : undefined} onChange={(e) => onChange(e.target.value)} /></label>;
}

function PriceCell({ quote }: { quote?: StockQuote }) {
  return <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm font-semibold text-slate-100">{currency(quote?.currentPrice)}{quote?.fetchedAt ? <span className={"ml-2 text-xs " + (isQuoteStale(quote) ? "text-amber-300" : "text-slate-400")}>{isQuoteStale(quote) ? "Stale" : "Live"}</span> : <span className="ml-2 text-xs text-slate-500">No quote</span>}</div>;
}

function GainText({ amount, percent }: { amount?: number; percent?: number }) {
  const color = amount === undefined ? "text-slate-100" : amount >= 0 ? "text-emerald-200" : "text-rose-200";
  return <span className={color}>{currency(amount)} <span className="text-xs text-slate-400">({percentFmt(percent)})</span></span>;
}

function StatusBadge({ status }: { status: HoldingBucketRow["status"] }) {
  const styles = { over_limit: "bg-rose-400/15 text-rose-200 border-rose-400/30", under_limit: "bg-emerald-400/15 text-emerald-200 border-emerald-400/30", no_position: "bg-slate-400/10 text-slate-300 border-slate-400/20", record_only: "bg-sky-400/15 text-sky-200 border-sky-400/30", incomplete: "bg-amber-400/15 text-amber-200 border-amber-400/30" };
  const labels = { over_limit: "Over", under_limit: "Under", no_position: "No position", record_only: "Record", incomplete: "Incomplete" };
  return <span className={"rounded-full border px-2.5 py-1 text-xs font-semibold " + styles[status]}>{labels[status]}</span>;
}

function riskSummary(row: HoldingBucketRow) {
  if (row.status === "no_position") return "No position";
  if (row.status === "record_only") return "Not tracked";
  if (row.remainingCapacity === undefined) return "Needs quote";
  if (row.remainingCapacity >= 0) return currency(row.remainingCapacity) + " capacity left";
  return currency(Math.abs(row.remainingCapacity)) + " over limit";
}

function targetSummary(row: HoldingBucketRow) {
  if (!row.targetProfitPercent || row.targetProfitPercent <= 0) return "No target";
  if (row.targetSellPrice === undefined) return percentFmt(row.targetProfitPercent) + " target; needs avg buy";
  if (row.targetReached) return "Hit at " + currency(row.targetSellPrice);
  if (row.currentPrice === undefined) return "Target " + currency(row.targetSellPrice);
  const remaining = row.targetSellPrice - row.currentPrice;
  const remainingPercent = row.currentPrice > 0 ? (remaining / row.currentPrice) * 100 : undefined;
  return currency(row.targetSellPrice) + " · " + percentFmt(remainingPercent) + " away";
}

function buildHoldingCards(holdings: Holding[], rows: HoldingBucketRow[], quotes: Record<string, StockQuote | undefined>, transactions: Transaction[]): HoldingCardView[] {
  return holdings.map((holding) => {
    const longTerm = rows.find((row) => row.holdingId === holding.id && row.bucket === "long_term");
    const shortTerm = rows.find((row) => row.holdingId === holding.id && row.bucket === "short_term");
    if (!longTerm || !shortTerm) throw new Error("Missing bucket row");
    const holdingTransactions = transactions.filter((transaction) => transaction.holdingId === holding.id);
    const value = (longTerm.currentValue ?? 0) + (shortTerm.currentValue ?? 0);
    const costBasis = (longTerm.costBasis ?? 0) + (shortTerm.costBasis ?? 0);
    const unrealizedGain = (longTerm.unrealizedGain ?? 0) + (shortTerm.unrealizedGain ?? 0);
    const unrealizedGainPercent = costBasis > 0 ? (unrealizedGain / costBasis) * 100 : undefined;
    return { holding, quote: quotes[holding.symbol], longTerm, shortTerm, transactions: holdingTransactions, totals: { quantity: longTerm.quantity + shortTerm.quantity, value, costBasis, unrealizedGain, unrealizedGainPercent } };
  });
}

function buildSummary(rows: HoldingBucketRow[]) {
  return rows.reduce((acc, row) => {
    acc.totalValue += row.currentValue ?? 0;
    acc.totalCostBasis += row.costBasis ?? 0;
    acc.totalUnrealizedGain += row.unrealizedGain ?? 0;
    if (row.status === "over_limit") acc.overLimitCount += 1;
    if (row.targetReached) acc.targetReachedCount += 1;
    if (row.quoteFetchedAt && (!acc.lastRefreshAt || row.quoteFetchedAt > acc.lastRefreshAt)) acc.lastRefreshAt = row.quoteFetchedAt;
    return acc;
  }, { totalValue: 0, totalCostBasis: 0, totalUnrealizedGain: 0, overLimitCount: 0, targetReachedCount: 0, lastRefreshAt: "" });
}

function isQuoteStale(quote: StockQuote) {
  return Date.now() - new Date(quote.fetchedAt).getTime() > 2 * 60 * 1000;
}

function bucketLabel(bucket: BucketType) {
  return bucket === "long_term" ? "Long-term" : "Short-term";
}

function validateRiskModal(input: RiskModalState): string | null {
  if (input.riskEnabled && input.maxRiskAmount <= 0) return "Max risk amount must be greater than zero when risk tracking is enabled.";
  if (input.riskEnabled && input.riskPercent <= 0) return "Risk percent must be greater than zero when risk tracking is enabled.";
  if (input.targetEnabled && input.targetProfitPercent <= 0) return "Target profit percent must be greater than zero when target profit is enabled.";
  if (input.maxRiskAmount < 0 || input.riskPercent < 0 || input.targetProfitPercent < 0) return "Risk and target values cannot be negative.";
  return null;
}

function validateTransaction(input: TransactionInput): string | null {
  const symbol = input.symbol.trim().toUpperCase();
  if (!/^[A-Z.\-]{1,10}$/.test(symbol)) return "Enter a valid US ticker symbol for the transaction.";
  if (input.quantity <= 0) return "Transaction quantity must be greater than zero.";
  if (input.buyPrice <= 0) return "Buy price must be greater than zero.";
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
