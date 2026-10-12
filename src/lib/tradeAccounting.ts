import type { BucketType, Transaction } from "./types";

const EPSILON = 1e-9;

export type BucketAccounting = {
  quantity: number;
  averageBuyPrice?: number;
  costBasis?: number;
  realizedGain?: number;
  realizedGainByTransactionId: Record<string, number | undefined>;
  transactionCount: number;
  invalidTransaction?: Transaction;
};

export function signedQuantity(transaction: Pick<Transaction, "type" | "quantity">): number {
  return transaction.type === "sell" ? -transaction.quantity : transaction.quantity;
}

export function inferOpeningQuantity(currentQuantity: number, transactions: Transaction[], bucket: BucketType): number {
  const transactionQuantity = transactions
    .filter((transaction) => transaction.bucket === bucket)
    .reduce((total, transaction) => total + signedQuantity(transaction), 0);
  return normalizeZero(Math.max(0, currentQuantity - transactionQuantity));
}

export function analyzeBucketTransactions(transactions: Transaction[], bucket: BucketType, currentQuantity: number): BucketAccounting {
  const bucketTransactions = transactions.filter((transaction) => transaction.bucket === bucket).sort(compareTransactions);
  const openingQuantity = inferOpeningQuantity(currentQuantity, bucketTransactions, bucket);
  let quantity = openingQuantity;
  let costBasis = 0;
  let basisKnown = openingQuantity <= EPSILON;
  let realizedGain = 0;
  let realizedKnown = true;
  const realizedGainByTransactionId: Record<string, number | undefined> = {};

  for (const transaction of bucketTransactions) {
    if (transaction.type === "buy") {
      if (quantity <= EPSILON) {
        quantity = 0;
        costBasis = 0;
        basisKnown = true;
      }
      quantity += transaction.quantity;
      if (basisKnown) costBasis += transaction.quantity * transaction.price;
      continue;
    }

    if (transaction.quantity - quantity > EPSILON) {
      return result(quantity, costBasis, basisKnown, realizedGain, realizedKnown, realizedGainByTransactionId, bucketTransactions.length, transaction);
    }

    if (basisKnown && quantity > EPSILON) {
      const removedBasis = (costBasis / quantity) * transaction.quantity;
      const transactionGain = transaction.quantity * transaction.price - removedBasis;
      costBasis -= removedBasis;
      realizedGain += transactionGain;
      realizedGainByTransactionId[transaction.id] = transactionGain;
    } else {
      realizedKnown = false;
      realizedGainByTransactionId[transaction.id] = undefined;
    }

    quantity = normalizeZero(quantity - transaction.quantity);
    if (quantity === 0) {
      costBasis = 0;
      basisKnown = true;
    }
  }

  return result(quantity, costBasis, basisKnown, realizedGain, realizedKnown, realizedGainByTransactionId, bucketTransactions.length);
}

function result(
  quantity: number,
  costBasis: number,
  basisKnown: boolean,
  realizedGain: number,
  realizedKnown: boolean,
  realizedGainByTransactionId: Record<string, number | undefined>,
  transactionCount: number,
  invalidTransaction?: Transaction,
): BucketAccounting {
  const normalizedQuantity = normalizeZero(quantity);
  const normalizedBasis = normalizeZero(costBasis);
  return {
    quantity: normalizedQuantity,
    averageBuyPrice: basisKnown && normalizedQuantity > 0 ? normalizedBasis / normalizedQuantity : undefined,
    costBasis: basisKnown ? normalizedBasis : undefined,
    realizedGain: realizedKnown ? normalizeZero(realizedGain) : undefined,
    realizedGainByTransactionId,
    transactionCount,
    invalidTransaction,
  };
}

function compareTransactions(left: Transaction, right: Transaction): number {
  return left.tradeDate.localeCompare(right.tradeDate) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function normalizeZero(value: number): number {
  return Math.abs(value) <= EPSILON ? 0 : value;
}
