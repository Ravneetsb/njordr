import type { StockQuote } from "./types";

export function isQuoteFresh(quote: StockQuote | undefined, maxAgeSeconds = 60): boolean {
  if (!quote) return false;
  return Date.now() - new Date(quote.fetchedAt).getTime() < maxAgeSeconds * 1000;
}

export async function fetchQuotes(symbols: string[]): Promise<StockQuote[]> {
  const uniqueSymbols = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
  if (uniqueSymbols.length === 0) return [];
  const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(uniqueSymbols.join(","))}`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Failed to fetch quotes");
  return payload.quotes as StockQuote[];
}
