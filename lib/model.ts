// The token radar's data layer: one snapshot in, one ranked board and the dashboard's dataset out.
//
// Every number on the board is derived from the sealed snapshot. The category multiple comes from
// the market-cap-to-TVL ratios of the protocols that already trade; the radar set comes from the
// no-token protocols that pass the product filter, plus every slug the watchlist names; and the
// implied value combines TVL, the category multiple, seven-day growth and age. No protocol name is
// special-cased anywhere below.

/** One protocol as the sealed snapshot carries it: the ten fields, no others. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One row of the board, and of data.js's rows: the same object in both files. */
export interface RadarRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  multiple: number;
  watchlist: boolean;
}

/** The model's constants and the category multiple table, so the page can state what it runs. */
export interface ModelParameters {
  multiples: Record<string, number>;
  global_multiple: number;
  min_category_samples: number;
  multiple_min: number;
  multiple_max: number;
  growth_clamp_pct: number;
  growth_weight: number;
  age_weight: number;
  age_full_days: number;
  implied_floor_usd: number;
}

/** The snapshot's own counts, for the page's headline. */
export interface RadarStats {
  protocols: number;
  no_token: number;
  selected: number;
  watchlist: number;
}

/** Everything data.js carries. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ModelParameters;
  rows: RadarRow[];
  stats: RadarStats;
}

/** The model label the page and the report quote. */
export const MODEL_VERSION = 'tr-1.0';

const DAY_MS = 86_400_000;
const MULTIPLE_MIN = 0.05;
const MULTIPLE_MAX = 20;
const MIN_GROUP_SAMPLES = 3;
const GROWTH_CLAMP_PCT = 30;
const GROWTH_WEIGHT = 0.5;
const AGE_WEIGHT = 0.2;
/** At 360 days, 1 + age/30 = 13 and the age term reaches its full weight. */
const AGE_FULL_DAYS = 360;
const AGE_LOG_TARGET = Math.log10(1 + AGE_FULL_DAYS / 30);

/** Categories that are a product of another protocol, not a pre-token protocol of their own. */
const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Bridge',
  'Canonical Bridge',
]);

/** A wrapped, staked or staking product is not a protocol still waiting on its own token. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** An exchange's own product is not a pre-token protocol either. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/i;

/** DefiLlama's version marker: a space, then V2, v2, 2.0 or the like, at the end of the name. */
const VERSION_SUFFIX = /\s(V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)$/;

/** Chains whose gas is L2-cheap rather than mainnet-expensive. */
const L2_CHAINS = new Set([
  'arbitrum',
  'arbitrum nova',
  'base',
  'blast',
  'ink',
  'linea',
  'mantle',
  'metis',
  'mode',
  'op mainnet',
  'optimism',
  'polygon zkevm',
  'scroll',
  'starknet',
  'taiko',
  'unichain',
  'world chain',
  'zksync',
  'zksync era',
  'zora',
]);

