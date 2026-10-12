import { describe, expect, it } from "vitest";
import { buildBucketRows } from "./risk";
import type { Holding, StockQuote, Transaction } from "./types";

function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    id: "holding-1",
    symbol: "TEST",
    longTermQuantity: 0,
    longTermMaxRiskAmount: 0,
    longTermRiskPercent: 0,
    longTermTargetProfitPercent: 0,
    shortTermQuantity: 0,
    shortTermMaxRiskAmount: 0,
    shortTermRiskPercent: 0,
    shortTermTargetProfitPercent: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buy(id: string, bucket: Transaction["bucket"], quantity: number, price: number): Transaction {
  return {
    id,
    holdingId: "holding-1",
    symbol: "TEST",
    bucket,
    type: "buy",
    quantity,
    price,
    tradeDate: "2026-01-01",
    createdAt: `2026-01-01T00:00:0${id}.000Z`,
    updatedAt: `2026-01-01T00:00:0${id}.000Z`,
  };
}

function quote(currentPrice: number): StockQuote {
  return {
    symbol: "TEST",
    currentPrice,
    fetchedAt: "2026-01-01T00:00:00.000Z",
    provider: "finnhub",
  };
}

describe("buildBucketRows targets", () => {
  it("treats legacy percentage settings as enabled percent targets", () => {
    const [longTerm] = buildBucketRows(
      [holding({ longTermQuantity: 10, longTermTargetProfitPercent: 20 })],
      { TEST: quote(119) },
      [buy("1", "long_term", 10, 100)],
    );

    expect(longTerm.targetEnabled).toBe(true);
    expect(longTerm.targetMode).toBe("percent");
    expect(longTerm.targetSellPrice).toBe(120);
    expect(longTerm.targetReached).toBe(false);
  });

  it.each([120, 121])("marks a percentage target hit at or above its resolved price", (currentPrice) => {
    const [longTerm] = buildBucketRows(
      [holding({ longTermQuantity: 10, longTermTargetEnabled: true, longTermTargetMode: "percent", longTermTargetProfitPercent: 20 })],
      { TEST: quote(currentPrice) },
      [buy("1", "long_term", 10, 100)],
    );

    expect(longTerm.targetSellPrice).toBe(120);
    expect(longTerm.targetReached).toBe(true);
  });

  it("uses a fixed target without requiring an average buy price", () => {
    const [longTerm] = buildBucketRows(
      [holding({ longTermTargetEnabled: true, longTermTargetMode: "price", longTermTargetPrice: 75 })],
      { TEST: quote(80) },
    );

    expect(longTerm.averageBuyPrice).toBeUndefined();
    expect(longTerm.targetSellPrice).toBe(75);
    expect(longTerm.targetReached).toBe(true);
  });

  it("keeps a fixed target unchanged when average cost changes", () => {
    const configured = { longTermTargetEnabled: true, longTermTargetMode: "price" as const, longTermTargetPrice: 150 };
    const before = buildBucketRows([holding({ ...configured, longTermQuantity: 10 })], {}, [buy("1", "long_term", 10, 100)])[0];
    const after = buildBucketRows([holding({ ...configured, longTermQuantity: 20 })], {}, [buy("1", "long_term", 10, 100), buy("2", "long_term", 10, 200)])[0];

    expect(before.averageBuyPrice).toBe(100);
    expect(after.averageBuyPrice).toBe(150);
    expect(before.targetSellPrice).toBe(150);
    expect(after.targetSellPrice).toBe(150);
  });

  it("ignores retained target values while the target is disabled", () => {
    const [longTerm] = buildBucketRows(
      [holding({ longTermQuantity: 1, longTermTargetEnabled: false, longTermTargetMode: "price", longTermTargetPrice: 50, longTermTargetProfitPercent: 25 })],
      { TEST: quote(100) },
      [buy("1", "long_term", 1, 10)],
    );

    expect(longTerm.targetPrice).toBe(50);
    expect(longTerm.targetProfitPercent).toBe(25);
    expect(longTerm.targetSellPrice).toBeUndefined();
    expect(longTerm.targetReached).toBeUndefined();
  });

  it("keeps target settings independent between buckets", () => {
    const rows = buildBucketRows(
      [holding({
        longTermQuantity: 1,
        longTermTargetEnabled: true,
        longTermTargetMode: "percent",
        longTermTargetProfitPercent: 10,
        shortTermQuantity: 1,
        shortTermTargetEnabled: true,
        shortTermTargetMode: "price",
        shortTermTargetPrice: 250,
      })],
      {},
      [buy("1", "long_term", 1, 100), buy("2", "short_term", 1, 200)],
    );

    expect(rows[0].targetSellPrice).toBeCloseTo(110);
    expect(rows[1].targetSellPrice).toBe(250);
  });
});
