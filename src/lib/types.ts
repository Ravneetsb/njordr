export type BucketType = "long_term" | "short_term";
export type RiskStatus = "under_limit" | "over_limit" | "no_position" | "record_only" | "incomplete";

export type Holding = {
  id: string;
  symbol: string;
  notes?: string;
  longTermQuantity: number;
  longTermMaxRiskAmount: number;
  longTermRiskPercent: number;
  longTermTargetProfitPercent?: number;
  shortTermQuantity: number;
  shortTermMaxRiskAmount: number;
  shortTermRiskPercent: number;
  shortTermTargetProfitPercent?: number;
  createdAt: string;
  updatedAt: string;
};

export type HoldingInput = Omit<Holding, "id" | "createdAt" | "updatedAt">;

export type Transaction = {
  id: string;
  holdingId: string;
  symbol: string;
  bucket: BucketType;
  quantity: number;
  buyPrice: number;
  tradeDate: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type TransactionInput = Omit<Transaction, "id" | "holdingId" | "createdAt" | "updatedAt">;

export type AppSettings = {
  autoRefreshEnabled: boolean;
  refreshIntervalSeconds: number;
};

export type StockQuote = {
  symbol: string;
  currentPrice: number;
  previousClose?: number;
  changeAmount?: number;
  changePercent?: number;
  dayHigh?: number;
  dayLow?: number;
  dayOpen?: number;
  fetchedAt: string;
  provider: "finnhub";
};

export type CachedQuote = {
  symbol: string;
  quote: StockQuote;
  fetchedAt: string;
};

export type HoldingBucketRow = {
  holdingId: string;
  symbol: string;
  bucket: BucketType;
  bucketLabel: string;
  quantity: number;
  averageBuyPrice?: number;
  costBasis?: number;
  unrealizedGain?: number;
  unrealizedGainPercent?: number;
  transactionCount: number;
  targetProfitPercent?: number;
  targetSellPrice?: number;
  targetReached?: boolean;
  maxRiskAmount: number;
  riskPercent: number;
  currentPrice?: number;
  currentValue?: number;
  maxInvestmentValue?: number;
  maxSuggestedShares?: number;
  remainingCapacity?: number;
  shareDifference?: number;
  status: RiskStatus;
  quoteFetchedAt?: string;
};

export type PortfolioBackup = {
  version: 1 | 2;
  exportedAt: string;
  holdings: Holding[];
  transactions?: Transaction[];
  settings: AppSettings;
};
