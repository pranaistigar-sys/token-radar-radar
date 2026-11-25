// Token launch radar: value model, farm plans and board builder.
//
// Everything here is derived from the sealed snapshot alone. No protocol name
// is hardcoded into the ranking: a protocol's implied value comes from its own
// TVL, its 7-day TVL growth, how long DefiLlama has tracked it with no token
// recorded, how many chains it runs on, and the market-cap-to-TVL multiple
// that token-bearing protocols in its own category actually trade at.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface Comparable {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  // Extra fields the dashboard reads from data.js (board.json keeps the gate's
  // five fields plus these; extra keys are allowed).
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_years: number | null;
  on_watchlist: boolean;
  multiple: number;
  multiple_basis: string;
  growth_factor: number;
  age_factor: number;
  chain_factor: number;
  comparables: Comparable[];
}

export interface RadarData {
  meta: {
    as_of: string;
    source: string;
    floor_usd: number;
    protocols_total: number;
    watchlist_total: number;
    rows: number;
    global_multiple: number;
    model: string;
  };
  rows: BoardRow[];
  trading: Comparable[]; // token-bearing protocols, the comparables pool
}

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_LEAD = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;

/** True when the protocol records no token and is not a wrapped, staked or
 *  bridged product of a protocol whose token already trades. The snapshot's
 *  watchlist is this rule plus the $50M floor; the board applies the rule
 *  without the floor, so it finds the early ones too. */
