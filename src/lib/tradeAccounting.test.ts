import { describe, expect, it } from "vitest";
import { analyzeBucketTransactions } from "./tradeAccounting";
import type { Transaction, TransactionType } from "./types";

function trade(id: string, type: TransactionType, quantity: number, price: number, tradeDate: string): Transaction {
  return {
    id,
    holdingId: "holding-1",
    symbol: "TEST",
    bucket: "short_term",
    type,
    quantity,
    price,
    tradeDate,
    createdAt: `${tradeDate}T12:00:00.000Z`,
    updatedAt: `${tradeDate}T12:00:00.000Z`,
  };
}

describe("analyzeBucketTransactions", () => {
  it("uses average cost for a partial sell and records realized gain", () => {
    const transactions = [
      trade("1", "buy", 10, 100, "2026-01-01"),
      trade("2", "buy", 10, 200, "2026-01-02"),
      trade("3", "sell", 5, 180, "2026-01-03"),
    ];

    const result = analyzeBucketTransactions(transactions, "short_term", 15);

    expect(result.invalidTransaction).toBeUndefined();
    expect(result.quantity).toBe(15);
    expect(result.averageBuyPrice).toBe(150);
    expect(result.costBasis).toBe(2250);
    expect(result.realizedGain).toBe(150);
    expect(result.realizedGainByTransactionId["3"]).toBe(150);
  });

  it("clears basis when closed and starts fresh when reopened", () => {
    const transactions = [
      trade("1", "buy", 10, 100, "2026-01-01"),
      trade("2", "sell", 10, 120, "2026-01-02"),
      trade("3", "buy", 2, 50, "2026-01-03"),
    ];

    const result = analyzeBucketTransactions(transactions, "short_term", 2);

    expect(result.quantity).toBe(2);
    expect(result.averageBuyPrice).toBe(50);
    expect(result.costBasis).toBe(100);
    expect(result.realizedGain).toBe(200);
  });

  it("records realized losses and keeps buckets independent", () => {
    const shortTermBuy = trade("1", "buy", 4, 100, "2026-01-01");
    const shortTermSell = trade("2", "sell", 2, 80, "2026-01-02");
    const longTermBuy = { ...trade("3", "buy", 7, 50, "2026-01-01"), bucket: "long_term" as const };
    const transactions = [shortTermBuy, shortTermSell, longTermBuy];

    const shortTerm = analyzeBucketTransactions(transactions, "short_term", 2);
    const longTerm = analyzeBucketTransactions(transactions, "long_term", 7);

    expect(shortTerm.realizedGain).toBe(-40);
    expect(shortTerm.quantity).toBe(2);
    expect(longTerm.realizedGain).toBe(0);
    expect(longTerm.quantity).toBe(7);
    expect(longTerm.averageBuyPrice).toBe(50);
  });

  it("rejects a sell that precedes the shares needed to cover it", () => {
    const transactions = [
      trade("buy", "buy", 10, 100, "2026-01-02"),
      trade("sell", "sell", 5, 110, "2026-01-01"),
    ];

    const result = analyzeBucketTransactions(transactions, "short_term", 5);

    expect(result.invalidTransaction?.id).toBe("sell");
    expect(result.quantity).toBe(0);
  });

  it("uses creation order for transactions on the same date", () => {
    const sell = { ...trade("sell", "sell", 5, 110, "2026-01-01"), createdAt: "2026-01-01T11:00:00.000Z" };
    const buy = { ...trade("buy", "buy", 5, 100, "2026-01-01"), createdAt: "2026-01-01T12:00:00.000Z" };

    const result = analyzeBucketTransactions([buy, sell], "short_term", 0);

    expect(result.invalidTransaction?.id).toBe("sell");
  });

  it("keeps accounting unknown when a sale uses an unpriced legacy balance", () => {
    const transactions = [
      trade("1", "buy", 5, 100, "2026-01-02"),
      trade("2", "sell", 5, 120, "2026-01-03"),
    ];

    const result = analyzeBucketTransactions(transactions, "short_term", 5);

    expect(result.quantity).toBe(5);
    expect(result.averageBuyPrice).toBeUndefined();
    expect(result.costBasis).toBeUndefined();
    expect(result.realizedGain).toBeUndefined();
    expect(result.realizedGainByTransactionId["2"]).toBeUndefined();
  });

  it("resets unknown legacy basis after closure", () => {
    const transactions = [
      trade("1", "sell", 5, 120, "2026-01-01"),
      trade("2", "buy", 2, 80, "2026-01-02"),
    ];

    const result = analyzeBucketTransactions(transactions, "short_term", 2);

    expect(result.quantity).toBe(2);
    expect(result.averageBuyPrice).toBe(80);
    expect(result.costBasis).toBe(160);
    expect(result.realizedGain).toBeUndefined();
  });
});
