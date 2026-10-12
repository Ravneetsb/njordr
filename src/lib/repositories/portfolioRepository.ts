"use client";

import { db, DEFAULT_SETTINGS } from "@/lib/db";
import { analyzeBucketTransactions, signedQuantity } from "@/lib/tradeAccounting";
import type { AppSettings, CachedQuote, BucketType, Holding, HoldingInput, PortfolioBackup, StockQuote, TargetMode, Transaction, TransactionInput, TransactionType } from "@/lib/types";

type StoredTransaction = Omit<Transaction, "type" | "price"> & { type?: TransactionType; price?: number; buyPrice?: number };

export interface PortfolioRepository {
  getHoldings(): Promise<Holding[]>;
  createHolding(input: HoldingInput): Promise<Holding>;
  updateHolding(id: string, input: HoldingInput): Promise<Holding>;
  deleteHolding(id: string): Promise<void>;
  getTransactions(): Promise<Transaction[]>;
  createTransaction(input: TransactionInput): Promise<Transaction>;
  deleteTransaction(id: string): Promise<void>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: AppSettings): Promise<AppSettings>;
  getCachedQuotes(symbols: string[]): Promise<Record<string, StockQuote | undefined>>;
  saveQuotes(quotes: StockQuote[]): Promise<void>;
  exportBackup(): Promise<PortfolioBackup>;
  importBackup(backup: PortfolioBackup): Promise<void>;
}

export class DexiePortfolioRepository implements PortfolioRepository {
  async getHoldings(): Promise<Holding[]> {
    return (await db.holdings.orderBy("symbol").toArray()).map(normalizeHolding);
  }