export function isCleanPreToken(p: SnapshotProtocol): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_TAIL.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_LEAD.test(p.name)) return false;
  return true;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function yearsBetween(fromDay: string, toDay: string): number {
  const from = Date.parse(`${fromDay}T00:00:00Z`);
  const to = Date.parse(`${toDay}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  return (to - from) / 365.25 / 86_400_000;
}

function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

// ---------------------------------------------------------------- farm plans

interface CategoryPlay {
  verb: string; // the core on-protocol action, e.g. "swap"
  asset: string; // what the reader puts in, e.g. "stablecoins"
  second: string; // a second, different action on the same protocol
  watch: string; // what to monitor while farming
}

const PLAYS: Record<string, CategoryPlay> = {
  Dexs: {
    verb: 'swap',
    asset: 'stablecoins and the chain gas token',
    second: 'add liquidity to the pool with the deepest TVL',
    watch: 'pool volume and your share of fees',
  },
  Lending: {
    verb: 'lend',
    asset: 'stablecoins or blue-chip collateral',
    second: 'borrow a small amount against your deposit and repay it the same week',
    watch: 'borrow rates and your health factor',
  },
  Yield: {
    verb: 'deposit into the vault',
    asset: 'stablecoins',
    second: 'move half the position into a second vault on the same protocol',
    watch: 'vault APY and any harvest or compounding schedule',
  },
  'Yield Aggregator': {
    verb: 'deposit into the top vault',
    asset: 'stablecoins',
    second: 'rotate a slice into a second strategy vault the protocol lists',
    watch: 'strategy APY and the vaults the aggregator routes to',
  },
  Derivatives: {
    verb: 'open a small perpetual position',
    asset: 'stablecoin margin',
    second: 'place a limit order and a take-profit on the same market',
    watch: 'funding rates and open interest on your market',
  },
  CDP: {
    verb: 'mint the stablecoin against collateral',
    asset: 'blue-chip collateral',
    second: 'repay a slice of the debt and re-mint it to prove the loop',
    watch: 'collateral ratio and liquidation price',
  },
  'CDP Manager': {
    verb: 'open a managed vault position',
    asset: 'blue-chip collateral',
    second: 'adjust the vault leverage up one notch, then back down',
    watch: 'vault leverage and liquidation buffer',
  },
  RWA: {
    verb: 'buy into the tokenised asset offering',
    asset: 'stablecoins',
    second: 'hold the position through one full distribution or coupon cycle',
    watch: 'distribution dates and the underlying asset reporting',
  },
  Restaking: {
    verb: 'restake liquid staking tokens',
    asset: 'liquid staking tokens',
    second: 'delegate to a second operator the protocol lists',
    watch: 'operator performance and restaking rewards',
  },
  'Basis Trading': {
    verb: 'deposit into the basis vault',
    asset: 'stablecoins',
    second: 'hold through one funding cycle and record the realised basis yield',
    watch: 'funding rates and vault NAV',
  },
  'Onchain Capital Allocator': {
    verb: 'deposit into the allocation vault',
    asset: 'stablecoins',
    second: 'split the deposit across two vaults the allocator runs',
    watch: 'vault allocations and reported returns',
  },
  'Risk Curators': {
    verb: 'deposit into a curated vault',
    asset: 'stablecoins or blue-chip collateral',
    second: 'compare two curators on the same protocol and split between them',
    watch: 'curator track record and vault caps',
  },
  'Leveraged Farming': {
    verb: 'open a leveraged farm position',
    asset: 'stablecoins plus the paired farm asset',
    second: 'reduce leverage by a third after the first week',
    watch: 'leverage ratio and liquidation price',
  },
  Launchpad: {
    verb: 'stake for launchpad allocation',
    asset: 'the chain gas token or stablecoins',
    second: 'join one live sale with a small ticket',
    watch: 'sale schedules and allocation rules',
  },
  Payments: {
    verb: 'pay or settle through the protocol',
    asset: 'stablecoins',
    second: 'set up a recurring payment or invoice through it',
    watch: 'settlement times and fees per payment',
  },
  Privacy: {
    verb: 'run a private transaction through the protocol',
    asset: 'the chain gas token',
    second: 'repeat with a second shielded pool or route it offers',
    watch: 'anonymity set size and fees',
  },
  'Prediction Market': {
    verb: 'take a position on a live market',
    asset: 'stablecoins',
    second: 'trade the opposite side of the same market with a smaller stake',
    watch: 'market odds and resolution dates',
  },
  'Liquidity Manager': {
    verb: 'deposit into a managed liquidity position',
    asset: 'the two pool assets in range',
    second: 'rebalance the range once after a week of price movement',
    watch: 'range utilisation and fees earned',
  },
  'Uncollateralized Lending': {
    verb: 'fund a credit line',
    asset: 'stablecoins',
    second: 'fund a second borrower pool with a smaller ticket',
    watch: 'borrower repayment history and pool utilisation',
  },
  Insurance: {
    verb: 'buy cover for a protocol you already use',
    asset: 'stablecoins for the premium',
    second: 'provide cover capital to a second pool',
    watch: 'cover utilisation and claim history',
  },
  Indexes: {
    verb: 'buy the index token',
    asset: 'stablecoins',
    second: 'hold through one rebalance and check the new weights',
    watch: 'index composition and rebalance dates',
  },
  Farm: {
    verb: 'stake in the farm',
    asset: 'the paired farm tokens',
    second: 'harvest and re-stake the rewards once',
    watch: 'emission schedule and farm APY',
  },
  'Interest Rate Derivatives': {
    verb: 'buy a fixed-rate position',
    asset: 'stablecoins',
    second: 'take the floating side with a smaller notional',
    watch: 'fixed versus floating rate spread',
  },
};

const GENERIC_PLAY: CategoryPlay = {
  verb: 'use the protocol with a real position',
  asset: 'stablecoins',
  second: 'repeat the core action on a second market or pool it lists',
  watch: 'TVL, fees and any points or activity the protocol tracks',
};

/** Six concrete farm steps for one protocol, each grounded in its own
 *  snapshot fields: name, chains, category, TVL and 7-day change. */
export function farmSteps(p: SnapshotProtocol): string[] {
  const play = PLAYS[p.category ?? ''] ?? GENERIC_PLAY;
  const chain = p.chains[0] ?? 'Ethereum';
  const chain2 = p.chains[1];
  const size = money(p.tvl_usd);
  const growth = p.change_7d === null ? 'unreported' : pct(p.change_7d);
  const cat = p.category ?? 'DeFi';
  const steps: string[] = [
    `Set up a fresh wallet on ${chain}, bridge $100 in stablecoins plus gas, and open ${p.name} (${cat}, ${size} TVL) to confirm the app loads and your wallet connects. Budget about $3-8 in gas and 20 minutes.`,
    `${cap(play.verb)} on ${p.name} with the $100 test: deposit ${play.asset} through the protocol's main ${cat.toLowerCase()} flow on ${chain}, keep the receipt hash, and leave the position open for at least 7 days.`,
    `Scale the position to $1,000-2,000 on ${chain} once the test settles, then ${play.second} with a quarter of it so the wallet shows two distinct kinds of activity on ${p.name}.`,
  ];
  if (chain2 !== undefined) {
    steps.push(
      `Repeat the core action on ${chain2}, the protocol's second chain, with $250: ${p.name} runs on ${p.chains.length} chains, and activity on more than one chain is harder to mistake for a single test transaction.`,
    );
  } else {
    steps.push(
      `Use ${p.name} a second way on ${chain}: swap a small amount through its ${cat.toLowerCase()} flow, then reverse half of it a day later, so the wallet records both directions of real usage.`,
    );
  }
  steps.push(
    `Return weekly for 8-12 weeks and repeat one action each visit (about 15 minutes, $2-5 gas per visit): protocols reward sustained use, and ${p.name}'s TVL moved ${growth} over the last 7 days, so watch whether the trend holds while you farm.`,
    `Keep records and stay safe: save every transaction hash and screenshot the positions page monthly, never withdraw the whole position at once, and remember no token is guaranteed - ${p.name} records no token today, and the farm is a bet on a future launch, not a promise.`,
  );
  return steps.map((s) => s.trim());
}