/** The snapshot out of a file's text, refused unless it has the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('snapshot.json is not a JSON object');
  }
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) {
    throw new Error('snapshot.json has no as_of date');
  }
  if (typeof doc.source !== 'string') throw new Error('snapshot.json has no source');
  if (typeof doc.floor_usd !== 'number' || !Number.isFinite(doc.floor_usd) || doc.floor_usd <= 0) {
    throw new Error('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(doc.protocols)) throw new Error('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((slug) => typeof slug !== 'string')) {
    throw new Error('snapshot.json has no watchlist of slugs');
  }
  const protocols: SnapshotProtocol[] = doc.protocols.map((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`snapshot.json's protocol ${index} is not an object`);
    }
    const p = value as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new Error(`snapshot.json's protocol ${index} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((chain): chain is string => typeof chain === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: doc.as_of,
    source: doc.source,
    floor_usd: doc.floor_usd,
    protocols,
    watchlist: doc.watchlist as string[],
  };
}

/** A protocol records no token when it has neither a CoinGecko id nor a ticker. */
function tokenless(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** The group a protocol's category multiple is taken from; a null category is its own group. */
function categoryKey(category: string | null): string {
  return category ?? 'Uncategorized';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

interface MultipleTable {
  by_category: Record<string, number>;
  global: number;
}

/**
 * The category multiple table. For every protocol with a token and a positive TVL, ratio is
 * market cap / TVL; a category's median ratio is its multiple. Categories with fewer than three
 * samples take the global median, and every multiple is clamped to [0.05, 20].
 */
function buildMultipleTable(protocols: SnapshotProtocol[]): MultipleTable {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    const key = categoryKey(p.category);
    const group = ratios.get(key);
    if (group === undefined) ratios.set(key, [ratio]);
    else group.push(ratio);
    all.push(ratio);
  }
  const global = all.length > 0 ? clamp(median(all), MULTIPLE_MIN, MULTIPLE_MAX) : 1;
  const byCategory = new Map<string, number>();
  for (const p of protocols) {
    const key = categoryKey(p.category);
    if (byCategory.has(key)) continue;
    const sample = ratios.get(key) ?? [];
    byCategory.set(key, sample.length >= MIN_GROUP_SAMPLES ? clamp(median(sample), MULTIPLE_MIN, MULTIPLE_MAX) : global);
  }
  return { by_category: Object.fromEntries(byCategory), global };
}

function multipleFor(category: string | null, table: MultipleTable): number {
  return table.by_category[categoryKey(category)] ?? table.global;
}

/** Whole days from the snapshot's as_of to listed_at, clamped at zero; null when unknown. */
function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

interface Score {
  implied: number;
  age: number | null;
  multiple: number;
}

/**
 * implied = max(1, round(tvl x multiple x growth x age))
 * growth  = 1 + clamp(change_7d, -30, 30) / 100 x 0.5, and exactly 1 when change_7d is null
 * age     = 1 + 0.2 x min(1, log10(1 + age_days/30) / log10(13)), and exactly 1 when the age is unknown
 */
function scoreProtocol(p: SnapshotProtocol, asOf: string, table: MultipleTable): Score {
  const multiple = multipleFor(p.category, table);
  const base = p.tvl_usd * multiple;
  const growthPct = clamp(p.change_7d ?? 0, -GROWTH_CLAMP_PCT, GROWTH_CLAMP_PCT);
  const growth = 1 + (growthPct / 100) * GROWTH_WEIGHT;
  const age = ageInDays(asOf, p.listed_at);
  const maturity = age === null ? 1 : 1 + AGE_WEIGHT * Math.min(1, Math.log10(1 + age / 30) / AGE_LOG_TARGET);
  return { implied: Math.max(1, Math.round(base * growth * maturity)), age, multiple };
}

/** Whether a name carries a version marker whose stem is already a live-token protocol's name. */
function versionedFromLiveProtocol(p: SnapshotProtocol, liveNames: Set<string>): boolean {
  const match = VERSION_SUFFIX.exec(p.name);
  if (match === null) return false;
  const stem = p.name.slice(0, match.index).trim().toLowerCase();
  return liveNames.has(stem);
}

/** The product filter: no exchange, staking or bridge product, and no versioned pool of a live token. */
function passesProductFilter(p: SnapshotProtocol, liveNames: Set<string>): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  if (versionedFromLiveProtocol(p, liveNames)) return false;
  return true;
}

/**
 * The radar set: every watchlist slug, plus every no-token protocol that passes the product filter.
 * The forty watchlist slugs all pass the filter in the sealed snapshot; the watchlist loop still
 * force-includes each of them, so no gate-required row can ever be dropped by a filter change.
 */
function selectProtocols(snapshot: Snapshot): SnapshotProtocol[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const liveNames = new Set<string>();
  for (const p of snapshot.protocols) {
    if (!tokenless(p)) liveNames.add(p.name.trim().toLowerCase());
  }
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && tokenless(p) && passesProductFilter(p, liveNames)) chosen.set(p.slug, p);
  }
  return [...chosen.values()];
}

