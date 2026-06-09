"use client";

import { db, DEFAULT_SETTINGS } from "@/lib/db";
import type { AppSettings, CachedQuote, BucketType, Holding, HoldingInput, PortfolioBackup, StockQuote, Transaction, TransactionInput } from "@/lib/types";

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
    return (await db.transactions.orderBy("tradeDate").reverse().toArray()).map(normalizeTransaction);
  }

  async createTransaction(input: TransactionInput): Promise<Transaction> {
    const normalized = sanitizeTransactionInput(input);
    const now = new Date().toISOString();
    let created!: Transaction;
    await db.transaction("rw", db.holdings, db.transactions, async () => {
      let holding = await db.holdings.where("symbol").equals(normalized.symbol).first();
      if (!holding) {
        holding = blankHolding(normalized.symbol, now);
        await db.holdings.add(holding);
      }
      created = { ...normalized, id: crypto.randomUUID(), holdingId: holding.id, createdAt: now, updatedAt: now };
      await db.transactions.add(created);
      await db.holdings.put(addQuantityToHolding(normalizeHolding(holding), normalized.bucket, normalized.quantity, now));
    });
    return created;
  }

  async deleteTransaction(id: string): Promise<void> {
    await db.transaction("rw", db.holdings, db.transactions, async () => {
      const existing = await db.transactions.get(id);
      if (!existing) return;
      const holding = await db.holdings.get(existing.holdingId);
      await db.transactions.delete(id);
      if (holding) await db.holdings.put(addQuantityToHolding(normalizeHolding(holding), existing.bucket, -existing.quantity, new Date().toISOString()));
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
    return { version: 2, exportedAt: new Date().toISOString(), holdings: await this.getHoldings(), transactions: await this.getTransactions(), settings: await this.getSettings() };
  }

  async importBackup(backup: PortfolioBackup): Promise<void> {
    if (![1, 2].includes(backup.version) || !Array.isArray(backup.holdings)) throw new Error("Unsupported backup file");
    await db.transaction("rw", db.holdings, db.transactions, db.settings, db.quoteCache, async () => {
      await db.holdings.clear();
      await db.transactions.clear();
      await db.quoteCache.clear();
      await db.holdings.bulkPut(backup.holdings.map(normalizeHolding));
      if (backup.transactions?.length) await db.transactions.bulkPut(backup.transactions.map(normalizeTransaction));
      await db.settings.put({ id: "app", ...(backup.settings ?? DEFAULT_SETTINGS), refreshIntervalSeconds: 60 });
    });
  }
}

function blankHolding(symbol: string, now: string): Holding {
  return { id: crypto.randomUUID(), symbol, notes: undefined, longTermQuantity: 0, longTermMaxRiskAmount: 0, longTermRiskPercent: 0, longTermTargetProfitPercent: 0, shortTermQuantity: 0, shortTermMaxRiskAmount: 0, shortTermRiskPercent: 0, shortTermTargetProfitPercent: 0, createdAt: now, updatedAt: now };
}

function addQuantityToHolding(holding: Holding, bucket: BucketType, quantityDelta: number, updatedAt: string): Holding {
  if (bucket === "long_term") return { ...holding, longTermQuantity: Math.max(0, nonNegativeNumber(holding.longTermQuantity) + quantityDelta), updatedAt };
  return { ...holding, shortTermQuantity: Math.max(0, nonNegativeNumber(holding.shortTermQuantity) + quantityDelta), updatedAt };
}

function sanitizeInput(input: HoldingInput): HoldingInput {
  return { symbol: input.symbol.trim().toUpperCase(), notes: input.notes?.trim() || undefined, longTermQuantity: nonNegative(input.longTermQuantity), longTermMaxRiskAmount: nonNegative(input.longTermMaxRiskAmount), longTermRiskPercent: nonNegative(input.longTermRiskPercent), longTermTargetProfitPercent: nonNegative(input.longTermTargetProfitPercent ?? 0), shortTermQuantity: nonNegative(input.shortTermQuantity), shortTermMaxRiskAmount: nonNegative(input.shortTermMaxRiskAmount), shortTermRiskPercent: nonNegative(input.shortTermRiskPercent), shortTermTargetProfitPercent: nonNegative(input.shortTermTargetProfitPercent ?? 0) };
}

function sanitizeTransactionInput(input: TransactionInput): TransactionInput {
  return { symbol: input.symbol.trim().toUpperCase(), bucket: input.bucket, quantity: nonNegative(input.quantity), buyPrice: nonNegative(input.buyPrice), tradeDate: input.tradeDate || new Date().toISOString().slice(0, 10), notes: input.notes?.trim() || undefined };
}

function normalizeHolding(holding: Holding): Holding {
  return { ...holding, symbol: holding.symbol.toUpperCase(), notes: holding.notes || undefined, longTermQuantity: nonNegativeNumber(holding.longTermQuantity), longTermMaxRiskAmount: nonNegativeNumber(holding.longTermMaxRiskAmount), longTermRiskPercent: nonNegativeNumber(holding.longTermRiskPercent), longTermTargetProfitPercent: nonNegativeNumber(holding.longTermTargetProfitPercent ?? 0), shortTermQuantity: nonNegativeNumber(holding.shortTermQuantity), shortTermMaxRiskAmount: nonNegativeNumber(holding.shortTermMaxRiskAmount), shortTermRiskPercent: nonNegativeNumber(holding.shortTermRiskPercent), shortTermTargetProfitPercent: nonNegativeNumber(holding.shortTermTargetProfitPercent ?? 0) };
}

function normalizeTransaction(transaction: Transaction): Transaction {
  return { ...transaction, symbol: transaction.symbol.toUpperCase(), notes: transaction.notes || undefined };
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function nonNegativeNumber(value: number | undefined): number {
  return Number.isFinite(value) && value && value > 0 ? value : 0;
}

export const portfolioRepository = new DexiePortfolioRepository();
