// The token radar's data layer: one snapshot in, one ranked board and the dashboard's dataset out.
//
// Every number on the board is derived from the sealed snapshot. The category multiple comes from
// the market-cap-to-TVL ratios of the protocols that already trade; the radar set comes from the
// no-token protocols that pass the four exclusion rules, plus every slug the watchlist names; and
// the implied value combines TVL, the category multiple, seven-day growth and age. No protocol is
// special-cased in the scoring: the same formula runs on every row. The exclusion gate is stated
// separately, and only its exchange-brand list rests on external common knowledge instead of a
// snapshot field.

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

/** The four reasons a protocol can be left off the ranked board, in gate order. */
export type ExclusionReasonCode =
  | 'CATEGORY_DERIVATIVE'
  | 'PRODUCT_FORM'
  | 'TOKEN_LINEAGE'
  | 'EXCHANGE_BRAND';

/**
 * Where a rule's test comes from. Three rules read fields the snapshot carries and can be
 * recomputed from it; the exchange-brand rule leans on external common knowledge.
 */
export type RuleBasis = 'snapshot-recomputable' | 'external-common-knowledge';

/** One exclusion rule as the data export states it: code, order, label, basis and fields. */
export interface ExclusionRule {
  code: ExclusionReasonCode;
  order: number;
  label: string;
  basis: RuleBasis;
  snapshot_fields: string[];
  note: string;
}

/** One protocol the gate left off, with the first rule that fired. */
export interface ExcludedRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason_code: ExclusionReasonCode;
  reason_label: string;
}

/** The snapshot-to-board accounting: every protocol is ranked, excluded or token-bearing. */
export interface Funnel {
  snapshot: number;
  tokenless: number;
  excluded: number;
  ranked: number;
  watchlist: number;
  by_reason: Record<ExclusionReasonCode, number>;
}

/** One category's multiple and the sample count behind it. */
export interface MultipleDetail {
  category: string;
  multiple: number;
  n: number;
  basis: 'category-median' | 'global-fallback';
}

/** The model's constants and the category multiple table, so the page can state what it runs. */
export interface ModelParameters {
  /** The numeric map the dashboard recomputes from; kept as-is for that page. */
  multiples: Record<string, number>;
  /** The same table in export form, one entry per category with its sample count. */
  multiples_detail: MultipleDetail[];
  global_multiple: number;
  global_samples: number;
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
  exclusion_rules: ExclusionRule[];
  excluded: ExcludedRow[];
  funnel: Funnel;
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
/** A seven-day move below this absolute percentage is not called out as momentum. */
const MOMENTUM_THRESHOLD_PCT = 10;
/** At 360 days, 1 + age/30 = 13 and the age term reaches its full weight. */
const AGE_FULL_DAYS = 360;
const AGE_LOG_TARGET = Math.log10(1 + AGE_FULL_DAYS / 30);

/**
 * The four exclusion rules, in evaluation order. The first three are recomputable from the
 * snapshot's own fields. The fourth rests on external common knowledge: the exchange-brand list
 * is not a snapshot field, and both this comment and the exported rule state that basis so the
 * board never passes an outside assumption off as a snapshot derivation.
 */
const EXCLUSION_RULES: ExclusionRule[] = [
  {
    code: 'CATEGORY_DERIVATIVE',
    order: 1,
    label: 'Category is CEX, liquid staking, liquid restaking, restaked BTC, bridge or canonical bridge',
    basis: 'snapshot-recomputable',
    snapshot_fields: ['category'],
    note: 'Reads the category field and matches it against a fixed set of derivative categories.',
  },
  {
    code: 'PRODUCT_FORM',
    order: 2,
    label: 'Name carries the product form wrapped, staked or staking',
    basis: 'snapshot-recomputable',
    snapshot_fields: ['name'],
    note: 'Reads the name field for a whole word wrapped, staked or staking.',
  },
  {
    code: 'TOKEN_LINEAGE',
    order: 3,
    label: 'Name is a versioned line of a protocol that already records a token',
    basis: 'snapshot-recomputable',
    snapshot_fields: ['name', 'gecko_id', 'symbol'],
    note: 'Strips a trailing version marker from the name and matches the stem against the names of protocols that record a token in this snapshot.',
  },
  {
    code: 'EXCHANGE_BRAND',
    order: 4,
    label: 'Name starts with an exchange brand (external common-knowledge rule)',
    basis: 'external-common-knowledge',
    snapshot_fields: ['name'],
    note: 'The exchange-brand prefix list is external common knowledge, not a snapshot field; only the prefix match against the name is recomputable from the snapshot.',
  },
];

/** Categories that are a product of another protocol, not a pre-token protocol of their own. */
const DERIVATIVE_CATEGORIES = new Set([
  'CEX',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Bridge',
  'Canonical Bridge',
]);

/** A wrapped, staked or staking product is not a protocol still waiting on its own token. */
const PRODUCT_FORM_WORD = /\b(wrapped|staked|staking)\b/i;

/** An exchange's own product is not a pre-token protocol either; this list is external knowledge. */
const EXCHANGE_BRAND_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/i;

/** DefiLlama's version marker: a space, then V2, v2, 2.0 or the like, at the end of the name. */
const VERSION_SUFFIX = /\s(V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)$/;

/** The label the data export attaches to a reason code. */
function ruleLabel(code: ExclusionReasonCode): string {
  return EXCLUSION_RULES.find((rule) => rule.code === code)?.label ?? code;
}

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
  detail: MultipleDetail[];
  global: number;
  global_samples: number;
}

