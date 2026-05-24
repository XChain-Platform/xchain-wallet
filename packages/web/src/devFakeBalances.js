// Dev-only fake balance dataset used by `createDevMockSdk` so the
// wallet UI has realistic data to render even when no real explorer
// is configured. Strictly non-production: shipped to the bundle only
// because it lives next to the dev-mock SDK; the real SDK overrides
// the dev-mock at boot when `xchain-sdk` resolves cleanly.
//
// Native balances per chain (the user-requested totals):
//   BTC  → 50.00000000     ( 5_000_000_000 sats)
//   LTC  → 30.00000000     ( 3_000_000_000 ltoshi)
//   DOGE → 100,000.00000000 (10_000_000_000_000 atomic units)
//
// `fiatRate` is USD per ONE whole unit (after dividing by divisibility).
// Used by the UI to render a per-row USD line and roll up a portfolio
// total. Numbers picked to look plausible in 2026 — not real prices.

/**
 * @typedef {Object} FakeToken
 * @property {string} tick         ticker — uppercase, no whitespace
 * @property {string} displayName   user-friendly name
 * @property {string} description   one-line subtitle
 * @property {string} quantity      atomic-unit string
 * @property {number} divisibility  decimals to apply for display
 * @property {'native' | 'token' | 'subtoken'} kind
 * @property {number} fiatRate      USD per whole unit
 */

/** Map a chain id → coin family for native-symbol lookup. */
function coinForChain(chainId) {
    if (typeof chainId !== 'string') return 'bitcoin';
    if (chainId.startsWith('litecoin-')) return 'litecoin';
    if (chainId.startsWith('dogecoin-')) return 'dogecoin';
    return 'bitcoin';
}

const NATIVE_BY_COIN = {
    bitcoin: {
        tick: 'BTC',
        displayName: 'Bitcoin',
        description: 'The native coin of the Bitcoin network.',
        quantity: '5000000000',          // 50 BTC
        divisibility: 8,
        kind: 'native',
        fiatRate: 65000,
    },
    litecoin: {
        tick: 'LTC',
        displayName: 'Litecoin',
        description: 'The native coin of the Litecoin network.',
        quantity: '3000000000',          // 30 LTC
        divisibility: 8,
        kind: 'native',
        fiatRate: 80,
    },
    dogecoin: {
        tick: 'DOGE',
        displayName: 'Dogecoin',
        description: 'The native coin of the Dogecoin network.',
        quantity: '10000000000000',      // 100,000 DOGE (8 decimals)
        divisibility: 8,
        kind: 'native',
        fiatRate: 0.1,
    },
};