function cap(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------- the board

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

/** The gate's shape, checked before anything is written. Returns the first
 *  problem, or null when the board is valid. */
export function boardIssue(rows: BoardRow[], snap: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `board holds ${rows.length} rows, need 100-4000`;
  const seen = new Set<string>();
  const slugs = new Set(snap.protocols.map((p) => p.slug));
  for (const r of rows) {
    if (!slugs.has(r.slug)) return `board names ${r.slug}, not in the snapshot`;
    if (seen.has(r.slug)) return `board repeats ${r.slug}`;
    seen.add(r.slug);
    if (!r.name) return `board row ${r.slug} has no name`;
    if (!Number.isInteger(r.rank) || r.rank < 1) return `board row ${r.slug} has rank ${r.rank}`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1) {
      return `board row ${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.implied_value_usd > 100_000_000_000_000) {
      return `board row ${r.slug} has implied value over the $100T cap`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `board row ${r.slug} has ${r.farm_steps.length} farm steps`;
    }
    for (const s of r.farm_steps) {
      if (s.trim().length < 20 || s.trim().length > 600) {
        return `board row ${r.slug} has a farm step of ${s.trim().length} chars`;
      }
    }
  }
  const ranks = [...rows.map((r) => r.rank)].sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return 'board ranks are not 1..N';
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) {
      return 'board implied values rise with rank';
    }
  }
  for (const w of snap.watchlist) if (!seen.has(w)) return `board misses watchlist ${w}`;
  return null;
}

export function buildRadar(snap: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const watch = new Set(snap.watchlist);
  const bySlug = new Map(snap.protocols.map((p) => [p.slug, p]));

  // Comparables: token-bearing protocols, grouped by category.
  const trading: Comparable[] = snap.protocols
    .filter((p) => (p.gecko_id !== null || p.symbol !== null) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: p.mcap_usd! / p.tvl_usd,
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd);
  const globalMultiple = median(trading.map((t) => t.multiple));

  const byCategory = new Map<string, number[]>();
  for (const t of trading) {
    const p = bySlug.get(t.slug)!;
    const key = p.category ?? '(none)';
    const list = byCategory.get(key) ?? [];
    list.push(t.multiple);
    byCategory.set(key, list);
  }
  const categoryMultiple = (cat: string | null): { multiple: number; basis: string } => {
    const list = byCategory.get(cat ?? '(none)') ?? [];
    if (list.length >= 3) {
      const m = clamp(median(list), 0.02, 3);
      return { multiple: m, basis: `median mcap/TVL of ${list.length} token-bearing ${cat ?? 'uncategorised'} protocols` };
    }
    return { multiple: clamp(globalMultiple, 0.02, 3), basis: `global median mcap/TVL of ${trading.length} token-bearing protocols (fewer than 3 in-category comps)` };
  };

  const scored: BoardRow[] = [];
  for (const p of snap.protocols) {
    if (!isCleanPreToken(p)) continue;
    const { multiple, basis } = categoryMultiple(p.category);
    // Growth: half the 7-day move, clamped, so a hot week lifts value but a
    // cold week never wipes it out. Null growth is neutral.
    const growthFactor = p.change_7d === null ? 1 : 1 + 0.5 * clamp(p.change_7d, -40, 80) / 100;
    // Age: every year tracked with no token adds 6%, capped at five years.
    // A protocol that survived years without a token is the overdue launch.
    const ageYears = p.listed_at === null ? null : yearsBetween(p.listed_at, snap.as_of);
    const ageFactor = ageYears === null ? 1 : 1 + 0.06 * Math.min(ageYears, 5);
    // Breadth: each extra chain adds 2%, capped at four extra chains.
    const chainFactor = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 4);
    const value = p.tvl_usd * multiple * growthFactor * ageFactor * chainFactor;
    const comps = trading
      .filter((t) => (bySlug.get(t.slug)!.category ?? '(none)') === (p.category ?? '(none)'))
      .sort((a, b) => Math.abs(a.multiple - multiple) - Math.abs(b.multiple - multiple))
      .slice(0, 3);
    scored.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: Math.max(1, Math.round(value)),
      farm_steps: farmSteps(p),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_years: ageYears === null ? null : Math.round(ageYears * 10) / 10,
      on_watchlist: watch.has(p.slug),
      multiple: Math.round(multiple * 10000) / 10000,
      multiple_basis: basis,
      growth_factor: Math.round(growthFactor * 1000) / 1000,
      age_factor: Math.round(ageFactor * 1000) / 1000,
      chain_factor: Math.round(chainFactor * 1000) / 1000,
      comparables: comps,
    });
  }

  // Rank by implied value, highest first; ties break by TVL, then slug, so
  // the order is total and reproducible.
  scored.sort((a, b) => {
    if (b.implied_value_usd !== a.implied_value_usd) return b.implied_value_usd - a.implied_value_usd;
    if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
    return a.slug < b.slug ? -1 : 1;
  });
  // Keep values strictly falling with rank so the gate's order check holds
  // even where rounding ties two rows: shave a dollar at a time.
  for (let i = 0; i < scored.length; i++) {
    const row = scored[i]!;
    row.rank = i + 1;
    if (i > 0) {
      const prev = scored[i - 1]!;
      if (row.implied_value_usd >= prev.implied_value_usd) {
        row.implied_value_usd = Math.max(1, prev.implied_value_usd - 1);
      }
    }
  }

  const model =
    'Implied value = TVL x category multiple x growth factor x age factor x chain factor. ' +
    'Category multiple: median market-cap/TVL of token-bearing protocols in the same category ' +
    '(at least 3 comps), else the global median across all token-bearing protocols; clamped to 0.02-3.00. ' +
    'Growth factor: 1 + 0.5 x 7-day TVL change, change clamped to -40%..+80% (null = 1). ' +
    'Age factor: 1 + 0.06 x years listed with no token, capped at 5 years (null = 1). ' +
    'Chain factor: 1 + 0.02 per extra chain, capped at 4 extra chains.';
  const radar: RadarData = {
    meta: {
      as_of: snap.as_of,
      source: snap.source,
      floor_usd: snap.floor_usd,
      protocols_total: snap.protocols.length,
      watchlist_total: snap.watchlist.length,
      rows: scored.length,
      global_multiple: Math.round(globalMultiple * 10000) / 10000,
      model,
    },
    rows: scored,
    trading: trading.slice(0, 60),
  };
  return { board: scored, radar };
}

/** The dashboard's data file: one assignment, deterministic key order. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