/**
 * The category multiple table. For every protocol with a token and a positive TVL, ratio is
 * market cap / TVL; a category's median ratio is its multiple. Categories with fewer than three
 * samples take the global median, and every multiple is clamped to [0.05, 20].
 *
 * The detail keeps the sample count behind each multiple: n is the number of positive
 * mcap-to-TVL ratios in that category, and a fallback entry still reports its own n.
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
  const detail: MultipleDetail[] = [];
  for (const p of protocols) {
    const key = categoryKey(p.category);
    if (byCategory.has(key)) continue;
    const sample = ratios.get(key) ?? [];
    const ownMedian = sample.length >= MIN_GROUP_SAMPLES;
    const multiple = ownMedian ? clamp(median(sample), MULTIPLE_MIN, MULTIPLE_MAX) : global;
    byCategory.set(key, multiple);
    detail.push({
      category: key,
      multiple,
      n: sample.length,
      basis: ownMedian ? 'category-median' : 'global-fallback',
    });
  }
  detail.sort((a, b) => {
    if (a.category < b.category) return -1;
    if (a.category > b.category) return 1;
    return 0;
  });
  return { by_category: Object.fromEntries(byCategory), detail, global, global_samples: all.length };
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

/**
 * The first exclusion rule that fires, in gate order: category, product form, token lineage,
 * exchange brand. A null answer means the protocol is a candidate for the radar set. Every test
 * reads the snapshot's own fields; only the exchange-brand list is external common knowledge.
 */
function exclusionReason(p: SnapshotProtocol, liveNames: Set<string>): ExclusionReasonCode | null {
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return 'CATEGORY_DERIVATIVE';
  if (PRODUCT_FORM_WORD.test(p.name)) return 'PRODUCT_FORM';
  if (versionedFromLiveProtocol(p, liveNames)) return 'TOKEN_LINEAGE';
  if (EXCHANGE_BRAND_PREFIX.test(p.name)) return 'EXCHANGE_BRAND';
  return null;
}

interface Selection {
  selected: SnapshotProtocol[];
  excluded: ExcludedRow[];
}

/**
 * The radar set: every watchlist slug, plus every no-token protocol that passes the four rules.
 * The forty watchlist slugs all pass the rules in the sealed snapshot; the watchlist loop still
 * force-includes each of them, so no gate-required row can ever be dropped by a rule change.
 * The excluded ledger holds every no-token protocol the rules left out, in TVL order.
 */