// 40 fake tokens. Tuple shape:
//   [ ticker, display name, description, quantity, divisibility, kind, fiat-rate ]
/** @type {Record<string, FakeToken[]>} */
const TOKENS_BY_COIN = {
    bitcoin: [
        ['PEPECASH',   'Pepe Cash',          'The original meme cash on Counterparty.', '125000000000000', 8, 'token',    0.0001],
        ['RAREPEPE',   'Rare Pepe',          'Iconic 2016 collectible card series.',    '17',              0, 'token',    250],
        ['XCP',        'Counterparty',       'Native tick of the Counterparty layer.', '4250000000',      8, 'token',    1.5],
        ['DANKEST',    'Dankest Token',      'XChain Platform governance token.',       '50000000000000',  8, 'token',    0.05],
        ['XCHAINGOV',  'XChain Governance',  'Vote on XChain Platform proposals.',      '125000000000',    8, 'token',    2],
        ['SATOSHIS',   'Satoshis',           'Sats on Bitcoin, tokenised.',             '8888800000000',   8, 'token',    0.000001],
        ['BTCNFT',     'Bitcoin NFT',        'Limited 1/1 collectible.',                '1',               0, 'token',    50],
        ['HODL',       'HODL Token',         'Diamond-handed devotion.',                '690420000000',    8, 'token',    0.001],
        ['MAFIACASH',  'Mafia Cash',         'Honor among coiners.',                    '13370000000000',  8, 'token',    0.00005],
        ['LAMBO',      'Lambo Coin',         'When Lambo? Now.',                        '4200000000',      8, 'token',    5],
        ['DIAMOND',    'Diamond Hands',      'For those who never sell.',               '15000000000000',  8, 'token',    0.0001],
        ['MOONSHOT',   'Moonshot',           'Aim for the stars.',                      '21000000000',     8, 'token',    0.01],
        ['ROCKET',     'Rocket Fuel',        'Liftoff in three… two… one…',             '750000000000',    8, 'token',    0.0001],
        ['STAMPS',     'Bitcoin Stamps',     'Permanent on-chain art.',                 '847',             0, 'token',    0.5],
        ['ORDINALS',   'Ordinals',           'Inscriptions on individual sats.',        '21',              0, 'token',    30],
        ['USDX',       'USD-X',              'Dev-mock USD stablecoin.',                '50000000000',     8, 'token',    1],
        ['EURX',       'EUR-X',              'Dev-mock EUR stablecoin.',                '20000000000',     8, 'token',    1.08],
        ['GOLDX',      'Gold-X',             'Pegged to one milligram of gold.',        '480000000000',    8, 'token',    0.09],
    ],
    litecoin: [
        ['LITEGEM',    'Lite Gem',           'Litecoin native gem token.',              '3300000000000',   8, 'token',    0.001],
        ['SCRYPT',     'Scrypt Token',       'Honoring the algo.',                      '128000000000',    8, 'token',    0.10],
        ['DOGEFOOD',   'Doge Food',          'Cross-chain meme economy.',               '50000000000',     8, 'token',    0.0001],
        ['CHARLIE',    'Charlie',            'Tribute coin.',                           '1500000000',      8, 'token',    0.20],
        ['LITESTAMP',  'Lite Stamp',         'Ordinals-style stamps on LTC.',           '420',             0, 'token',    5],
        ['MWEB',       'MWEB Token',         'MimbleWimble extension block.',           '88000000000',     8, 'token',    0.05],
        ['LIGHTNING',  'Lightning Token',    'Off-chain payment unit.',                 '7500000000',      8, 'token',    0.10],
        ['WAGMI',      'WAGMI',              'We are gonna make it.',                   '2500000000000',   8, 'token',    0.001],
        ['XCHAINFEE',  'XChain Fee Credit',  'Pre-paid relay fees.',                    '95000000000',     8, 'token',    0.50],
        ['SILVERX',    'Silver-X',           'Pegged to one ounce of silver.',          '125000000000',    8, 'token',    25],
    ],
    dogecoin: [
        ['SHIBE',      'Shibe Token',        'Such token. Very test.',                  '1000000000000000', 8, 'token',   0.0000001],
        ['MUCHWOW',    'Much Wow',           'So balance. Very Doge.',                  '150000000000000',  8, 'token',   0.0001],
        ['MOONDOGE',   'Moon Doge',          'To the moon, very fast.',                 '88800000000000',   8, 'token',   0.000001],
        ['DOGEMOON',   'Doge Moon',          'Inverse meme.',                           '420690000000000',  8, 'token',   0.0000001],
        ['ELONCOIN',   'Elon Coin',          'Tweet-driven volatility.',                '13370000000000',   8, 'token',   0.001],
        ['BARK',       'Bark Token',         'Woof.',                                   '50000000000000',   8, 'token',   0.0001],
        ['TIPDOGE',    'Tip Doge',           'Reddit tipping legacy.',                  '99999900000000',   8, 'token',   0.0000001],
        ['DOGEPUNK',   'Doge Punk',          'Pixel-art collectible series.',           '24',               0, 'token',   5],
        ['DOGENFT',    'Doge NFT',           'Limited collectible.',                    '1',                0, 'token',   25],
        ['MEMECASH',   'Meme Cash',          'The settlement layer for memes.',         '25000000000000',   8, 'token',   0.001],
        ['DOGEHODL',   'Doge HODL',          'Hold the Doge.',                          '888000000000000',  8, 'token',   0.0000001],
        ['SHIBARMY',   'Shib Army',          'Salute.',                                 '999999000000000',  8, 'token',   0.00000005],
    ],
};

/**
 * Stable per-address balance generator. Always returns the FULL chain
 * balance (50 BTC, 40+ tokens, etc.) on every address so the dev UI
 * has something to render regardless of which address is queried.
 *
 * @param {string} address
 * @param {string} chainId
 * @returns {{ address: string, chain: string, native: FakeToken, tokens: FakeToken[] }}
 */