/** One farm step before it is flattened into the gate's one-string form. */
interface FarmAction {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: the action, then its cost and duration, trimmed to the gate's 20..600. */
function stepText(action: FarmAction): string {
  const text = `${action.text} Cost: ${action.cost}. Time: ${action.time}.`.trim();
  return text.length > 600 ? `${text.slice(0, 596).trimEnd()}...` : text;
}

/** The chain a position is opened on: the protocol's first chain. */
function primaryChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

/** A gas estimate in the chain's own tier: mainnet, L2, Solana or everything else. */
function gasFor(chain: string): string {
  const key = chain.toLowerCase();
  if (key === 'ethereum') return 'Ethereum mainnet gas at about $5-25 per transaction';
  if (L2_CHAINS.has(key)) return 'L2 gas at about $0.05-0.50 per transaction';
  if (key === 'solana') return 'Solana fees at about $0.01-0.05 per transaction';
  return 'moderate gas at about $0.50-2 per transaction';
}

/** The shared last step: every plan ends with the same risk and exit rule. */
function riskStep(name: string, category: string | null, gas: string): FarmAction {
  const label = category === null ? 'an uncategorized protocol' : `a protocol in the ${category} category`;
  return {
    text: `Keep an exit plan for ${name}, ${label}: follow its official announcements, stop farming if a token is announced with no community allocation, and never borrow money to fund a farm position.`,
    cost: `nothing to hold, and ${gas} for the exit transaction`,
    time: '15 minutes a week',
  };
}

/** The category's four actions; categories without a template take the generic four. */
function categoryActions(category: string | null, name: string, chain: string, capital: number, gas: string): FarmAction[] {
  switch (category) {
    case 'Dexs':
      return [
        {
          text: `Swap half of $${capital} of USDC into ${chain}'s native asset on ${name} and keep both tokens in the same fresh wallet.`,
          cost: `$${capital} of capital plus ${gas}`,
          time: '20 minutes',
        },
        {
          text: `Deposit the USDC and native-asset pair into ${name}'s deepest liquidity pool and stake the LP receipt if the pool issues one.`,
          cost: `${gas} for the deposit and the staking transaction`,
          time: '15 minutes',
        },
        {
          text: `Rebalance the ${name} position once a week with a small swap and claim any pool rewards from the protocol's own page.`,
          cost: `${gas} per weekly swap and claim`,
          time: '10 minutes a week',
        },
        {
          text: `Track ${name}'s official blog, documentation and governance forum for fee changes, points programs and launch news.`,
          cost: 'no on-chain cost',
          time: '10 minutes a week',
        },
      ];
    case 'Lending':
      return [
        {
          text: `Supply $${capital} of USDC to ${name} on ${chain} and keep the receipt token in the same wallet.`,
          cost: `$${capital} of capital plus ${gas}`,
          time: '15 minutes',
        },
        {
          text: `Borrow no more than 30% of the supplied value against the position, then repay it within a week to build a clean on-chain history.`,
          cost: `${gas} for the borrow and the repay`,
          time: '20 minutes plus one week',
        },
        {
          text: `Check ${name}'s health factor once a week, add collateral if it nears the liquidation line, and claim rewards from the official app.`,
          cost: `${gas} per adjustment`,
          time: '10 minutes a week',
        },
        {
          text: `Follow ${name}'s official documentation, blog and governance forum for incentive changes and token announcements.`,
          cost: 'no on-chain cost',
          time: '10 minutes a week',
        },
      ];
    case 'CDP':
      return [
        {
          text: `Deposit $${capital} of ETH or a liquid staking token as collateral in ${name} on ${chain} and keep the position visible in the app.`,
          cost: `$${capital} of capital plus ${gas}`,
          time: '20 minutes',
        },
        {
          text: `Mint the protocol's stablecoin at no more than 30% of the collateral value, then hold or use only part of it.`,
          cost: `${gas} for the mint transaction`,
          time: '15 minutes',
        },
        {
          text: `Repay a little of the debt each week and keep the collateral ratio well above ${name}'s liquidation threshold.`,
          cost: `${gas} per weekly repay`,
          time: '10 minutes a week',
        },
        {
          text: `Read ${name}'s official documentation and governance forum weekly for parameter changes and token announcements.`,
          cost: 'no on-chain cost',
          time: '10 minutes a week',
        },
      ];
    case 'Yield':
      return [
        {
          text: `Deposit $${capital} of USDC into ${name}'s main vault on ${chain} and keep the vault share token.`,
          cost: `$${capital} of capital plus ${gas}`,
          time: '15 minutes',
        },
        {
          text: `Route the deposit into the vault's core strategy and stake the receipt if ${name} offers a staking contract.`,
          cost: `${gas} for the strategy and staking transactions`,
          time: '20 minutes',
        },
        {
          text: `Claim and compound the yield once a week from ${name}'s own app, and check the vault's fees and caps.`,
          cost: `${gas} per weekly claim`,
          time: '10 minutes a week',
        },
        {
          text: `Follow ${name}'s official blog, documentation and governance forum for strategy updates and token news.`,
          cost: 'no on-chain cost',
          time: '10 minutes a week',
        },
      ];
    case 'Risk Curators':
      return [
        {
          text: `Allocate $${capital} of USDC to a vault curated by ${name} on ${chain} and keep the vault shares.`,
          cost: `$${capital} of capital plus ${gas}`,
          time: '15 minutes',
        },
        {
          text: `Review ${name}'s published allocation and risk notes, then split the capital across two of its vaults.`,
          cost: `${gas} for the second deposit`,
          time: '20 minutes',
        },
        {
          text: `Recheck the curated positions once a week and withdraw from any vault whose collateral or counterparty changes.`,
          cost: `${gas} per withdrawal`,
          time: '10 minutes a week',
        },
        {
          text: `Follow ${name}'s official dashboard, blog and governance forum for new vaults and token news.`,
          cost: 'no on-chain cost',
          time: '10 minutes a week',
        },
      ];
    case 'Onchain Capital Allocator':
      return [
        {
          text: `Deposit $${capital} of USDC into ${name}'s flagship vault on ${chain} and keep the receipt token.`,
          cost: `$${capital} of capital plus ${gas}`,
          time: '15 minutes',
        },
        {
          text: `Review how ${name} splits capital across venues, then keep the position through at least one full allocation cycle.`,
          cost: `${gas} for any rebalance`,
          time: '30 days',
        },
        {
          text: `Check the vault's reported yield and risk weekly, and rebalance only through ${name}'s official app.`,
          cost: `${gas} per rebalance`,
          time: '10 minutes a week',
        },
        {
          text: `Follow ${name}'s official blog, documentation and governance forum for allocation changes and token news.`,
          cost: 'no on-chain cost',
          time: '10 minutes a week',
        },
      ];
    case 'RWA':
      return [
        {
          text: `Complete any required onboarding and deposit $${capital} of USDC to mint ${name}'s yield-bearing asset on ${chain}.`,
          cost: `$${capital} of capital plus ${gas}`,
          time: '30 minutes',
        },
        {
          text: `Hold the RWA receipt in the same wallet and reinvest the yield through ${name}'s official platform.`,
          cost: `${gas} per reinvestment`,
          time: '15 minutes',
        },
        {
          text: `Check the asset's NAV, yield and redemption window once a week and keep records of every mint.`,
          cost: 'no on-chain cost',
          time: '10 minutes a week',
        },
        {
          text: `Follow ${name}'s official site, documentation and governance forum for eligibility, redemption and token news.`,
          cost: 'no on-chain cost',
          time: '10 minutes a week',
        },
      ];
    case 'Collateral Markets':
      return [
        {
          text: `Supply $${capital} of an accepted collateral asset to ${name} on ${chain} and keep the receipt token.`,
          cost: `$${capital} of capital plus ${gas}`,
          time: '20 minutes',
        },
        {
          text: `Use the receipt in ${name}'s collateral market or a listed integration, keeping the position small and transparent.`,
          cost: `${gas} for the integration transaction`,
          time: '20 minutes',
        },
        {
          text: `Monitor the collateral ratio and oracle status weekly, and top up or repay before any parameter change.`,
          cost: `${gas} per adjustment`,
          time: '10 minutes a week',
        },
        {
          text: `Follow ${name}'s official documentation, blog and governance forum for market listings and token news.`,
          cost: 'no on-chain cost',
          time: '10 minutes a week',
        },
      ];
    case 'Derivatives':
      return [
        {
          text: `Deposit $${capital} of USDC as margin on ${name} on ${chain} and keep the account isolated from other funds.`,
          cost: `$${capital} of capital plus ${gas}`,
          time: '20 minutes',
        },
        {
          text: `Open one small hedge or options position worth no more than 20% of the margin and note its expiry.`,
          cost: `${gas} for the opening trade`,
          time: '15 minutes',
        },
        {
          text: `Close or roll the position once a week, keep the margin ratio comfortable, and claim rewards from the official app.`,
          cost: `${gas} per weekly trade`,
          time: '10 minutes a week',
        },
        {
          text: `Follow ${name}'s official documentation, blog and governance forum for listings, fee changes and token news.`,
          cost: 'no on-chain cost',
          time: '10 minutes a week',
        },
      ];
    case 'Launchpad':
      return [
        {
          text: `Fund a fresh wallet with $${capital} on ${chain} and connect it only to ${name}'s official launch page.`,
          cost: `$${capital} of capital plus ${gas}`,
          time: '15 minutes',
        },
        {
          text: `Complete ${name}'s allowlist, quest or staking requirements and mint or buy one small launch allocation.`,
          cost: `${gas} for the qualification transactions`,
          time: '30 minutes',
        },
        {
          text: `Return each week for new launches, keep the wallet active, and never share its seed phrase with a launch page.`,
          cost: `${gas} per weekly transaction`,
          time: '10 minutes a week',
        },
        {
          text: `Follow ${name}'s official blog, documentation and governance forum for sale dates and token announcements.`,
          cost: 'no on-chain cost',
          time: '10 minutes a week',
        },
      ];
    default:
      return [
        {
          text: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the receipt or position visible in the protocol's own app.`,
          cost: `$${capital} of capital plus ${gas}`,
          time: '15 minutes',
        },
        {
          text: `Use ${name}'s core product once as its documentation describes, such as a swap, a stake, a mint or a deposit.`,
          cost: `${gas} for the transaction`,
          time: '20 minutes',
        },
        {
          text: `Return to ${name} once a week for one qualifying action and keep the position open across several snapshots.`,
          cost: `${gas} per weekly action`,
          time: '10 minutes a week',
        },
        {
          text: `Follow ${name}'s official blog, documentation and governance forum for product changes and token announcements.`,
          cost: 'no on-chain cost',
          time: '10 minutes a week',
        },
      ];
  }
}

/** A protocol's five-step plan: four category actions and the shared risk and exit step. */
function farmSteps(p: SnapshotProtocol, chain: string): string[] {
  const capital = capitalFor(p.tvl_usd);
  const gas = gasFor(chain);
  const actions = [...categoryActions(p.category, p.name, chain, capital, gas), riskStep(p.name, p.category, gas)];
  return actions.map(stepText);
}

/** The ranked board: every selected protocol, by implied value, with ranks 1..n. */
function buildBoard(snapshot: Snapshot, table: MultipleTable): RadarRow[] {
  const watch = new Set(snapshot.watchlist);
  const scored = selectProtocols(snapshot).map((p) => ({ p, ...scoreProtocol(p, snapshot.as_of, table) }));
  scored.sort((a, b) => {
    if (b.implied !== a.implied) return b.implied - a.implied;
    if (b.p.tvl_usd !== a.p.tvl_usd) return b.p.tvl_usd - a.p.tvl_usd;
    if (a.p.slug < b.p.slug) return -1;
    if (a.p.slug > b.p.slug) return 1;
    return 0;
  });
  return scored.map((s, index) => {
    const chain = primaryChain(s.p);
    return {
      slug: s.p.slug,
      name: s.p.name,
      rank: index + 1,
      implied_value_usd: s.implied,
      farm_steps: farmSteps(s.p, chain),
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.age,
      multiple: s.multiple,
      watchlist: watch.has(s.p.slug),
    };
  });
}

/** The board and the page's dataset from one snapshot. */
export function buildRadar(snapshot: Snapshot): { board: RadarRow[]; radar: RadarData } {
  const table = buildMultipleTable(snapshot.protocols);
  const board = buildBoard(snapshot, table);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: {
      multiples: table.by_category,
      global_multiple: table.global,
      min_category_samples: MIN_GROUP_SAMPLES,
      multiple_min: MULTIPLE_MIN,
      multiple_max: MULTIPLE_MAX,
      growth_clamp_pct: GROWTH_CLAMP_PCT,
      growth_weight: GROWTH_WEIGHT,
      age_weight: AGE_WEIGHT,
      age_full_days: AGE_FULL_DAYS,
      implied_floor_usd: 1,
    },
    rows: board,
    stats: {
      protocols: snapshot.protocols.length,
      no_token: snapshot.protocols.filter(tokenless).length,
      selected: board.length,
      watchlist: snapshot.watchlist.length,
    },
  };
  return { board, radar };
}

/** The first reason the gate would refuse this board, or null when it would take it. */
export function boardIssue(board: RadarRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `the board has ${board.length} rows: the gate takes 100 to 4000`;
  }
  const index = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const row of board) {
    if (!index.has(row.slug)) return `row ${row.rank} names ${row.slug}, which is not in the snapshot`;
    if (seen.has(row.slug)) return `${row.slug} appears more than once`;
    seen.add(row.slug);
  }
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `row ${i + 1} has rank ${board[i]!.rank}, not ${i + 1}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length > 1 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value`;
  }
  const missing = snapshot.watchlist.filter((slug) => !seen.has(slug));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug} has ${row.farm_steps.length} farm steps`;
    }
    for (const step of row.farm_steps) {
      const length = step.trim().length;
      if (length < 20 || length > 600) return `${row.slug} has a farm step of ${length} characters`;
    }
  }
  return null;
}

/** The page's whole dataset as one script: no fetch, no network, no build step. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
