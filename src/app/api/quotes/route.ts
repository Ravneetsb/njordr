import { NextRequest, NextResponse } from "next/server";
import type { StockQuote } from "@/lib/types";

type FinnhubQuote = {
  c?: number;
  d?: number;
  dp?: number;
  h?: number;
  l?: number;
  o?: number;
  pc?: number;
};

export async function GET(request: NextRequest) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "FINNHUB_API_KEY is not configured. Add it to .env.local or Vercel environment variables." }, { status: 500 });
  }

  const symbols = (request.nextUrl.searchParams.get("symbols") ?? "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z.\-]{1,10}$/.test(symbol));

  const uniqueSymbols = Array.from(new Set(symbols));
  if (uniqueSymbols.length === 0) return NextResponse.json({ quotes: [] });
  if (uniqueSymbols.length > 25) return NextResponse.json({ error: "Please request 25 symbols or fewer at a time." }, { status: 400 });

  try {
    const quotes = await Promise.all(uniqueSymbols.map((symbol) => fetchFinnhubQuote(symbol, apiKey)));
    return NextResponse.json({ quotes: quotes.filter(Boolean) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to fetch quotes" }, { status: 502 });
  }
}

async function fetchFinnhubQuote(symbol: string, apiKey: string): Promise<StockQuote | null> {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, { next: { revalidate: 0 } });
  if (!response.ok) throw new Error(`Finnhub request failed for ${symbol}`);
  const data = (await response.json()) as FinnhubQuote;
  if (!data.c || data.c <= 0) return null;
  return {
    symbol,
    currentPrice: data.c,
    previousClose: data.pc,
    changeAmount: data.d,
    changePercent: data.dp,
    dayHigh: data.h,
    dayLow: data.l,
    dayOpen: data.o,
    fetchedAt: new Date().toISOString(),
    provider: "finnhub",
  };
}