export function fakeBalanceFor(address, chainId) {
    const coin = coinForChain(chainId);
    const native = NATIVE_BY_COIN[coin] || NATIVE_BY_COIN.bitcoin;
    const tokens = (TOKENS_BY_COIN[coin] || []).map(([tick, displayName, description, quantity, divisibility, kind, fiatRate]) => ({
        tick, displayName, description, quantity, divisibility, kind, fiatRate,
    }));
    return {
        address,
        chain: chainId,
        native,
        tokens: tokens,
    };
}

// First N entries of each chain's token list, pretending the dev user
// is the issuer (owner). Used to populate the My Tokens page in dev
// mode where the real explorer isn't reachable. Response shape mirrors
// the indexer's tokens endpoint (`{tick, supply, max_supply, description,
// locked, divisibility}`) so `listOwnedTokens` normalizes it the same
// way it does real data.
const OWNED_COUNT_BY_COIN = { bitcoin: 7, litecoin: 4, dogecoin: 4 };

/**
 * @param {string} chainId
 * @returns {Array<{ tick: string, supply: string, max_supply: string | null, description: string, locked: boolean, divisibility: number }>}
 */
export function fakeOwnedTokensFor(chainId) {
    const coin = coinForChain(chainId);
    const take = OWNED_COUNT_BY_COIN[coin] ?? 3;
    const rows = (TOKENS_BY_COIN[coin] || []).slice(0, take);
    return rows.map(([tick, _displayName, description, quantity, divisibility], i) => {
        // Half locked, two-thirds still held, every-other listed for
        // sale — gives the My Tokens chip filters a deterministic mix
        // of states to render without needing any real backend.
        const locked = (tick.length % 2) === 0;
        const youOwn = (i % 3) !== 2;
        const hasOpenDispenser = (i % 2) === 0;
        return {
            tick,
            supply: quantity,
            max_supply: locked ? quantity : null,
            description,
            locked,
            divisibility,
            youOwn,
            hasOpenDispenser,
        };
    });
}

// Native ticker for a chain — needed when pairing a token side against
// the chain coin in fake orders / swaps / dispensers.
function nativeTickFor(chainId) {
    const coin = coinForChain(chainId);
    return NATIVE_BY_COIN[coin]?.tick || 'BTC';
}

// Deterministic pseudo-address derived from (chainId, tick, seed). Not
// validated by the wallet (dev-mock only) but visually plausible —
// uses chain-appropriate prefixes so screenshots look realistic.
function fakeAddress(chainId, tick, seed) {
    const coin = coinForChain(chainId);
    const prefixes = { bitcoin: 'bc1q', litecoin: 'ltc1q', dogecoin: 'D' };
    const prefix = prefixes[coin] || 'bc1q';
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    let body = '';
    // Mix tick + seed so each row is stable but distinct per token.
    let n = 0;
    for (let i = 0; i < tick.length; i++) n = (n * 31 + tick.charCodeAt(i)) >>> 0;
    n = (n + seed * 2654435761) >>> 0;
    const len = coin === 'dogecoin' ? 33 : 38;
    for (let i = 0; i < len - prefix.length; i++) {
        n = (n * 1103515245 + 12345 + i * 31) >>> 0;
        body += alphabet[n % alphabet.length];
    }
    return prefix + body;
}

// Block number → action_index pair derived from the same seed so a row's
// `block_index` and the leading half of its `action_index` agree. The
// History-style renderer pulls block_index for the "Block N" meta line.
function fakeBlockFor(chainId, kind, tick, seed) {
    let n = 0;
    const s = `${chainId}|${kind}|${tick}|${seed}`;
    for (let i = 0; i < s.length; i++) n = (n * 131 + s.charCodeAt(i)) >>> 0;
    const blockIndex = 800000 + (n % 50000);
    const tx = (n >> 8) % 200;
    return { blockIndex, actionIndex: `${blockIndex}.${tx}` };
}

function fakeActionIndex(chainId, kind, tick, seed) {
    return fakeBlockFor(chainId, kind, tick, seed).actionIndex;
}

/**
 * Open dispensers selling `tick`. Used by the dev-mock SDK's
 * getDispensers(tick, 'token') path.
 *
 * @param {string} tick
 * @param {string} chainId
 */