function selectProtocols(snapshot: Snapshot): Selection {
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
  const excluded: ExcludedRow[] = [];
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug) || !tokenless(p)) continue;
    const reason = exclusionReason(p, liveNames);
    if (reason === null) {
      chosen.set(p.slug, p);
      continue;
    }
    excluded.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      reason_code: reason,
      reason_label: ruleLabel(reason),
    });
  }
  excluded.sort((a, b) => {
    if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
    if (a.slug < b.slug) return -1;
    if (a.slug > b.slug) return 1;
    return 0;
  });
  return { selected: [...chosen.values()], excluded };
}

/** The snapshot-to-board accounting, with a zero count for every reason code. */
function buildFunnel(snapshot: Snapshot, ranked: number, excluded: ExcludedRow[]): Funnel {
  const by_reason: Record<ExclusionReasonCode, number> = {
    CATEGORY_DERIVATIVE: 0,
    PRODUCT_FORM: 0,
    TOKEN_LINEAGE: 0,
    EXCHANGE_BRAND: 0,
  };
  for (const row of excluded) by_reason[row.reason_code] += 1;
  return {
    snapshot: snapshot.protocols.length,
    tokenless: snapshot.protocols.filter(tokenless).length,
    excluded: excluded.length,
    ranked,
    watchlist: snapshot.watchlist.length,
    by_reason,
  };
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

/** Position size bands: below $75M is a test position, $75-250M mid, above $250M large. */
type SizeTier = 'small' | 'mid' | 'large';

function sizeFor(tvl: number): { tier: SizeTier; label: string; range: string } {
  if (tvl < 75_000_000) return { tier: 'small', label: 'small test position', range: '$100-300' };
  if (tvl <= 250_000_000) return { tier: 'mid', label: 'mid-tier position', range: '$300-1,000' };
  return { tier: 'large', label: 'large position', range: '$1,000-3,000' };
}

/** The protocol's time on the snapshot without a token, as a plain-years clause. */
function ageFor(ageDays: number | null): { clause: string; short: string } {
  if (ageDays === null) {
    return {
      clause: 'an unrecorded listing age in this snapshot',
      short: 'not recorded in this snapshot',
    };
  }
  const years = ageDays / 365;
  const yearsText = years < 0.1 ? 'less than 0.1 years' : `${years.toFixed(1)} years`;
  return {
    clause: `${yearsText} (${ageDays} days) without a token in this snapshot`,
    short: `${yearsText} without a token`,
  };
}

/** The change as a momentum clause only when it is at least 10% in either direction. */
function momentumFor(change: number | null): string | null {
  if (change === null || Math.abs(change) < MOMENTUM_THRESHOLD_PCT) return null;
  const direction = change > 0 ? 'up' : 'down';
  return `TVL is ${direction} ${Math.abs(change).toFixed(1)}% over seven days`;
}

/** Gas in the chain's own tier, with a short form for sentences. */
function gasProfile(chain: string): { cost: string; short: string } {
  const key = chain.toLowerCase();
  if (key === 'ethereum') {
    return { cost: 'Ethereum mainnet gas at about $5-25 per transaction', short: 'Ethereum mainnet gas' };
  }
  if (L2_CHAINS.has(key)) {
    return { cost: 'L2 gas at about $0.05-0.50 per transaction', short: 'L2 gas' };
  }
  if (key === 'solana') {
    return { cost: 'Solana fees at about $0.01-0.05 per transaction', short: 'Solana fees' };
  }
  return { cost: 'moderate gas at about $0.50-2 per transaction', short: 'moderate gas' };
}

/** All the protocol-specific material one plan may use, taken from the snapshot fields alone. */
interface FarmProfile {
  name: string;
  chain: string;
  category: string;
  sizeTier: SizeTier;
  sizeLabel: string;
  sizeRange: string;
  sizePhrase: string;
  ageShort: string;
  ageSentence: string;
  momentum: string | null;
  change7d: number | null;
  gas: string;
  gasShort: string;
}

function profileFor(p: SnapshotProtocol, ageDays: number | null): FarmProfile {
  const size = sizeFor(p.tvl_usd);
  const age = ageFor(ageDays);
  const chain = primaryChain(p);
  const gas = gasProfile(chain);
  return {
    name: p.name,
    chain,
    category: p.category ?? 'Uncategorized',
    sizeTier: size.tier,
    sizeLabel: size.label,
    sizeRange: size.range,
    sizePhrase: `${size.label} (${size.range})`,
    ageShort: age.short,
    ageSentence:
      ageDays === null
        ? `${p.name}'s listing date is not recorded in this snapshot.`
        : `${p.name} has been listed for ${age.clause}.`,
    momentum: momentumFor(p.change_7d),
    change7d: p.change_7d,
    gas: gas.cost,
    gasShort: gas.short,
  };
}

/** The shared last step: every plan ends with a risk and exit rule that names the protocol and chain. */
function riskStep(p: FarmProfile): FarmAction {
  return {
    text: `Set the exit rule for ${p.name} on ${p.chain} before adding more: the position is a ${p.sizeLabel} of ${p.sizeRange}, and the listing is ${p.ageShort}. Follow ${p.name}'s official announcements, stop farming if a token is announced with no community allocation, and never borrow money to fund the position.`,
    cost: `nothing to hold, and ${p.gas} for the exit`,
    time: '15 minutes a week',
  };
}

/** The tier's own add-on advice, so even the momentum step reads differently by TVL band. */
function tierAdvice(p: FarmProfile): string {
  if (p.sizeTier === 'small') return 'Keep it a test position and do not average down';
  if (p.sizeTier === 'mid') return 'Stage any add-on in two clips';
  return 'Size any add-on in thirds';
}

/** The seven-day move, stated either as a momentum signal or as the measured absence of one. */
function momentumNote(p: FarmProfile): string {
  if (p.momentum !== null) return p.momentum;
  if (p.change7d === null) return 'its seven-day change is not recorded in this snapshot';
  const magnitude = Math.abs(p.change7d).toFixed(2);
  return `the absolute seven-day move is ${magnitude}%, below the ${MOMENTUM_THRESHOLD_PCT}% momentum mark`;
}

/** The fourth step: momentum, the TVL band, and the protocol's own information channels. */
function momentumAndIntel(p: FarmProfile): string {
  return `Momentum and intel check on ${p.name} on ${p.chain}: ${momentumNote(p)}. ${tierAdvice(p)}, keep the total inside the ${p.sizeRange} band, and follow ${p.name}'s official blog, documentation and governance forum for fee changes, incentives and token announcements.`;
}

/** Three category-common actions; every one names the protocol, its chain and its TVL band. */
interface CategoryPlay {
  entry: (p: FarmProfile) => string;
  core: (p: FarmProfile) => string;
  upkeep: (p: FarmProfile) => string;
}

/**
 * The category's own common actions. A category with no case takes the generic play: read the
 * documentation, use the core product once, and return for one documented action a week. None
 * of these texts names a pool, an APY or any fact the snapshot does not carry.
 */
function categoryPlay(category: string): CategoryPlay {
  switch (category) {
    case 'Dexs':
    case 'Liquidity Manager':
      return {
        entry: (p) =>
          `Open a ${p.sizePhrase} in ${p.name} on ${p.chain}: swap half into the chain's native asset and keep both sides in one fresh wallet. ${p.ageSentence}`,
        core: (p) =>
          `Provide the pair to ${p.name}'s official liquidity page on ${p.chain}, stake the LP receipt only if its documentation names a staking contract, and keep the total inside the ${p.sizeRange} band.`,
        upkeep: (p) =>
          `Rebalance the ${p.name} position on ${p.chain} once a week with one small swap, claim any published rewards from the protocol's own page, and keep the ${p.sizeRange} band as the ceiling. Its listing age is ${p.ageShort}.`,
      };
    case 'Lending':
    case 'Uncollateralized Lending':
    case 'Leveraged Farming':
      return {
        entry: (p) =>
          `Open a ${p.sizePhrase} in ${p.name} on ${p.chain}: supply a major stablecoin and keep the receipt token in the same wallet. ${p.ageSentence}`,
        core: (p) =>
          `Borrow no more than 30% of the supplied value on ${p.name} in ${p.chain}, repay within a week, and keep the total inside the ${p.sizeRange} band.`,
        upkeep: (p) =>
          `Check ${p.name}'s health factor on ${p.chain} once a week, add collateral if it nears the liquidation line, and keep enough ${p.gasShort} for adjustments. Its listing age is ${p.ageShort}.`,
      };
    case 'CDP':
    case 'CDP Manager':
    case 'Collateral Markets':
    case 'Anchor BTC':
    case 'Decentralized BTC':
      return {
        entry: (p) =>
          `Open a ${p.sizePhrase} in ${p.name} on ${p.chain}: deposit the collateral asset its documentation accepts and keep the position visible in the protocol's own app. ${p.ageSentence}`,
        core: (p) =>
          `Mint or borrow no more than 30% of the collateral value in ${p.name} on ${p.chain}, then hold only part of the proceeds and keep the ${p.sizeRange} band as the ceiling.`,
        upkeep: (p) =>
          `Repay a little of the ${p.name} debt on ${p.chain} each week and keep the collateral ratio well above the protocol's published liquidation threshold. Its listing age is ${p.ageShort}.`,
      };
    case 'Yield':
    case 'Yield Aggregator':
    case 'Farm':
      return {
        entry: (p) =>
          `Open a ${p.sizePhrase} in ${p.name} on ${p.chain}: deposit a major stablecoin into a documented vault and keep the share token. ${p.ageSentence}`,
        core: (p) =>
          `Route the deposit into ${p.name}'s documented core strategy on ${p.chain}, stake the receipt only if its documentation names a staking contract, and stay inside the ${p.sizeRange} band.`,
        upkeep: (p) =>
          `Claim and compound any published yield from ${p.name}'s own app on ${p.chain} once a week, and check the vault's fees and caps. Its listing age is ${p.ageShort}.`,
      };
    case 'Options Vault':
      return {
        entry: (p) =>
          `Open a ${p.sizePhrase} in ${p.name} on ${p.chain}: deposit into a documented vault and note its expiry before entering. ${p.ageSentence}`,
        core: (p) =>
          `Choose the ${p.name} vault on ${p.chain} whose expiry and settlement terms you can explain, and keep the ${p.sizeRange} band small enough to hold to expiry.`,
        upkeep: (p) =>
          `Note ${p.name}'s vault expiry on ${p.chain}, decide before expiry whether to roll or withdraw, and keep enough ${p.gasShort} for the exit. Its listing age is ${p.ageShort}.`,
      };
    case 'Risk Curators':
      return {
        entry: (p) =>
          `Allocate a ${p.sizePhrase} to a vault curated by ${p.name} on ${p.chain} and keep the vault shares. ${p.ageSentence}`,
        core: (p) =>
          `Read ${p.name}'s documented allocation and risk notes for ${p.chain}, split the position across more than one documented vault, and keep the total inside the ${p.sizeRange} band.`,
        upkeep: (p) =>
          `Recheck ${p.name}'s curated positions on ${p.chain} once a week and withdraw from any vault whose collateral or counterparty changes. Its listing age is ${p.ageShort}.`,
      };
    case 'Onchain Capital Allocator':
      return {
        entry: (p) =>
          `Deposit a ${p.sizePhrase} into a documented ${p.name} vault on ${p.chain} and keep the receipt token. ${p.ageSentence}`,
        core: (p) =>
          `Review how ${p.name} splits capital across ${p.chain} venues, keep the deposit through one full allocation cycle, and stay inside the ${p.sizeRange} band.`,
        upkeep: (p) =>
          `Check ${p.name}'s documented allocation and risk on ${p.chain} once a week and rebalance only through the official app. Its listing age is ${p.ageShort}.`,
      };
    case 'RWA':
      return {
        entry: (p) =>
          `Complete onboarding and put a ${p.sizePhrase} into ${p.name}'s documented RWA product on ${p.chain}. ${p.ageSentence}`,
        core: (p) =>
          `Hold ${p.name}'s receipt on ${p.chain}, test the redemption path, and reinvest distributions only through the protocol's official platform while keeping the ${p.sizeRange} band.`,
        upkeep: (p) =>
          `Check ${p.name}'s NAV, distribution and redemption window on ${p.chain} once a week and keep records of every mint and redemption. Its listing age is ${p.ageShort}.`,
      };
    case 'Derivatives':
    case 'Interest Rate Derivatives':
    case 'Prediction Market':
    case 'OTC Marketplace':
      return {
        entry: (p) =>
          `Open a ${p.sizePhrase} in ${p.name} on ${p.chain}: deposit margin or collateral in an account kept apart from other funds. ${p.ageSentence}`,
        core: (p) =>
          `Open one hedge, options or prediction position on ${p.name} in ${p.chain} worth no more than 20% of the margin, note its expiry or resolution date, and keep the ${p.sizeRange} band as the ceiling.`,
        upkeep: (p) =>
          `Close or roll the ${p.name} position on ${p.chain} once a week, keep the margin ratio comfortable, and keep enough ${p.gasShort} for the trade. Its listing age is ${p.ageShort}.`,
      };
    case 'Basis Trading':
      return {
        entry: (p) =>
          `Open a ${p.sizePhrase} in ${p.name} on ${p.chain}: deposit collateral first and keep the spot and futures legs in the same account. ${p.ageSentence}`,
        core: (p) =>
          `Open offsetting spot and futures legs of similar size on ${p.name} in ${p.chain}, keep the basis and funding terms visible, and stay inside the ${p.sizeRange} band.`,
        upkeep: (p) =>
          `Monitor ${p.name}'s basis and funding on ${p.chain} once a week, roll the legs before expiry, and keep the ${p.sizeRange} band as the ceiling. Its listing age is ${p.ageShort}.`,
      };
    case 'Launchpad':
      return {
        entry: (p) =>
          `Fund a fresh wallet on ${p.chain} with a ${p.sizePhrase} and connect it only to ${p.name}'s official launch page. ${p.ageSentence}`,
        core: (p) =>
          `Complete ${p.name}'s allowlist, quest or staking requirements on ${p.chain} and take one small allocation instead of a full-size entry, staying inside the ${p.sizeRange} band.`,
        upkeep: (p) =>
          `Return to ${p.name} on ${p.chain} each week for new launches, keep the wallet active, and never share its seed phrase. Its listing age is ${p.ageShort}.`,
      };
    case 'Chain':
      return {
        entry: (p) =>
          `Bridge a ${p.sizePhrase} onto ${p.chain} and keep the receiving wallet separate from your main holdings. ${p.ageSentence}`,
        core: (p) =>
          `Use one documented native application on ${p.chain} within ${p.name}'s ecosystem, such as a DEX, lending market or bridge, and keep the ${p.sizeRange} band as the ceiling.`,
        upkeep: (p) =>
          `Keep a small gas balance on ${p.chain} and make one documented transaction through ${p.name}'s ecosystem each week. Its listing age is ${p.ageShort}.`,
      };
    case 'Staking Pool':
    case 'Restaking':
      return {
        entry: (p) =>
          `Acquire the native asset or documented liquid staking token on ${p.chain}, starting with a ${p.sizePhrase}, and keep the receipt. ${p.ageSentence}`,
        core: (p) =>
          `Stake or delegate through ${p.name}'s official app on ${p.chain}, keep the receipt or delegation record, and stay inside the ${p.sizeRange} band.`,
        upkeep: (p) =>
          `Check ${p.name}'s validator, slashing and reward status on ${p.chain} once a week and keep enough ${p.gasShort} for a withdrawal. Its listing age is ${p.ageShort}.`,
      };
    case 'Stablecoin Wrapper':
    case 'Dual-Token Stablecoin':
      return {
        entry: (p) =>
          `Mint ${p.name}'s wrapper on ${p.chain} with a ${p.sizePhrase} of a major stablecoin and keep the receipt. ${p.ageSentence}`,
        core: (p) =>
          `Hold ${p.name}'s receipt on ${p.chain}, test a small redemption, and keep the mint and redeem paths separate inside the ${p.sizeRange} band.`,
        upkeep: (p) =>
          `Check ${p.name}'s collateral, peg and redemption status on ${p.chain} once a week and keep the position inside the ${p.sizeRange} band. Its listing age is ${p.ageShort}.`,
      };
    case 'CeDeFi':
      return {
        entry: (p) =>
          `Open a ${p.sizePhrase} in ${p.name} on ${p.chain} through its official app and confirm the custody and withdrawal path first. ${p.ageSentence}`,
        core: (p) =>
          `Complete one deposit and one small withdrawal on ${p.name} in ${p.chain} before increasing size, keeping the total inside the ${p.sizeRange} band.`,
        upkeep: (p) =>
          `Reconcile ${p.name}'s balances on ${p.chain} once a week and keep a small withdrawal test ready. Its listing age is ${p.ageShort}.`,
      };
    case 'Cross Chain Bridge':
      return {
        entry: (p) =>
          `Bridge a ${p.sizePhrase} through ${p.name} from ${p.chain} to one documented destination chain and keep the transfer receipt. ${p.ageSentence}`,
        core: (p) =>
          `Use one documented application on the destination chain after the ${p.name} transfer and keep the bridge receipt until finality, staying inside the ${p.sizeRange} band.`,
        upkeep: (p) =>
          `Track the ${p.name} transfer from ${p.chain} until finality and keep enough ${p.gasShort} for the destination transaction. Its listing age is ${p.ageShort}.`,
      };
    case 'Payments':
    case 'Crypto Card Issuer':
      return {
        entry: (p) =>
          `Set up ${p.name} on ${p.chain} and load a ${p.sizePhrase} for one small payment test. ${p.ageSentence}`,
        core: (p) =>
          `Make one small payment or card transaction through ${p.name} on ${p.chain} and keep the receipt inside the ${p.sizeRange} band.`,
        upkeep: (p) =>
          `Reconcile ${p.name}'s payments on ${p.chain} once a week and keep the balance below the amount you would miss. Its listing age is ${p.ageShort}.`,
      };
    case 'Insurance':
      return {
        entry: (p) =>
          `Buy cover through ${p.name} on ${p.chain} for a ${p.sizePhrase} of existing exposure and keep the policy terms. ${p.ageSentence}`,
        core: (p) =>
          `Check ${p.name}'s coverage terms, exclusions and expiry on ${p.chain} before relying on the policy, and keep the premium inside the ${p.sizeRange} band.`,
        upkeep: (p) =>
          `Check ${p.name}'s coverage expiry and claim window on ${p.chain} once a week and renew only if the terms still match the position. Its listing age is ${p.ageShort}.`,
      };
    case 'Privacy':
      return {
        entry: (p) =>
          `Move a ${p.sizePhrase} through ${p.name} on ${p.chain} with its official app and keep a withdrawal test in reserve. ${p.ageSentence}`,
        core: (p) =>
          `Test one deposit and one withdrawal through ${p.name} on ${p.chain} with a small amount before moving the rest, keeping the ${p.sizeRange} band.`,
        upkeep: (p) =>
          `Recheck ${p.name}'s withdrawal path on ${p.chain} once a week and keep the position small enough to exit in one transaction. Its listing age is ${p.ageShort}.`,
      };
    case 'Governance Incentives':
      return {
        entry: (p) =>
          `Acquire the governance asset through ${p.name}'s official process on ${p.chain} with a ${p.sizePhrase} and keep the delegation record. ${p.ageSentence}`,
        core: (p) =>
          `Delegate or lock through ${p.name}'s official governance page on ${p.chain}, record the lock terms, and keep the total inside the ${p.sizeRange} band.`,
        upkeep: (p) =>
          `Review ${p.name}'s proposals on ${p.chain} once a week and keep the delegated or locked position within the terms you recorded. Its listing age is ${p.ageShort}.`,
      };
    default:
      return {
        entry: (p) =>
          `Open a ${p.sizePhrase} in ${p.name} on ${p.chain} and read its documentation before the first transaction. ${p.ageSentence}`,
        core: (p) =>
          `Use ${p.name}'s core product on ${p.chain} once as its documentation describes, such as a swap, a stake, a mint or a deposit, and keep the ${p.sizeRange} band as the ceiling.`,
        upkeep: (p) =>
          `Return to ${p.name} on ${p.chain} once a week for one documented action and keep the ${p.sizeRange} position open across several snapshots. Its listing age is ${p.ageShort}.`,
      };
  }
}

/** Every step states the TVL band; a category text may omit it, so the plan adds it once. */
function withBand(text: string, p: FarmProfile): string {
  return text.includes(p.sizeRange) ? text : `${text} Keep the total inside the ${p.sizeRange} band.`;
}

/** Every step states the listing age; the core and momentum steps get it added when absent. */
function withAge(text: string, p: FarmProfile): string {
  return text.includes(p.ageShort) ? text : `${text} The listing is ${p.ageShort}.`;
}

/** A protocol's five-step plan: three category actions, a momentum check and a risk step. */
function farmSteps(p: SnapshotProtocol, ageDays: number | null): string[] {
  const profile = profileFor(p, ageDays);
  const play = categoryPlay(profile.category);
  const actions: FarmAction[] = [
    {
      text: withBand(play.entry(profile), profile),
      cost: `${profile.sizeRange} of capital plus ${profile.gas}`,
      time: '20 minutes',
    },
    {
      text: withAge(withBand(play.core(profile), profile), profile),
      cost: profile.gas,
      time: '20 minutes',
    },
    {
      text: withBand(play.upkeep(profile), profile),
      cost: `${profile.gas} once a week`,
      time: '10 minutes a week',
    },
    {
      text: withAge(withBand(momentumAndIntel(profile), profile), profile),
      cost: 'no on-chain cost',
      time: '10 minutes a week',
    },
    riskStep(profile),
  ];
  return actions.map(stepText);
}

/** The ranked board: every selected protocol, by implied value, with ranks 1..n. */
function buildBoard(snapshot: Snapshot, table: MultipleTable, selected: SnapshotProtocol[]): RadarRow[] {
  const watch = new Set(snapshot.watchlist);
  const scored = selected.map((p) => ({ p, ...scoreProtocol(p, snapshot.as_of, table) }));
  scored.sort((a, b) => {
    if (b.implied !== a.implied) return b.implied - a.implied;
    if (b.p.tvl_usd !== a.p.tvl_usd) return b.p.tvl_usd - a.p.tvl_usd;
    if (a.p.slug < b.p.slug) return -1;
    if (a.p.slug > b.p.slug) return 1;
    return 0;
  });
  return scored.map((s, index) => {
    return {
      slug: s.p.slug,
      name: s.p.name,
      rank: index + 1,
      implied_value_usd: s.implied,
      farm_steps: farmSteps(s.p, s.age),
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
  const selection = selectProtocols(snapshot);
  const board = buildBoard(snapshot, table, selection.selected);
  const funnel = buildFunnel(snapshot, board.length, selection.excluded);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: {
      multiples: table.by_category,
      multiples_detail: table.detail,
      global_multiple: table.global,
      global_samples: table.global_samples,
      min_category_samples: MIN_GROUP_SAMPLES,
      multiple_min: MULTIPLE_MIN,
      multiple_max: MULTIPLE_MAX,
      growth_clamp_pct: GROWTH_CLAMP_PCT,
      growth_weight: GROWTH_WEIGHT,
      age_weight: AGE_WEIGHT,
      age_full_days: AGE_FULL_DAYS,
      implied_floor_usd: 1,
    },
    exclusion_rules: EXCLUSION_RULES.map((rule) => ({ ...rule, snapshot_fields: [...rule.snapshot_fields] })),
    excluded: selection.excluded,
    funnel,
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
  const stepSets = new Set<string>();
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug} has ${row.farm_steps.length} farm steps`;
    }
    const stepSet = JSON.stringify(row.farm_steps);
    if (stepSets.has(stepSet)) return `${row.slug} repeats another row's farm steps`;
    stepSets.add(stepSet);
    for (const step of row.farm_steps) {
      const length = step.trim().length;
      if (length < 20 || length > 600) return `${row.slug} has a farm step of ${length} characters`;
      if (!step.includes(row.name) && !row.chains.some((chain) => step.includes(chain))) {
        return `${row.slug} has a farm step that names neither the protocol nor a chain`;
      }
    }
  }
  return null;
}

/** The page's whole dataset as one script: no fetch, no network, no build step. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
