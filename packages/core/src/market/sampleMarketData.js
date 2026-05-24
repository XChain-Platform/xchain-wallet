// TEMP — designer/dev sample feed for the market detail panels.
//
// Produces a deterministic but plausible orderbook + match history for
// any (tick1, tick2) pair so the chart, orderbook, and recent-trades
// panels light up before real explorer data is wired in. Same midpoint
// drives all three so they tell a consistent story.
//
// Remove (or gate behind a demo flag) once getOrderbook /
// getMarketHistory return real data here.

function hashTicks(tick1, tick2) {
    const s = `${tick1}::${tick2}`;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

// mulberry32 — small seeded RNG
function makeRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function midPriceFor(tick1, tick2) {
    const h = hashTicks(tick1, tick2);
    // log-uniform in [1e-7, 1e-3] so different pairs land at visually
    // distinct orders of magnitude
    const exp = -7 + (h % 5);
    const mantissa = 1 + ((h >>> 8) % 90) / 10;
    return mantissa * Math.pow(10, exp);
}

/**
 * Build a sample raw orderbook for (tick1, tick2). Shape matches what
 * the explorer's getOrderbook returns so the existing
 * normalizeOrderbook helper can consume it without changes.
 *
 * @returns {{ bids: Array<[string, string]>, asks: Array<[string, string]> }}
 */
export function sampleOrderbookFor(tick1, tick2) {
    const mid = midPriceFor(tick1, tick2);
    const rng = makeRng(hashTicks(tick1, tick2) ^ 0xa1b2c3d4);
    const bids = [];
    const asks = [];
    for (let i = 0; i < 12; i++) {
        const askPrice = mid * (1 + 0.002 + i * 0.003 + rng() * 0.001);
        const bidPrice = mid * (1 - 0.002 - i * 0.003 - rng() * 0.001);
        const askSize = Math.floor(10 + rng() * 500);
        const bidSize = Math.floor(10 + rng() * 500);
        asks.push([formatPrice(askPrice), String(askSize)]);
        bids.push([formatPrice(bidPrice), String(bidSize)]);
    }
    return { bids, asks };
}

/**
 * Build a sample list of match rows for (tick1, tick2). Shape matches
 * the explorer's getMarketHistory rows so both the chart's
 * `bucketizeMatches` and RecentTradesPanel's `summarizeRow` consume
 * them with no path changes.
 *
 * Produces ~60 matches spread across the last 7 days with a soft
 * random walk anchored to the pair's midpoint, so candles tell a
 * coherent story rather than looking like uniform noise.
 *
 * @returns {Array<any>}
 */
export function sampleMatchesFor(tick1, tick2) {
    const mid = midPriceFor(tick1, tick2);
    const rng = makeRng(hashTicks(tick1, tick2) ^ 0xdeadbeef);
    const now = Math.floor(Date.now() / 1000);
    const matches = [];
    let price = mid;
    const total = 80;
    const windowSec = 7 * 86400;
    for (let i = 0; i < total; i++) {
        const baseOffset = Math.floor((total - i) * (windowSec / total));
        const jitter = Math.floor(rng() * 1800);
        const timestamp = now - baseOffset - jitter;
        const drift = (rng() - 0.5) * mid * 0.04;
        price = clamp(price + drift, mid * 0.4, mid * 2.2);
        const size = Math.floor(10 + rng() * 500);
        const buyerTakes = rng() > 0.5;
        if (buyerTakes) {
            matches.push({
                give_tick: tick2,
                get_tick: tick1,
                give_amount: formatPrice(price * size),
                get_amount: String(size),
                timestamp,
                destination: synthesizeAddress(rng),
            });
        } else {
            matches.push({
                give_tick: tick1,
                get_tick: tick2,
                give_amount: String(size),
                get_amount: formatPrice(price * size),
                timestamp,
                destination: synthesizeAddress(rng),
            });
        }
    }
    // Sort newest first so RecentTradesPanel shows recent activity at the top
    // (the chart's bucketizer doesn't care about input order).
    matches.sort((a, b) => b.timestamp - a.timestamp);
    return matches;
}

function clamp(n, lo, hi) {
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
}

function formatPrice(n) {
    if (!Number.isFinite(n)) return '0';
    // Keep enough precision for very small BTC-quote prices
    return n.toFixed(10);
}

function synthesizeAddress(rng) {
    const chars = '023456789acdefghjklmnpqrstuvwxyz';
    let addr = 'bc1q';
    for (let i = 0; i < 38; i++) {
        addr += chars[Math.floor(rng() * chars.length)];
    }
    return addr;
}