export function fakeDispensersFor(tick, chainId) {
    const native = nativeTickFor(chainId);
    const now = Math.floor(Date.now() / 1000);
    // Three open dispensers, varying price + remaining stock + age so
    // the panel renders multiple distinct rows.
    const ageSec = [1800, 14400, 172800]; // 30m, 4h, 2d ago
    return [0, 1, 2].map((i) => {
        const { blockIndex, actionIndex } = fakeBlockFor(chainId, 'DISPENSER', tick, i);
        const giveQty = 1000 * 10 ** 8;
        const escrowQty = giveQty;
        const remaining = Math.floor(giveQty * (1 - 0.2 * i));
        const priceSats = [25000, 31000, 42000][i];
        return {
            action_index: actionIndex,
            tx_hash: actionIndex,
            block_index: blockIndex,
            timestamp: now - ageSec[i],
            block_time: now - ageSec[i],
            source: fakeAddress(chainId, tick, 100 + i),
            give_tick: tick,
            give_quantity: String(giveQty),
            give_remaining: String(remaining),
            escrow_quantity: String(escrowQty),
            get_tick: native,
            get_quantity: String(priceSats),
            mainchainrate: String(priceSats),
            mainchainrate_tick: native,
            status: 0,
        };
    });
}

/**
 * Open orders for `tick` on either side. Used by the dev-mock SDK's
 * getOrders(tick, 'token') path.
 *
 * @param {string} tick
 * @param {string} chainId
 */
export function fakeOrdersFor(tick, chainId) {
    const native = nativeTickFor(chainId);
    const counterpart = (chainId.includes('bitcoin')) ? 'XCP' : 'WAGMI';
    const now = Math.floor(Date.now() / 1000);
    // Mix of give/get sides + native/counterpart pairs to exercise
    // every branch of OrdersPanel's renderer.
    const orders = [
        // Selling tick for native coin
        { give: tick, giveQ: 5000 * 10 ** 8, get: native, getQ: 12500000, ago: 3600 },
        { give: tick, giveQ: 10000 * 10 ** 8, get: native, getQ: 28000000, ago: 18000 },
        // Buying tick with native coin
        { give: native, giveQ: 8000000, get: tick, getQ: 3200 * 10 ** 8, ago: 43200 },
        { give: native, giveQ: 50000000, get: tick, getQ: 22000 * 10 ** 8, ago: 129600 },
        // Token-for-token pair
        { give: tick, giveQ: 2500 * 10 ** 8, get: counterpart, getQ: 4500 * 10 ** 8, ago: 259200 },
        { give: counterpart, giveQ: 1750 * 10 ** 8, get: tick, getQ: 1100 * 10 ** 8, ago: 432000 },
    ];
    return orders.map((o, i) => {
        const { blockIndex, actionIndex } = fakeBlockFor(chainId, 'ORDER', tick, i);
        return {
            action_index: actionIndex,
            tx_hash: actionIndex,
            block_index: blockIndex,
            timestamp: now - o.ago,
            block_time: now - o.ago,
            source: fakeAddress(chainId, tick, 200 + i),
            give_tick: o.give,
            give_quantity: String(o.giveQ),
            give_remaining: String(Math.floor(o.giveQ * 0.85)),
            get_tick: o.get,
            get_quantity: String(o.getQ),
            get_remaining: String(Math.floor(o.getQ * 0.85)),
            status: 0,
        };
    });
}

/**
 * Historical SWAP fills for `tick`. Used by the dev-mock SDK's
 * getSwaps(tick, 'token') path.
 *
 * @param {string} tick
 * @param {string} chainId
 */
export function fakeSwapsFor(tick, chainId) {
    const native = nativeTickFor(chainId);
    const counterpart = (chainId.includes('bitcoin')) ? 'XCP' : 'WAGMI';
    const now = Math.floor(Date.now() / 1000);
    const swaps = [
        { give: tick, giveQ: 1500 * 10 ** 8, get: native, getQ: 4250000, ago: 3600 },
        { give: native, giveQ: 12000000, get: tick, getQ: 4900 * 10 ** 8, ago: 7200 },
        { give: tick, giveQ: 800 * 10 ** 8, get: counterpart, getQ: 1450 * 10 ** 8, ago: 10800 },
        { give: counterpart, giveQ: 2200 * 10 ** 8, get: tick, getQ: 1300 * 10 ** 8, ago: 21600 },
        { give: tick, giveQ: 3300 * 10 ** 8, get: native, getQ: 9400000, ago: 43200 },
        { give: native, giveQ: 25000000, get: tick, getQ: 10400 * 10 ** 8, ago: 86400 },
        { give: tick, giveQ: 7500 * 10 ** 8, get: native, getQ: 21000000, ago: 172800 },
    ];
    return swaps.map((s, i) => {
        const { blockIndex, actionIndex } = fakeBlockFor(chainId, 'SWAP', tick, i);
        return {
            action_index: actionIndex,
            tx_hash: actionIndex,
            block_index: blockIndex,
            source: fakeAddress(chainId, tick, 400 + i),
            give_tick: s.give,
            give_quantity: String(s.giveQ),
            get_tick: s.get,
            get_quantity: String(s.getQ),
            timestamp: now - s.ago,
            block_time: now - s.ago,
        };
    });
}

