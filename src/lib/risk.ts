import type { BucketType, Holding, HoldingBucketRow, StockQuote, Transaction } from "./types";

export function maxInvestmentValue(maxRiskAmount: number, riskPercent: number): number | undefined {
  if (maxRiskAmount <= 0 || riskPercent <= 0) return undefined;
  return maxRiskAmount / (riskPercent / 100);
}

export function currency(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

export function numberFmt(value: number | undefined, maximumFractionDigits = 2): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

export function percentFmt(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return `${numberFmt(value, 2)}%`;
}

export function buildBucketRows(holdings: Holding[], quotes: Record<string, StockQuote | undefined>, transactions: Transaction[] = []): HoldingBucketRow[] {
  const transactionsByHolding = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const list = transactionsByHolding.get(transaction.holdingId) ?? [];
    list.push(transaction);
    transactionsByHolding.set(transaction.holdingId, list);
  }

  return holdings.flatMap((holding) => {
    const quote = quotes[holding.symbol];
    const holdingTransactions = transactionsByHolding.get(holding.id) ?? [];
    return [
      buildRow(
        holding,
        "long_term",
        "Long-term",
        holding.longTermQuantity,
        holding.longTermMaxRiskAmount,
        holding.longTermRiskPercent,
        holding.longTermTargetProfitPercent,
        holdingTransactions,
        quote,
      ),
      buildRow(
        holding,
        "short_term",
        "Short-term",
        holding.shortTermQuantity,
        holding.shortTermMaxRiskAmount,
        holding.shortTermRiskPercent,
        holding.shortTermTargetProfitPercent,
        holdingTransactions,
        quote,
      ),
    ];
  });
}

function buildRow(
  holding: Holding,
  bucket: BucketType,
  bucketLabel: string,
  legacyQuantity: number,
  maxRiskAmount: number,
  riskPercent: number,
  targetProfitPercent: number | undefined,
  transactions: Transaction[],
  quote?: StockQuote,
): HoldingBucketRow {
  const aggregate = aggregateBucket(transactions, bucket, legacyQuantity);
  const maxValue = maxInvestmentValue(maxRiskAmount, riskPercent);
  const currentPrice = quote?.currentPrice;
  const currentValue = currentPrice === undefined ? undefined : aggregate.quantity * currentPrice;
  const unrealizedGain = currentValue !== undefined && aggregate.costBasis !== undefined ? currentValue - aggregate.costBasis : undefined;
  const unrealizedGainPercent = unrealizedGain !== undefined && aggregate.costBasis && aggregate.costBasis > 0 ? (unrealizedGain / aggregate.costBasis) * 100 : undefined;
  const targetSellPrice = targetProfitPercent && targetProfitPercent > 0 && aggregate.averageBuyPrice !== undefined ? aggregate.averageBuyPrice * (1 + targetProfitPercent / 100) : undefined;
  const targetReached = targetSellPrice !== undefined && currentPrice !== undefined ? currentPrice >= targetSellPrice : undefined;
  const isRiskTracked = maxValue !== undefined;
  const maxSuggestedShares = isRiskTracked && currentPrice && currentPrice > 0 ? Math.floor(maxValue / currentPrice) : undefined;
  const remainingCapacity = isRiskTracked && currentValue !== undefined ? maxValue - currentValue : undefined;
  const shareDifference = maxSuggestedShares !== undefined ? maxSuggestedShares - aggregate.quantity : undefined;
  const status = aggregate.quantity <= 0 ? "no_position" : !isRiskTracked ? "record_only" : currentValue === undefined ? "incomplete" : currentValue > maxValue ? "over_limit" : "under_limit";

  return {
    holdingId: holding.id,
    symbol: holding.symbol,
    bucket,
    bucketLabel,
    quantity: aggregate.quantity,
    averageBuyPrice: aggregate.averageBuyPrice,
    costBasis: aggregate.costBasis,
    unrealizedGain,
    unrealizedGainPercent,
    transactionCount: aggregate.transactionCount,
    targetProfitPercent,
    targetSellPrice,
    targetReached,
    maxRiskAmount,
    riskPercent,
    currentPrice,
    currentValue,
    maxInvestmentValue: maxValue,
    maxSuggestedShares,
    remainingCapacity,
    shareDifference,
    status,
    quoteFetchedAt: quote?.fetchedAt,
  };
}

function aggregateBucket(transactions: Transaction[], bucket: BucketType, legacyQuantity: number) {
  const bucketTransactions = transactions.filter((transaction) => transaction.bucket === bucket);
  if (bucketTransactions.length === 0) {
    return { quantity: legacyQuantity ?? 0, averageBuyPrice: undefined, costBasis: undefined, transactionCount: 0 };
  }

  const quantity = sum(bucketTransactions, (transaction) => transaction.quantity);
  const costBasis = sum(bucketTransactions, (transaction) => transaction.quantity * transaction.buyPrice);
  return {
    quantity,
    averageBuyPrice: quantity > 0 ? costBasis / quantity : undefined,
    costBasis,
    transactionCount: bucketTransactions.length,
  };
}

function sum<T>(items: T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0);
}