  async createHolding(input: HoldingInput): Promise<Holding> {
    const now = new Date().toISOString();
    const holding: Holding = { ...sanitizeInput(input), id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    await db.holdings.add(holding);
    return holding;
  }

  async updateHolding(id: string, input: HoldingInput): Promise<Holding> {
    const existing = await db.holdings.get(id);
    if (!existing) throw new Error("Holding not found");
    const holding: Holding = { ...normalizeHolding(existing), ...sanitizeInput(input), id, updatedAt: new Date().toISOString() };
    await db.holdings.put(holding);
    return holding;
  }

  async deleteHolding(id: string): Promise<void> {
    await db.transaction("rw", db.holdings, db.transactions, async () => {
      await db.holdings.delete(id);
      await db.transactions.where("holdingId").equals(id).delete();
    });
  }

  async getTransactions(): Promise<Transaction[]> {
    return (await db.transactions.orderBy("tradeDate").reverse().toArray()).map((transaction) => normalizeTransaction(transaction));
  }

  async createTransaction(input: TransactionInput): Promise<Transaction> {
    const normalized = sanitizeTransactionInput(input);
    const now = new Date().toISOString();
    let created!: Transaction;
    await db.transaction("rw", db.holdings, db.transactions, async () => {
      let holding = await db.holdings.where("symbol").equals(normalized.symbol).first();
      if (!holding) {
        if (normalized.type === "sell") throw new Error("Cannot sell a stock that is not in the portfolio.");
        holding = blankHolding(normalized.symbol, now);
        await db.holdings.add(holding);
      }
      holding = normalizeHolding(holding);
      created = { ...normalized, id: crypto.randomUUID(), holdingId: holding.id, createdAt: now, updatedAt: now };
      const existingTransactions = (await db.transactions.where("holdingId").equals(holding.id).toArray()).map((transaction) => normalizeTransaction(transaction));
      const quantityDelta = signedQuantity(created);
      const updatedHolding = addQuantityToHolding(holding, normalized.bucket, quantityDelta, now);
      assertValidHistory(updatedHolding, [...existingTransactions, created], normalized.bucket);
      await db.transactions.add(created);
      await db.holdings.put(updatedHolding);
    });
    return created;
  }

  async deleteTransaction(id: string): Promise<void> {
    await db.transaction("rw", db.holdings, db.transactions, async () => {
      const stored = await db.transactions.get(id);
      const existing = stored ? normalizeTransaction(stored) : undefined;
      if (!existing) return;
      const storedHolding = await db.holdings.get(existing.holdingId);
      const holding = storedHolding ? normalizeHolding(storedHolding) : undefined;
      if (holding) {
        const remainingTransactions = (await db.transactions.where("holdingId").equals(holding.id).toArray())
          .filter((transaction) => transaction.id !== id)
          .map((transaction) => normalizeTransaction(transaction));
        const updatedHolding = addQuantityToHolding(holding, existing.bucket, -signedQuantity(existing), new Date().toISOString());
        assertValidHistory(updatedHolding, remainingTransactions, existing.bucket);
        await db.holdings.put(updatedHolding);
      }
      await db.transactions.delete(id);
    });
  }

  async getSettings(): Promise<AppSettings> {
    const row = await db.settings.get("app");
    return row ? { autoRefreshEnabled: row.autoRefreshEnabled, refreshIntervalSeconds: row.refreshIntervalSeconds } : DEFAULT_SETTINGS;
  }

  async updateSettings(settings: AppSettings): Promise<AppSettings> {
    const normalized = { autoRefreshEnabled: settings.autoRefreshEnabled, refreshIntervalSeconds: 60 };
    await db.settings.put({ id: "app", ...normalized });
    return normalized;
  }

  async getCachedQuotes(symbols: string[]): Promise<Record<string, StockQuote | undefined>> {
    const uniqueSymbols = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
    const rows = await db.quoteCache.bulkGet(uniqueSymbols);
    return Object.fromEntries(uniqueSymbols.map((symbol, index) => [symbol, rows[index]?.quote]));
  }

  async saveQuotes(quotes: StockQuote[]): Promise<void> {
    await db.quoteCache.bulkPut(quotes.map((quote) => ({ symbol: quote.symbol.toUpperCase(), quote, fetchedAt: quote.fetchedAt } as CachedQuote)));
  }

  async exportBackup(): Promise<PortfolioBackup> {
    return { version: 4, exportedAt: new Date().toISOString(), holdings: await this.getHoldings(), transactions: await this.getTransactions(), settings: await this.getSettings() };
  }

  async importBackup(backup: PortfolioBackup): Promise<void> {
    if (![1, 2, 3, 4].includes(backup.version) || !Array.isArray(backup.holdings)) throw new Error("Unsupported backup file");
    const holdings = backup.holdings.map(normalizeHolding);
    const storedTransactions = backup.transactions ?? [];
    if (backup.version >= 3 && storedTransactions.some((transaction) => !isValidStoredTransaction(transaction))) throw new Error("Backup contains an invalid transaction.");
    const transactions = storedTransactions.map((transaction) => normalizeTransaction(transaction));
    const holdingIds = new Set(holdings.map((holding) => holding.id));
    if (transactions.some((transaction) => !holdingIds.has(transaction.holdingId))) throw new Error("Backup contains a transaction without a matching holding.");
    for (const holding of holdings) {
      const holdingTransactions = transactions.filter((transaction) => transaction.holdingId === holding.id);
      assertValidHistory(holding, holdingTransactions, "long_term");
      assertValidHistory(holding, holdingTransactions, "short_term");
    }
    await db.transaction("rw", db.holdings, db.transactions, db.settings, db.quoteCache, async () => {
      await db.holdings.clear();
      await db.transactions.clear();
      await db.quoteCache.clear();
      await db.holdings.bulkPut(holdings);
      if (transactions.length) await db.transactions.bulkPut(transactions);
      await db.settings.put({ id: "app", ...(backup.settings ?? DEFAULT_SETTINGS), refreshIntervalSeconds: 60 });
    });
  }
}

function blankHolding(symbol: string, now: string): Holding {
  return { id: crypto.randomUUID(), symbol, notes: undefined, longTermQuantity: 0, longTermMaxRiskAmount: 0, longTermRiskPercent: 0, longTermTargetEnabled: false, longTermTargetMode: "percent", longTermTargetProfitPercent: 0, longTermTargetPrice: 0, shortTermQuantity: 0, shortTermMaxRiskAmount: 0, shortTermRiskPercent: 0, shortTermTargetEnabled: false, shortTermTargetMode: "percent", shortTermTargetProfitPercent: 0, shortTermTargetPrice: 0, createdAt: now, updatedAt: now };
}

function addQuantityToHolding(holding: Holding, bucket: BucketType, quantityDelta: number, updatedAt: string): Holding {
  if (bucket === "long_term") return { ...holding, longTermQuantity: nonNegativeNumber(holding.longTermQuantity) + quantityDelta, updatedAt };
  return { ...holding, shortTermQuantity: nonNegativeNumber(holding.shortTermQuantity) + quantityDelta, updatedAt };
}

function sanitizeInput(input: HoldingInput): HoldingInput {
  const longTermTargetProfitPercent = nonNegative(input.longTermTargetProfitPercent ?? 0);
  const longTermTargetPrice = nonNegative(input.longTermTargetPrice ?? 0);
  const shortTermTargetProfitPercent = nonNegative(input.shortTermTargetProfitPercent ?? 0);
  const shortTermTargetPrice = nonNegative(input.shortTermTargetPrice ?? 0);
  return { symbol: input.symbol.trim().toUpperCase(), notes: input.notes?.trim() || undefined, longTermQuantity: nonNegative(input.longTermQuantity), longTermMaxRiskAmount: nonNegative(input.longTermMaxRiskAmount), longTermRiskPercent: nonNegative(input.longTermRiskPercent), longTermTargetEnabled: input.longTermTargetEnabled ?? longTermTargetProfitPercent > 0, longTermTargetMode: targetMode(input.longTermTargetMode), longTermTargetProfitPercent, longTermTargetPrice, shortTermQuantity: nonNegative(input.shortTermQuantity), shortTermMaxRiskAmount: nonNegative(input.shortTermMaxRiskAmount), shortTermRiskPercent: nonNegative(input.shortTermRiskPercent), shortTermTargetEnabled: input.shortTermTargetEnabled ?? shortTermTargetProfitPercent > 0, shortTermTargetMode: targetMode(input.shortTermTargetMode), shortTermTargetProfitPercent, shortTermTargetPrice };
}

function sanitizeTransactionInput(input: TransactionInput): TransactionInput {
  return { symbol: input.symbol.trim().toUpperCase(), bucket: input.bucket, type: input.type === "sell" ? "sell" : "buy", quantity: nonNegative(input.quantity), price: nonNegative(input.price), tradeDate: input.tradeDate || new Date().toISOString().slice(0, 10), notes: input.notes?.trim() || undefined };
}

function normalizeHolding(holding: Holding): Holding {
  const longTermTargetProfitPercent = nonNegativeNumber(holding.longTermTargetProfitPercent ?? 0);
  const shortTermTargetProfitPercent = nonNegativeNumber(holding.shortTermTargetProfitPercent ?? 0);
  return { ...holding, symbol: holding.symbol.toUpperCase(), notes: holding.notes || undefined, longTermQuantity: nonNegativeNumber(holding.longTermQuantity), longTermMaxRiskAmount: nonNegativeNumber(holding.longTermMaxRiskAmount), longTermRiskPercent: nonNegativeNumber(holding.longTermRiskPercent), longTermTargetEnabled: holding.longTermTargetEnabled ?? longTermTargetProfitPercent > 0, longTermTargetMode: targetMode(holding.longTermTargetMode), longTermTargetProfitPercent, longTermTargetPrice: nonNegativeNumber(holding.longTermTargetPrice ?? 0), shortTermQuantity: nonNegativeNumber(holding.shortTermQuantity), shortTermMaxRiskAmount: nonNegativeNumber(holding.shortTermMaxRiskAmount), shortTermRiskPercent: nonNegativeNumber(holding.shortTermRiskPercent), shortTermTargetEnabled: holding.shortTermTargetEnabled ?? shortTermTargetProfitPercent > 0, shortTermTargetMode: targetMode(holding.shortTermTargetMode), shortTermTargetProfitPercent, shortTermTargetPrice: nonNegativeNumber(holding.shortTermTargetPrice ?? 0) };
}

function targetMode(value: TargetMode | undefined): TargetMode {
  return value === "price" ? "price" : "percent";
}

function normalizeTransaction(transaction: Transaction | StoredTransaction): Transaction {
  const stored = transaction as StoredTransaction;
  const current = { ...stored };
  delete current.buyPrice;
  return { ...current, type: stored.type === "sell" ? "sell" : "buy", price: nonNegativeNumber(stored.price ?? stored.buyPrice), symbol: transaction.symbol.toUpperCase(), notes: transaction.notes || undefined };
}

function assertValidHistory(holding: Holding, transactions: Transaction[], bucket: BucketType): void {
  const currentQuantity = bucket === "long_term" ? holding.longTermQuantity : holding.shortTermQuantity;
  const accounting = analyzeBucketTransactions(transactions, bucket, currentQuantity);
  if (accounting.invalidTransaction) {
    const transaction = accounting.invalidTransaction;
    throw new Error(`Cannot ${transaction.type} ${transaction.quantity} ${transaction.symbol} shares on ${transaction.tradeDate}; only ${accounting.quantity} shares are available in the ${bucket === "long_term" ? "long-term" : "short-term"} bucket.`);
  }
}

function isValidStoredTransaction(transaction: Transaction | StoredTransaction): boolean {
  const stored = transaction as StoredTransaction;
  return (stored.type === "buy" || stored.type === "sell")
    && Number.isFinite(stored.quantity) && stored.quantity > 0
    && Number.isFinite(stored.price) && (stored.price ?? 0) > 0
    && Boolean(stored.tradeDate);
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function nonNegativeNumber(value: number | undefined): number {
  return Number.isFinite(value) && value && value > 0 ? value : 0;
}

export const portfolioRepository = new DexiePortfolioRepository();