/**
 * Top holders of `tick`. Used by the dev-mock SDK's getHolders(tick).
 *
 * @param {string} tick
 * @param {string} chainId
 */
export function fakeHoldersFor(tick, chainId) {
    // 12 holders with a power-law distribution so the rendered share
    // column has interesting variance.
    const weights = [42, 18, 11, 7, 5, 4, 3, 3, 2, 2, 2, 1];
    const totalUnits = 100000;
    return weights.map((w, i) => ({
        address: fakeAddress(chainId, tick, 300 + i),
        quantity: String(Math.floor(totalUnits * (w / 100)) * 10 ** 8),
    }));
}

// Tick → (rowFromTOKENS_BY_COIN, divisibility, fiatRate). Used to back
// fakeTokenInfoFor so the §27.6 chart renders against a deterministic
// market.price in dev mode (real explorer is unreachable).
function lookupTokenRow(tick, chainId) {
    const coin = coinForChain(chainId);
    const rows = TOKENS_BY_COIN[coin] || [];
    for (const r of rows) {
        if (String(r[0]).toUpperCase() === String(tick).toUpperCase()) {
            return { tick: r[0], description: r[2], quantity: r[3], divisibility: r[4], fiatRate: r[6] };
        }
    }
    return null;
}

/**
 * Indexer-style token row consumed by `tokenInfoFor` / `normalizeTokenInfo`.
 * Anything in TOKENS_BY_COIN gets a populated response (including a
 * `market.price` value so the ManageToken sparkline has something to
 * anchor on); unknown ticks resolve to null (caller treats as missing).
 *
 * @param {string} tick
 * @param {string} chainId
 */
export function fakeTokenInfoFor(tick, chainId) {
    const found = lookupTokenRow(tick, chainId);
    if (!found) return null;
    const coin = coinForChain(chainId);
    const nativeFiat = NATIVE_BY_COIN[coin]?.fiatRate || 1;
    // Express the per-token price in native-coin units: how many BTC /
    // LTC / DOGE one token costs at the dev's USD rate. Tiny for cheap
    // memes, larger for the high-value rows — chart range buttons end
    // up with visibly different y-axes per token.
    const marketPrice = nativeFiat > 0 ? found.fiatRate / nativeFiat : found.fiatRate;
    const ownerAddr = fakeAddress(chainId, found.tick, 0);
    const locked = (found.tick.length % 2) === 0;
    return {
        tick: found.tick,
        info: {
            description: found.description,
            owner: ownerAddr,
        },
        supply: {
            current: found.quantity,
            max: locked ? found.quantity : null,
        },
        locks: locked
            ? { description: true, max_supply: true, mint: true, mint_supply: true }
            : {},
        market: {
            price: marketPrice,
            floor: marketPrice * 0.6,
        },
        divisibility: found.divisibility,
    };
}

/**
 * Recent on-chain history for `tick` — every action that mentions the
 * tick. Used by the dev-mock SDK's getHistory(tick, 'token') path.
 *
 * @param {string} tick
 * @param {string} chainId
 */
export function fakeHistoryFor(tick, chainId) {
    const types = ['ISSUE', 'MINT', 'SEND', 'SEND', 'ORDER', 'DISPENSER', 'DISPENSE', 'SWAP', 'AIRDROP', 'DIVIDEND', 'BROADCAST', 'SEND', 'ORDER', 'SWAP', 'DISPENSE'];
    const now = Math.floor(Date.now() / 1000);
    return types.map((type, i) => ({
        action_index: fakeActionIndex(chainId, type, tick, i),
        tx_hash: fakeActionIndex(chainId, type, tick, i),
        type,
        action_type: type,
        timestamp: now - i * 3600 - 600,
        block_time: now - i * 3600 - 600,
    }));
}
