"use client";

import Dexie, { type Table } from "dexie";
import type { AppSettings, CachedQuote, Holding, Transaction } from "./types";

export const DEFAULT_SETTINGS: AppSettings = {
  autoRefreshEnabled: false,
  refreshIntervalSeconds: 60,
};

class NjordrDatabase extends Dexie {
  holdings!: Table<Holding, string>;
  transactions!: Table<Transaction, string>;
  settings!: Table<{ id: string } & AppSettings, string>;
  quoteCache!: Table<CachedQuote, string>;

  constructor() {
    super("njordr-stock-risk");
    this.version(1).stores({
      holdings: "id, symbol, updatedAt",
      settings: "id",
      quoteCache: "symbol, fetchedAt",
    });
    this.version(2).stores({
      holdings: "id, symbol, updatedAt",
      transactions: "id, holdingId, symbol, bucket, tradeDate, updatedAt",
      settings: "id",
      quoteCache: "symbol, fetchedAt",
    });
    this.version(3).stores({
      holdings: "id, symbol, updatedAt",
      transactions: "id, holdingId, symbol, bucket, tradeDate, updatedAt",
      settings: "id",
      quoteCache: "symbol, fetchedAt",
    }).upgrade((transaction) => transaction.table("transactions").toCollection().modify((row) => {
      row.type = row.type === "sell" ? "sell" : "buy";
      row.price = row.price ?? row.buyPrice;
      delete row.buyPrice;
    }));
  }
}

export const db = new NjordrDatabase();
