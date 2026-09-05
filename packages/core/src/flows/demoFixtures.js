// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §25.2 / Cluster J FOLLOWUP 1: synthesized fixture data for demo
// wallets so Home / History / TokenDetail surfaces feel populated
// without requiring the user to fund the wallet.
//
// `nftImg` returns an inline SVG data URI used as a stand-in for an
// tick's image. Real wallets get imageUrl from the indexer; the demo
// path needs offline-safe placeholders so the NFTs tab (which filters
// by imageUrl presence) actually shows tiles. Pure SVG keeps the
// payload tiny and avoids any network fetch.
//
// Every function here that dates a row takes `opts.now`, and the two
// that did not (the DeFi feed and the dispense list) are why a store
// listing capture could not be repeated: their timestamps moved on
// every run, so re-capturing an unchanged tree produced different
// bytes and proved nothing. Keep the pattern - a bare `Date.now()`
// with no `opts.now` in front of it is a fixture nobody can freeze,
// and test/smoke/audits/listing-capture-determinism.smoke.js fails on
// one. See flows/demoCapture.js.

function nftImg(label, bgFrom, bgTo, fg = '#FFFFFF') {
    const t = String(label || '').slice(0, 5);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${bgFrom}"/><stop offset="100%" stop-color="${bgTo}"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><text x="100" y="118" font-family="system-ui,sans-serif" font-size="44" font-weight="800" fill="${fg}" text-anchor="middle">${t}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Real icon URLs mirrored from DEMO_TIS_BY_TICK in tokenInfo.js so the
// Home / SendPicker / TokenDetail rows show the published artwork
// instead of the colored-letter placeholder. Tickers that don't appear
// here fall back to `nftImg(...)`.
const DEMO_TOKEN_ICONS = {
    // Matches the icon in demoExampleTis.json so the holdings tile and the
    // token-info gallery show the same artwork.
    EXAMPLE: 'https://placehold.co/128x128/1E90C7/FFFFFF/png?text=EX',
    PEPECREATURE: 'https://gousue3rn3uppml5r5hloc4wqmojl2cqxyhvhnceairxkccnw7vq.ar.io/M6kqE3Fu6PexfY9OtwuWgxyV6FC-D1O0RAIjdQhNt-s/pepecreature_thumb.png',
    RAREPEPE: 'https://rarepepedirectory.com/pepe/NAKAMOTOCARD.png',
    PEPECASH: 'https://rarepepedirectory.com/pepe/PEPECASH.png',
    XCP: 'https://counterparty.io/static/images/counterparty-logo.png',
    DOGINAL: 'https://upload.wikimedia.org/wikipedia/en/d/d0/Dogecoin_Logo.png',
};
//
// Demo wallets are real BIP39 wallets. They have real addresses on
// real chains; only the on-chain balances are zero. The fixtures
// here overlay synthetic SDK-shaped responses on top of the real
// address records so the rest of the wallet code (`balancesFromSdk`,
// the simulator, the History timeline, etc.) accepts them without
// special-casing.
//
// Conservative shape: the synthesized data deliberately stays small
// (one native balance per chain, two recent history entries) so the
// demo doesn't pretend to be a heavyweight active wallet.

/**
 * @typedef {{ tick: string, divisibility: number, quantity: string }} NativeFixture
 * @typedef {{ tick: string, displayName: string, divisibility: number, quantity: string }} TokenFixture
 * @typedef {{ native: NativeFixture | null, tokens: TokenFixture[] }} BalanceFixture
 */

const PER_CHAIN_DEFAULTS = /** @type {Record<string, BalanceFixture>} */ ({
    'bitcoin-mainnet': {
        native: { tick: 'BTC', divisibility: 8, quantity: '12345678', fiatRate: 95000 }, // 0.12345678 BTC ≈ $11.7k
        tokens: [
            // Featured reference token. Its full TIS document (every field
            // populated) lives in demoExampleTis.json; holding it lets the
            // demo show a maxed-out token info surface.
            { tick: 'EXAMPLE', displayName: 'Example Token', divisibility: 8, quantity: '10000000000', fiatRate: 0.5, imageUrl: DEMO_TOKEN_ICONS.EXAMPLE }, // 100 EXAMPLE
            // Divisible mainnet tokens
            { tick: 'XCP', displayName: 'Counterparty', divisibility: 8, quantity: '500000000', fiatRate: 35 }, // 5 XCP
            { tick: 'PEPECASH', displayName: 'PepeCash', divisibility: 8, quantity: '10000000000', fiatRate: 0.0012, imageUrl: DEMO_TOKEN_ICONS.PEPECASH }, // 100 PEPECASH
            { tick: 'BANANE', displayName: 'Banane', divisibility: 8, quantity: '20000000000', fiatRate: 0.04 }, // 200 BANANE
            { tick: 'RUSTBITS', displayName: 'Rustbits', divisibility: 8, quantity: '750000000', fiatRate: 2.50 }, // 7.5 RUSTBITS
            // Indivisible; surfaced in NFTs because they carry imageUrl
            { tick: 'RAREPEPE', displayName: 'Rare Pepe', divisibility: 0, quantity: '1', fiatRate: 650, imageUrl: DEMO_TOKEN_ICONS.RAREPEPE },
            { tick: 'BITCRYSTAL', displayName: 'Bitcrystals', divisibility: 0, quantity: '1', fiatRate: 220, imageUrl: nftImg('BIT', '#1565C0', '#00838F') },
            { tick: 'XCPCARD', displayName: 'XCP Founders Card', divisibility: 0, quantity: '1', fiatRate: 120, imageUrl: nftImg('XCP', '#1E90C7', '#7B2C8F') },
            { tick: 'XCHAINLOGO', displayName: 'XChain Logo NFT', divisibility: 0, quantity: '1', fiatRate: 50, imageUrl: nftImg('XC', '#1E90C7', '#7B2C8F') },
            { tick: 'PEPECREATURE', displayName: 'Pepe Creature', divisibility: 0, quantity: '1', fiatRate: 800, imageUrl: DEMO_TOKEN_ICONS.PEPECREATURE },
        ],
    },
    'bitcoin-testnet': {
        native: { tick: 'BTC', divisibility: 8, quantity: '5000000' }, // 0.05 tBTC
        tokens: [],
    },
    'bitcoin-regtest': {
        native: { tick: 'BTC', divisibility: 8, quantity: '10000000000', fiatRate: 70000 }, // 100 rBTC @ $70k
        tokens: [
            // Featured reference token. Its full TIS document (every field
            // populated) lives in demoExampleTis.json; holding it lets the
            // demo show a maxed-out token info surface.
            { tick: 'EXAMPLE', displayName: 'Example Token', divisibility: 8, quantity: '10000000000', fiatRate: 0.5, imageUrl: DEMO_TOKEN_ICONS.EXAMPLE }, // 100 EXAMPLE
            // Divisible tokens; appear in Tokens tab
            // XChain gas + staking token. Liquid 10,000 here; the staking
            // dashboard demo (synthesizeDemoStaking) shows a further 50,000
            // staked, so the two surfaces tell one consistent story.
            { tick: 'XCHAIN', displayName: 'XChain', divisibility: 8, quantity: '1000000000000', fiatRate: 1.25 }, // 10,000 XCHAIN
            { tick: 'XCP', displayName: 'Counterparty', divisibility: 8, quantity: '1000000000000', fiatRate: 30 }, // 10,000 XCP
            // PEPECASH carries an image, so it appears in BOTH Tokens (row) and NFTs (tile)
            { tick: 'PEPECASH', displayName: 'PEPECASH', divisibility: 8, quantity: '10000000000', fiatRate: 0.0008, imageUrl: DEMO_TOKEN_ICONS.PEPECASH },
            { tick: 'USDX', displayName: 'USD Stablecoin (demo)', divisibility: 8, quantity: '25000000000', fiatRate: 1 },
            { tick: 'DEMOCOIN', displayName: 'Demo Coin', divisibility: 8, quantity: '100000000', fiatRate: 0.05 },
            // Indivisible tokens; also appear in NFTs because they have an imageUrl
            { tick: 'RAREPEPE', displayName: 'Rare Pepe', divisibility: 0, quantity: '1', fiatRate: 500, imageUrl: DEMO_TOKEN_ICONS.RAREPEPE },
            { tick: 'BITCRYSTAL', displayName: 'Bitcrystals', divisibility: 0, quantity: '1', fiatRate: 200, imageUrl: nftImg('BIT', '#1565C0', '#00838F') },
            { tick: 'XCHAINLOGO', displayName: 'XChain Logo NFT', divisibility: 0, quantity: '1', fiatRate: 50, imageUrl: nftImg('XC', '#1E90C7', '#7B2C8F') },
            // Showcase NFT. Demo wallets always hold a Pepe Creature so the
            // featured-token / gated-content path has something to land on.
            { tick: 'PEPECREATURE', displayName: 'Pepe Creature', divisibility: 0, quantity: '1', fiatRate: 800, imageUrl: DEMO_TOKEN_ICONS.PEPECREATURE },
        ],
    },
    'litecoin-mainnet': {
        native: { tick: 'LTC', divisibility: 8, quantity: '500000000', fiatRate: 90 }, // 5 LTC ≈ $450
        tokens: [
            // Divisible LTC-side tokens
            { tick: 'LITECRED', displayName: 'LiteCred Stablecoin', divisibility: 8, quantity: '15000000000', fiatRate: 1 }, // 150 LITECRED
            { tick: 'OMNILITE', displayName: 'OmniLite Token', divisibility: 8, quantity: '4200000000', fiatRate: 3.10 }, // 42 OMNILITE
            { tick: 'MWEB', displayName: 'MimbleWimble Token', divisibility: 8, quantity: '2500000000', fiatRate: 6 }, // 25 MWEB
            // Indivisible (NFTs tab)
            { tick: 'LITEORD', displayName: 'Lite Ordinal #042', divisibility: 0, quantity: '1', fiatRate: 45, imageUrl: nftImg('LO42', '#0EA5E9', '#1E40AF') },
            { tick: 'MIMBLEPUNK', displayName: 'MimblePunk #7', divisibility: 0, quantity: '1', fiatRate: 95, imageUrl: nftImg('MP7', '#06B6D4', '#0369A1') },
        ],
    },
    'litecoin-regtest': {
        native: { tick: 'LTC', divisibility: 8, quantity: '100000000000', fiatRate: 80 }, // 1000 rLTC @ $80
        tokens: [
            // Divisible LTC-side tokens
            { tick: 'LITECRED', displayName: 'LiteCred Stablecoin (demo)', divisibility: 8, quantity: '50000000000', fiatRate: 1 },
            { tick: 'MWEB', displayName: 'MimbleWimble Token', divisibility: 8, quantity: '7500000000', fiatRate: 5 },
            { tick: 'LTCDOGE', displayName: 'LTC × DOGE Pair', divisibility: 8, quantity: '12500000000', fiatRate: 2 },
            // Indivisible (NFTs tab, have imageUrl)
            { tick: 'LITEORD', displayName: 'Lite Ordinal #042', divisibility: 0, quantity: '1', fiatRate: 40, imageUrl: nftImg('LO42', '#0EA5E9', '#1E40AF') },
            { tick: 'MIMBLEPUNK', displayName: 'MimblePunk #7', divisibility: 0, quantity: '1', fiatRate: 80, imageUrl: nftImg('MP7', '#06B6D4', '#0369A1') },
        ],
    },
    'dogecoin-mainnet': {
        native: { tick: 'DOGE', divisibility: 8, quantity: '500000000000', fiatRate: 0.18 }, // 5000 DOGE ≈ $900
        tokens: [
            // Divisible DRC-20-style tokens
            { tick: 'DOGI', displayName: 'Dogi Coin', divisibility: 8, quantity: '250000000000', fiatRate: 0.012 }, // 2500 DOGI
            { tick: 'WOW', displayName: 'Wow Such Token', divisibility: 8, quantity: '7500000000', fiatRate: 0.45 }, // 75 WOW
            { tick: 'DSHIB', displayName: 'Doge Shib', divisibility: 8, quantity: '5000000000000', fiatRate: 0.00009 }, // 50,000 DSHIB
            // Indivisible (NFTs tab)
            { tick: 'DOGINAL', displayName: 'Doginal #1337', divisibility: 0, quantity: '1', fiatRate: 18, imageUrl: DEMO_TOKEN_ICONS.DOGINAL },
            { tick: 'MEMECARD', displayName: 'Meme Card: To The Moon', divisibility: 0, quantity: '1', fiatRate: 32, imageUrl: nftImg('MOON', '#EAB308', '#92400E') },
        ],
    },
    'dogecoin-regtest': {
        native: { tick: 'DOGE', divisibility: 8, quantity: '1000000000000', fiatRate: 0.15 }, // 10000 rDOGE @ $0.15
        tokens: [
            // Divisible DRC-20-style tokens
            { tick: 'DOGI', displayName: 'Dogi Coin', divisibility: 8, quantity: '500000000000', fiatRate: 0.01 },
            { tick: 'WOW', displayName: 'Wow Such Token', divisibility: 8, quantity: '12500000000', fiatRate: 0.5 },
            { tick: 'DSHIB', displayName: 'Doge Shib', divisibility: 8, quantity: '7500000000000', fiatRate: 0.0001 },
            { tick: 'BARK', displayName: 'Bark Stablecoin (demo)', divisibility: 8, quantity: '20000000000', fiatRate: 1 },
            // Indivisible (NFTs tab, have imageUrl)
            { tick: 'DOGINAL', displayName: 'Doginal #1337', divisibility: 0, quantity: '1', fiatRate: 15, imageUrl: DEMO_TOKEN_ICONS.DOGINAL },
            { tick: 'MEMECARD', displayName: 'Meme Card: To The Moon', divisibility: 0, quantity: '1', fiatRate: 30, imageUrl: nftImg('MOON', '#EAB308', '#92400E') },
        ],
    },
});

/**
 * Build a `Record<chainId, AddressBalancesEntry[]>` shape (the same
 * shape `messaging.getWalletBalances` returns) from a wallet's real
 * address records. The first address per chain gets the full fixture;
 * additional addresses get `null` balances so the row still renders.
 *
 * @param {Record<string, Array<{ address: string, label: string, addressType: string, derivationPath: string | null }>>} addressesByChain
 * @returns {Record<string, Array<{ address: string, label: string, addressType: string, derivationPath: string | null, balances: BalanceFixture | null, error: null }>>}
 */
export function synthesizeDemoBalances(addressesByChain) {
    /** @type {Record<string, any[]>} */
    const out = {};
    if (!addressesByChain || typeof addressesByChain !== 'object') return out;
    for (const [chainId, addrs] of Object.entries(addressesByChain)) {
        if (!Array.isArray(addrs) || addrs.length === 0) continue;
        const fixture = PER_CHAIN_DEFAULTS[chainId] || null;
        out[chainId] = addrs.map((a, idx) => ({
            address: a.address,
            label: a.label || '',
            addressType: a.addressType,
            derivationPath: a.derivationPath ?? null,
            balances: idx === 0 && fixture
                ? { native: fixture.native, tokens: fixture.tokens }
                : { native: fixture?.native ? { ...fixture.native, quantity: '0' } : null, tokens: [] },
            error: null,
        }));
    }
    return out;
}

// Fixed 24-hour moves for the demo wallet's native coins, one per
// coin family (the three networks of a family share a figure, the way
// they share a fixture). Chosen to read as an ordinary day rather than
// a rally: one coin up, one flat-ish, one down, so the hero's change
// line and its colour states are both visible in a demo.
//
// These exist because a demo wallet used to take its 24h change from
// the LIVE price oracle while every other number on the screen was
// synthetic - so the figure was a real market move applied to
// imaginary holdings, it made a third-party request from a wallet that
// is supposed to fetch nothing, and it was the last input keeping two
// store-listing captures of one tree from matching: whether the fetch
// landed before the screenshot decided whether the whole card below it
// sat 24px lower.
const DEMO_NATIVE_CHANGE_24H_PCT = /** @type {Record<string, number>} */ ({
    bitcoin: 1.24,
    litecoin: -0.72,
    dogecoin: 3.15,
});

/**
 * Native-coin price entries for a demo wallet, in the shape
 * `messaging.getNativePricesRequest` returns (`{ [chainId]: entry | null }`).
 * The rate is the same one the balance fixtures price the holdings
 * with, so the hero's total and its change line agree.
 *
 * `sparkline` is deliberately null: the portfolio chart falls back to
 * its own seeded walk when there is no real series, and that walk is
 * already stable per demo wallet. A fabricated sparkline here would be
 * a second, redundant source for the same line.
 *
 * @param {string[]} chainIds
 * @returns {Record<string, { priceFiat: number, change24hPct: number, marketCapFiat: null, sparkline: null } | null>}
 */
export function synthesizeDemoNativePrices(chainIds) {
    /** @type {Record<string, any>} */
    const out = {};
    if (!Array.isArray(chainIds)) return out;
    for (const chainId of chainIds) {
        const fixture = PER_CHAIN_DEFAULTS[chainId];
        const family = String(chainId).split('-')[0];
        const pct = DEMO_NATIVE_CHANGE_24H_PCT[family];
        const rate = fixture?.native?.fiatRate;
        out[chainId] = typeof pct === 'number' && typeof rate === 'number'
            ? { priceFiat: rate, change24hPct: pct, marketCapFiat: null, sparkline: null }
            : null;
    }
    return out;
}

/**
 * Build a synthesized history feed for a demo wallet's first address
 * on a given chain. Two entries: an incoming SEND from a known faucet,
 * and a recent ISSUE that mints a fictional token.
 *
 * @param {string} chainId
 * @param {string} address
 * @param {object} [opts]
 * @param {number} [opts.now]   clock injection for tests
 * @returns {Array<{ txHash: string, blockIndex: number | null, timestamp: number, action: string, params: Record<string, unknown> }>}
 */
export function synthesizeDemoHistory(chainId, address, opts = {}) {
    if (typeof address !== 'string' || !address) return [];
    const now = typeof opts.now === 'number' ? opts.now : Date.now();
    const fixture = PER_CHAIN_DEFAULTS[chainId];
    if (!fixture || !fixture.native) return [];
    const tick = fixture.native.tick;
    const sec = (deltaSec) => Math.floor(now / 1000) - deltaSec;

    // Pick a representative divisible token and a representative
    // indivisible (NFT-ish) token from this chain's tick list to drive
    // the token-receive synth rows. Prefer tokens that carry an
    // imageUrl so the Activity row exercises the token-image path
    // instead of falling back to the tinted-letter placeholder.
    const divisibleToken = (fixture.tokens || []).find((a) => a.divisibility > 0 && a.imageUrl)
        || (fixture.tokens || []).find((a) => a.divisibility > 0);
    const indivisibleToken = (fixture.tokens || []).find((a) => a.divisibility === 0 && a.imageUrl)
        || (fixture.tokens || []).find((a) => a.divisibility === 0);

    // Rows mirror the real `getAddressHistory` shape: top-level
    // action_index / tx_hash / block_index / source / destination /
    // tick / tick / amount; so History.jsx accepts them as entries
    // (it skips rows without action_index, and summarizeRow / search
    // read flat top-level fields). The `params` nest is preserved so
    // HomeTabs' demo activity list (which reads `r.params.*`) keeps
    // working unchanged.
    const rows = [];

    // Native receive (newest, pending).
    rows.push({
        action_index: 100001,
        tx_hash: `demo-${chainId}-incoming-1`,
        txHash: `demo-${chainId}-incoming-1`,
        block_index: null, // pending; exercises the timeline pending state
        blockIndex: null,
        timestamp: sec(180),
        action: 'SEND',
        source: 'demo-faucet-1xchainpubdemoxchain',
        destination: address,
        tick,
        amount: fixture.native.quantity,
        quantity: fixture.native.quantity,
        memo: 'Welcome to the demo wallet',
        params: {
            source: 'demo-faucet-1xchainpubdemoxchain',
            destination: address,
                amount: fixture.native.quantity,
            memo: 'Welcome to the demo wallet',
        },
    });

    // Token receive: a friend tipped us some of the first divisible
    // token on this chain. Exercises the "non-native receive" row in
    // Activity so the icon swaps to the token's image / tinted letter
    // instead of the chain icon.
    if (divisibleToken) {
        const tokenAmount = '100000000'; // 1.0 of an 8-divisibility token
        rows.push({
            action_index: 100011,
            tx_hash: `demo-${chainId}-token-recv-1`,
            txHash: `demo-${chainId}-token-recv-1`,
            block_index: 12415,
            blockIndex: 12415,
            timestamp: sec(900),
            action: 'SEND',
            source: 'demo-friend-1xchainpubsendertoken',
            destination: address,
            tick: divisibleToken.tick,
            amount: tokenAmount,
            quantity: tokenAmount,
            memo: `gift: ${divisibleToken.tick}`,
            params: {
                source: 'demo-friend-1xchainpubsendertoken',
                destination: address,
                amount: tokenAmount,
                tick: divisibleToken.tick,
            },
        });
    }

    // NFT / indivisible receive: someone shipped us a 1-of-1 collectible.
    if (indivisibleToken) {
        rows.push({
            action_index: 100012,
            tx_hash: `demo-${chainId}-nft-recv-1`,
            txHash: `demo-${chainId}-nft-recv-1`,
            block_index: 12418,
            blockIndex: 12418,
            timestamp: sec(420),
            action: 'SEND',
            source: 'demo-collector-1xchainpubnftsender',
            destination: address,
            tick: indivisibleToken.tick,
            amount: '1',
            quantity: '1',
            params: {
                source: 'demo-collector-1xchainpubnftsender',
                destination: address,
                amount: '1',
                tick: indivisibleToken.tick,
            },
        });
    }

    rows.push(
        {
            action_index: 100002,
            tx_hash: `demo-${chainId}-outgoing-1`,
            txHash: `demo-${chainId}-outgoing-1`,
            block_index: 12410,
            blockIndex: 12410,
            timestamp: sec(3_600),
            action: 'SEND',
            source: address,
            destination: 'demo-friend-1xchainpubrecipient',
            tick,
            amount: '5000000', // 0.05 of the native coin
            quantity: '5000000',
            memo: 'thanks for lunch',
            params: {
                source: address,
                destination: 'demo-friend-1xchainpubrecipient',
                    amount: '5000000',
                memo: 'thanks for lunch',
            },
        },
        {
            action_index: 100003,
            tx_hash: `demo-${chainId}-issue-1`,
            txHash: `demo-${chainId}-issue-1`,
            block_index: 12345,
            blockIndex: 12345,
            timestamp: sec(86_400),
            action: 'ISSUE',
            source: address,
            tick: 'DEMOCOIN',
            amount: '100000000',
            quantity: '100000000',
            divisible: true,
            description: 'Demo token issued during the demo session.',
            params: {
                source: address,
                    quantity: '100000000',
                divisible: true,
                description: 'Demo token issued during the demo session.',
            },
        },
        {
            action_index: 100004,
            tx_hash: `demo-${chainId}-dividend-1`,
            txHash: `demo-${chainId}-dividend-1`,
            block_index: 12380,
            blockIndex: 12380,
            timestamp: sec(43_200),
            action: 'DIVIDEND',
            source: 'demo-issuer-1xchainpubdivissuer',
            tick: 'PEPECASH',
            dividend_asset: tick,
            quantity_per_unit: '100',
            params: {
                source: 'demo-issuer-1xchainpubdivissuer',
                    dividend_asset: tick,
                quantity_per_unit: '100',
            },
        },
        {
            action_index: 100005,
            tx_hash: `demo-${chainId}-order-1`,
            txHash: `demo-${chainId}-order-1`,
            block_index: 12390,
            blockIndex: 12390,
            timestamp: sec(21_600),
            action: 'ORDER',
            source: address,
            // ORDER's "currency" is the give-side ticker. Surface it at
            // the top-level tick/tick so this row is searchable by the
            // native ticker (the TokenDetail → View activity flow opens
            // History pre-filtered to the tick).
            tick,
            give_asset: tick,
            give_quantity: '2000000',
            get_asset: 'XCP',
            get_quantity: '100000000',
            status: 'filled',
            params: {
                source: address,
                give_asset: tick,
                give_quantity: '2000000',
                get_asset: 'XCP',
                get_quantity: '100000000',
                status: 'filled',
            },
        },
        {
            action_index: 100006,
            tx_hash: `demo-${chainId}-execute-1`,
            txHash: `demo-${chainId}-execute-1`,
            block_index: 12420,
            blockIndex: 12420,
            timestamp: sec(1_800),
            action: 'EXECUTE',
            source: address,
            tick,
            contract: 'demo-contract-vault',
            method: 'withdraw',
            amount: '0.25',
            params: {
                source: address,
                contract: 'demo-contract-vault',
                method: 'withdraw',
                amount: '0.25',
            },
        },
        // Two ORDER_MATCH rows referencing the ORDER above (action_index
        // 100005) via `order_action_index`; grouping collapses these
        // under the ORDER leader card in grouped mode, keeps them as
        // separate rows in flat mode. Gives the user something visible
        // to toggle between.
        {
            action_index: 100007,
            tx_hash: `demo-${chainId}-order-match-1`,
            txHash: `demo-${chainId}-order-match-1`,
            block_index: 12395,
            blockIndex: 12395,
            timestamp: sec(15_000),
            action: 'ORDER_MATCH',
            source: address,
            tick,
            order_action_index: '100005',
            tx0_index: '100005',
            forward_asset: tick,
            forward_quantity: '1000000',
            backward_asset: 'XCP',
            backward_quantity: '50000000',
            params: {
                source: address,
                order_action_index: '100005',
                forward_asset: tick,
                forward_quantity: '1000000',
                backward_asset: 'XCP',
                backward_quantity: '50000000',
            },
        },
        {
            action_index: 100008,
            tx_hash: `demo-${chainId}-order-match-2`,
            txHash: `demo-${chainId}-order-match-2`,
            block_index: 12400,
            blockIndex: 12400,
            timestamp: sec(9_000),
            action: 'ORDER_MATCH',
            source: address,
            tick,
            order_action_index: '100005',
            tx0_index: '100005',
            forward_asset: tick,
            forward_quantity: '1000000',
            backward_asset: 'XCP',
            backward_quantity: '50000000',
            params: {
                source: address,
                order_action_index: '100005',
                forward_asset: tick,
                forward_quantity: '1000000',
                backward_asset: 'XCP',
                backward_quantity: '50000000',
            },
        },
        // SWEEP (standalone, demonstrates another action type).
        {
            action_index: 100009,
            tx_hash: `demo-${chainId}-sweep-1`,
            txHash: `demo-${chainId}-sweep-1`,
            block_index: 12360,
            blockIndex: 12360,
            timestamp: sec(60_000),
            action: 'SWEEP',
            source: address,
            destination: 'demo-cold-storage-1xchainpubcold',
            tick,
            amount: '2500000',
            quantity: '2500000',
            memo: 'Move to cold storage',
            params: {
                source: address,
                destination: 'demo-cold-storage-1xchainpubcold',
                    amount: '2500000',
                memo: 'Move to cold storage',
            },
        },
    );

    return rows;
}

/**
 * Synthesized DeFi action entries for the demo wallet. Each row is a
 * single discrete on-chain DeFi action (a stake, a dispenser creation,
 * a contract deployment / execution) rather than a position snapshot.
 * This lets the DeFi tab render as a History-style feed of recent actions.
 *
 * Stakes are XCHAIN-only because that's what the protocol actually
 * supports; dispensers and contracts can wrap any token. Title /
 * secondary / badge are preserved so a future detail view can show
 * them, but the list-row render only consumes `action / primary /
 * blockIndex / timestamp / status / confirms / chainId`.
 *
 * @param {object} [opts]
 * @param {number} [opts.now]   clock injection for tests and for the
 *                              store-listing capture, which freezes every
 *                              demo clock so two captures of an unchanged
 *                              tree produce byte-identical images
 *                              (flows/demoCapture.js)
 * @returns {Array<{ id: string, kind: 'stake' | 'dispenser' | 'contract', action: string, status: 'confirmed' | 'pending' | 'failed', title: string, primary: string, secondary: string, badge: string, blockIndex: number | null, timestamp: number, confirms: number, chain: string, chainId: string, tick?: string }>}
 */
export function synthesizeDemoDefiPositions(opts = {}) {
    const now = typeof opts.now === 'number' ? opts.now : Date.now();
    const nowSec = Math.floor(now / 1000);
    const ago = (delta) => nowSec - delta;
    return [
        // ───── Mainnet ─────
        // Bitcoin mainnet
        {
            id: 'demo-stake-xchain-btc-mainnet',
            kind: 'stake', action: 'STAKE', status: 'confirmed',
            title: 'XCHAIN stake', primary: '10,000.00000000 XCHAIN',
            secondary: 'Delegated to xchainpub-validator-7 · 4.2% APY', badge: 'Active',
            blockIndex: 12_420, timestamp: ago(60 * 30), confirms: 8,
            chain: 'BITCOIN', chainId: 'bitcoin-mainnet',
        },
        {
            id: 'demo-dispenser-rustbits-mainnet',
            kind: 'dispenser', action: 'DISPENSER', status: 'confirmed',
            title: 'RUSTBITS dispenser', primary: '120 RUSTBITS remaining',
            secondary: '0.0005 BTC per dispense · 8 dispenses so far', badge: 'Open',
            blockIndex: 12_385, timestamp: ago(60 * 60 * 5), confirms: 43,
            chain: 'BITCOIN', chainId: 'bitcoin-mainnet', tick: 'RUSTBITS',
        },
        // Litecoin mainnet: stake doesn't exist outside Bitcoin in
        // the current protocol; only dispensers and contracts on LTC.
        {
            id: 'demo-dispenser-litecred-mainnet',
            kind: 'dispenser', action: 'DISPENSER', status: 'confirmed',
            title: 'LITECRED dispenser', primary: '500 LITECRED remaining',
            secondary: '0.2 LTC per dispense · 3 dispenses so far', badge: 'Open',
            blockIndex: 4_512_010, timestamp: ago(60 * 60 * 18), confirms: 96,
            chain: 'LITECOIN', chainId: 'litecoin-mainnet', tick: 'LITECRED',
        },
        // Dogecoin mainnet: stake is Bitcoin-only.
        {
            id: 'demo-dispenser-dogi-mainnet',
            kind: 'dispenser', action: 'DISPENSER', status: 'confirmed',
            title: 'DOGI dispenser', primary: '3,000 DOGI remaining',
            secondary: '20 DOGE per dispense · 14 dispenses so far', badge: 'Open',
            blockIndex: 5_212_205, timestamp: ago(60 * 60 * 28), confirms: 235,
            chain: 'DOGECOIN', chainId: 'dogecoin-mainnet', tick: 'DOGI',
        },

        // ───── Regtest ─────
        // Bitcoin regtest
        {
            id: 'demo-stake-xchain-btc',
            kind: 'stake', action: 'STAKE', status: 'confirmed',
            title: 'XCHAIN stake', primary: '50,000.00000000 XCHAIN',
            secondary: 'Delegated to demo-validator-7 · 4.2% APY', badge: 'Active',
            blockIndex: 12_410, timestamp: ago(60 * 60 * 2), confirms: 12,
            chain: 'BITCOIN', chainId: 'bitcoin-regtest',
        },
        {
            id: 'demo-dispenser-democoin',
            kind: 'dispenser', action: 'DISPENSER', status: 'confirmed',
            title: 'DEMOCOIN dispenser', primary: '500 DEMOCOIN remaining',
            secondary: '0.001 BTC per dispense · 12 dispenses so far', badge: 'Open',
            blockIndex: 12_380, timestamp: ago(60 * 60 * 8), confirms: 42,
            chain: 'BITCOIN', chainId: 'bitcoin-regtest', tick: 'DEMOCOIN',
        },
        {
            id: 'demo-contract-vault',
            kind: 'contract', action: 'CONTRACT', status: 'confirmed',
            title: 'BTC vault contract', primary: '0.25 BTC locked',
            secondary: 'demo-contract-vault · withdraw window in 14h', badge: 'Vault',
            blockIndex: 12_395, timestamp: ago(60 * 60 * 4), confirms: 27,
            chain: 'BITCOIN', chainId: 'bitcoin-regtest', tick: 'BTC',
        },
        // Litecoin regtest: stake is Bitcoin-only.
        {
            id: 'demo-dispenser-litecred',
            kind: 'dispenser', action: 'DISPENSER', status: 'confirmed',
            title: 'LITECRED dispenser', primary: '2,000 LITECRED remaining',
            secondary: '0.5 LTC per dispense · 6 dispenses so far', badge: 'Open',
            blockIndex: 7_810, timestamp: ago(60 * 60 * 30), confirms: 220,
            chain: 'LITECOIN', chainId: 'litecoin-regtest', tick: 'LITECRED',
        },
        // Dogecoin regtest: stake is Bitcoin-only.
        {
            id: 'demo-dispenser-dogi',
            kind: 'dispenser', action: 'DISPENSER', status: 'confirmed',
            title: 'DOGI dispenser', primary: '10,000 DOGI remaining',
            secondary: '50 DOGE per dispense · 22 dispenses so far', badge: 'Open',
            blockIndex: 9_190, timestamp: ago(60 * 60 * 26), confirms: 170,
            chain: 'DOGECOIN', chainId: 'dogecoin-regtest', tick: 'DOGI',
        },
        {
            id: 'demo-contract-doge-vault',
            kind: 'contract', action: 'CONTRACT', status: 'confirmed',
            title: 'DOGE memepool vault', primary: '5,000 DOGE locked',
            secondary: 'demo-contract-memepool · withdraw window in 3d', badge: 'Vault',
            blockIndex: 9_205, timestamp: ago(60 * 60 * 15), confirms: 120,
            chain: 'DOGECOIN', chainId: 'dogecoin-regtest', tick: 'DOGE',
        },
    ];
}

// Validator (capability) staking positions for the §42.7.4 staking
// surfaces (StakingList rows + the validator StakeDetail). The live
// path fans out messaging.getStakes / getDelegations / getRewards per
// address and merges them into one { stakes, delegations, rewards }
// aggregate; the demo path drops this in instead. Only bitcoin-regtest
// is populated: staking is BTC-only and the demo wallet holds BTC
// addresses on regtest. The narrative matches the DeFi-tab
// "XCHAIN stake delegated to demo-validator-7" position above.
// Contract-flavored positions live in DEMO_CONTRACT_STAKES_BY_CHAIN
// below; keeping them out of this lane avoids duplicate rows in the
// unified staking list.
const DEMO_STAKING_BY_CHAIN = {
    'bitcoin-regtest': {
        stakes: [
            // The validator position: XCHAIN staked toward the cross-chain
            // operator capability. This is stakes[0], so it drives the
            // "Staked" headline and the Unstake/Delegate/Operator actions.
            {
                stake_id: 'demo-stake-validator',
                asset: 'XCHAIN',
                amount: '50000',
                capability: 'cross_chain',
                capability_label: 'Validator · cross-chain operator',
                status: 'active',
                block_index: 12_410,
            },
        ],
        delegations: [
            {
                delegation_id: 'demo-delegation-validator-7',
                signing_pubkey: '02a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f901',
                status: 'active',
                block_index: 12_412,
            },
        ],
        // Two claimed + one pending; splitRewards() sums all three for
        // "Lifetime" (80.25) and only the pending one for "Pending" (12.5).
        rewards: [
            { action_index: 'demo-reward-3', amount: 12.5, status: 'pending', block_index: 12_470 },
            { action_index: 'demo-reward-2', amount: 40, status: 'claimed', block_index: 12_300 },
            { action_index: 'demo-reward-1', amount: 27.75, status: 'claimed', block_index: 12_120 },
        ],
    },
};

/**
 * Demo validator-staking data for the §42.7.4 staking surfaces, shaped like the
 * { stakes, delegations, rewards } aggregate the staking list builds from
 * the live per-address fan-out. Returns empty arrays for chains without
 * a fixture. Fresh object copies each call so the list's in-place
 * block-index sort can't mutate the module-level fixture.
 *
 * @param {string} chainId
 * @returns {{ stakes: any[], delegations: any[], rewards: any[] }}
 */
export function synthesizeDemoStaking(chainId) {
    const fixture = DEMO_STAKING_BY_CHAIN[chainId];
    if (!fixture) return { stakes: [], delegations: [], rewards: [] };
    return {
        stakes: fixture.stakes.map((s) => ({ ...s })),
        delegations: fixture.delegations.map((d) => ({ ...d })),
        rewards: fixture.rewards.map((r) => ({ ...r })),
    };
}

// Contract-targeted staking positions for the contract rows in
// StakingList / StakeDetail. Distinct from the capability staking
// above: here a token is locked into a specific contract, with a cooldown
// on unstake and a slash destination. Only bitcoin-regtest is populated
// (staking is BTC-only). The 1,000 EXAMPLE in contract #1024 matches the
// DeFi-tab narrative, so the surfaces tell one story.
const DEMO_CONTRACT_STAKES_BY_CHAIN = {
    'bitcoin-regtest': {
        stakes: [
            {
                action_index: 'demo-cstake-1024',
                target_contract_index: '1024',
                tick: 'EXAMPLE',
                amount: '1000',
                signing_pubkey: '02a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f901',
            },
            {
                action_index: 'demo-cstake-2048',
                target_contract_index: '2048',
                tick: 'PEPECASH',
                amount: '25000',
                signing_pubkey: '03f0e1d2c3b4a5968778695a4b3c2d1e0fa1b2c3d4e5f60718293a4b5c6d7e8f9',
            },
        ],
        // A position mid-cooldown: slashable until cooldown_end_block.
        unstakes: [
            {
                action_index: 'demo-custake-2048',
                target_contract_index: '2048',
                tick: 'PEPECASH',
                amount: '5000',
                cooldown_end_block: 12_650,
            },
        ],
        slashEvents: [
            {
                action_index: 'demo-slash-2048',
                target_contract_index: '2048',
                tick: 'PEPECASH',
                amount: '250',
                block_index: 12_500,
                destination_address: 'bcrt1qdemoslashdest0xchain0treasury0demo0addr',
            },
        ],
    },
};

/**
 * Demo contract-staking data for the staking surfaces, shaped like
 * the { stakes, unstakes, slashEvents } aggregate the components
 * builds from its per-address fan-out. Returns empty arrays for chains
 * without a fixture. Fresh copies each call so downstream code can't
 * mutate the module-level fixture.
 *
 * @param {string} chainId
 * @returns {{ stakes: any[], unstakes: any[], slashEvents: any[] }}
 */
export function synthesizeDemoContractStakes(chainId) {
    const fixture = DEMO_CONTRACT_STAKES_BY_CHAIN[chainId];
    if (!fixture) return { stakes: [], unstakes: [], slashEvents: [] };
    return {
        stakes: fixture.stakes.map((s) => ({ ...s })),
        unstakes: fixture.unstakes.map((u) => ({ ...u })),
        slashEvents: fixture.slashEvents.map((e) => ({ ...e })),
    };
}

// Deploy-time staking metadata for the demo contracts above, shaped like
// the row `contracts.byActionIndex` returns. Without this, the demo
// StakeDetail hero can't show cooldown/slash destination and
// ContractStakeForm's stakeable gate (cooldown_blocks set at DEPLOY)
// rejects the very contracts the demo says you hold positions in. The
// slash destination matches the slash-event fixture so the #2048 story
// stays coherent.
const DEMO_CONTRACT_META_BY_CHAIN = {
    'bitcoin-regtest': {
        1024: {
            contract_action_index: '1024',
            cooldown_blocks: 144,
            slash_destination: 'bcrt1qdemoslashdest0xchain0treasury0demo0addr',
        },
        2048: {
            contract_action_index: '2048',
            cooldown_blocks: 240,
            slash_destination: 'bcrt1qdemoslashdest0xchain0treasury0demo0addr',
        },
    },
};

/**
 * Demo contract deploy metadata (cooldown + slash destination) for one
 * contract, or null for contracts/chains without a fixture. Fresh copy
 * each call so downstream code can't mutate the module-level fixture.
 *
 * @param {string} chainId
 * @param {string|number} contractActionIndex
 * @returns {{ contract_action_index: string, cooldown_blocks: number, slash_destination: string } | null}
 */
export function synthesizeDemoContractMeta(chainId, contractActionIndex) {
    const meta = DEMO_CONTRACT_META_BY_CHAIN[chainId]?.[String(contractActionIndex)];
    return meta ? { ...meta } : null;
}

/**
 * Synthesize the response shape `messaging.getLinksForAddress` returns
 * for a demo wallet (empty for now; cross-chain LINK fabrication is
 * a deeper exercise). Callers' .catch(() => []) path already handles
 * an empty list gracefully; this export exists so the shell can opt
 * out of the live call entirely without faking an SDK error.
 *
 * @returns {Array<unknown>}
 */
export function synthesizeDemoLinks() {
    return [];
}

// Illustrative per-token coin price (native-coin units per 1 token) used
// only to make the demo Marketplace numbers look plausible. Keyed by the
// chain's native ticker; arbitrary round values, not market data.
const DEMO_COIN_UNIT_PRICE = { BTC: 0.00002, LTC: 0.004, DOGE: 0.6 };

/**
 * Synthesize the four feeds the §41 Marketplace (MarketActivity) page
 * renders for a searched token: open dispensers, recent dispenses,
 * open DEX orders, and recent DEX swaps. Mirrors the demo pattern used
 * by {@link synthesizeDemoHistory} so the demo wallet shows a populated
 * Marketplace instead of hitting a live explorer it has no backend for.
 *
 * The token is matched against the mainnet balance fixtures; searching
 * any token the demo wallet can hold (e.g. PEPECASH, RAREPEPE, XCP on
 * Bitcoin; OMNILITE, MWEB on Litecoin; DOGI, WOW on Dogecoin) returns
 * activity on that token's home chain. An unrecognized ticker returns
 * empty feeds, exactly as a real explorer would for a token with no
 * market.
 *
 * Each feed entry is already wrapped as `{ chainId, row }`, the shape
 * MarketActivity builds per-chain, so the caller can set state directly.
 *
 * @param {string} token  ticker the user searched for
 * @param {{ now?: number }} [opts]
 * @returns {{ offers: Array<{chainId: string, row: any}>, sales: Array<{chainId: string, row: any}>, dexOrders: Array<{chainId: string, row: any}>, dexSwaps: Array<{chainId: string, row: any}> }}
 */
export function synthesizeDemoMarketActivity(token, opts = {}) {
    const tick = String(token || '').trim().toUpperCase();
    const empty = { offers: [], sales: [], dexOrders: [], dexSwaps: [] };
    if (!tick) return empty;

    const now = typeof opts.now === 'number' ? opts.now : Date.now();
    const sec = (deltaSec) => Math.floor(now / 1000) - deltaSec;

    // Locate the mainnet chain whose fixture lists this token. Mainnet
    // only; that's the network the demo balances (and the chain badge
    // the user is looking at) are on.
    let chainId = null;
    for (const [cid, fix] of Object.entries(PER_CHAIN_DEFAULTS)) {
        if (!cid.endsWith('-mainnet')) continue;
        if ((fix.tokens || []).some((t) => t.tick.toUpperCase() === tick)) {
            chainId = cid;
            break;
        }
    }
    // Featured / platform tokens (e.g. XCHAIN) and anything the demo wallet
    // doesn't hold still get a demo market, homed on Bitcoin, so the
    // Marketplace landing page is never empty in the demo.
    if (!chainId) {
        chainId = PER_CHAIN_DEFAULTS['bitcoin-mainnet']
            ? 'bitcoin-mainnet'
            : Object.keys(PER_CHAIN_DEFAULTS).find((cid) => cid.endsWith('-mainnet'));
    }
    if (!chainId) return empty;

    const coinTick = PER_CHAIN_DEFAULTS[chainId].native.tick; // BTC / LTC / DOGE
    const unit = DEMO_COIN_UNIT_PRICE[coinTick] ?? 0.00002;
    // Coin amount that `qty` of the token is priced at, trimmed to a
    // clean 8-dp value so toLocaleString() reads nicely.
    const px = (qty) => Number((unit * qty).toFixed(8));
    const wrap = (row) => ({ chainId, row });

    const offers = [
        { action_index: 900101, status: 0, give_quantity: 1000, get_tick: coinTick, get_quantity: px(1000), give_remaining: 7500 },
        { action_index: 900102, status: 0, give_quantity: 500, get_tick: coinTick, get_quantity: px(500), give_remaining: 2000 },
    ].map(wrap);

    const sales = [
        { tx_hash: `demo-${chainId}-dispense-1`, give_quantity: 1000, get_tick: coinTick, get_quantity: px(1000), timestamp: sec(3_600) },
        { tx_hash: `demo-${chainId}-dispense-2`, give_quantity: 250, get_tick: coinTick, get_quantity: px(250), timestamp: sec(14_400) },
        { tx_hash: `demo-${chainId}-dispense-3`, give_quantity: 2000, get_tick: coinTick, get_quantity: px(2000), timestamp: sec(86_400) },
    ].map(wrap);

    const dexOrders = [
        // A sell (give the token, get coin) and a buy (give coin, get the token).
        { action_index: 900201, give_tick: tick, give_quantity: 5000, get_tick: coinTick, get_quantity: px(5000) },
        { action_index: 900202, give_tick: coinTick, give_quantity: px(3000), get_tick: tick, get_quantity: 3000 },
    ].map(wrap);

    const dexSwaps = [
        { tx_hash: `demo-${chainId}-swap-1`, give_tick: tick, give_quantity: 1500, get_tick: coinTick, get_quantity: px(1500), timestamp: sec(7_200) },
        { tx_hash: `demo-${chainId}-swap-2`, give_tick: coinTick, give_quantity: px(800), get_tick: tick, get_quantity: 800, timestamp: sec(18_000) },
        { tx_hash: `demo-${chainId}-swap-3`, give_tick: tick, give_quantity: 4200, get_tick: coinTick, get_quantity: px(4200), timestamp: sec(90_000) },
    ].map(wrap);

    return { offers, sales, dexOrders, dexSwaps };
}

// Five contacts seeded into a fresh demo wallet so the address book, Send
// picker, Contacts screen, and message inbox all show realistic contact data.
// Each spans one to three chains. Addresses are illustrative demo strings
// (AddressText truncates them); the first contact's Bitcoin address doubles as
// a messaging counterparty, so one inbox row shows a contact name in place of
// an address while the others show raw addresses for contrast.
const DEMO_CONTACTS = [
    {
        name: 'Erin Calloway',
        entries: [
            { chain: 'bitcoin', address: 'demo1erincallowaybtc0000000000000000001', label: 'Main' },
            { chain: 'litecoin', address: 'demoLerincallowayltc0000000000000000001', label: 'LTC' },
            { chain: 'dogecoin', address: 'demoDerincallowaydoge000000000000000001', label: 'DOGE tips' },
        ],
    },
    {
        name: 'Marcus Webb',
        entries: [
            { chain: 'bitcoin', address: 'demo1marcuswebbbtc00000000000000000002', label: 'Cold storage' },
            { chain: 'litecoin', address: 'demoLmarcuswebbltc00000000000000000002', label: '' },
        ],
    },
    {
        name: 'Priya Nair',
        entries: [
            { chain: 'bitcoin', address: 'demo1priyanairbtc000000000000000000003', label: '' },
        ],
    },
    {
        name: 'Diego Santos',
        entries: [
            { chain: 'litecoin', address: 'demoLdiegosantosltc0000000000000000004', label: 'Savings' },
            { chain: 'dogecoin', address: 'demoDdiegosantosdoge000000000000000004', label: '' },
        ],
    },
    {
        name: 'Yuki Tanaka',
        entries: [
            { chain: 'bitcoin', address: 'demo1yukitanakabtc00000000000000000005', label: 'Trading' },
            { chain: 'dogecoin', address: 'demoDyukitanakadoge0000000000000000005', label: 'Memes' },
        ],
    },
];

// Non-contact demo counterparties for the inbox, kept distinct from the seeded
// contacts so those rows render as truncated addresses, not names.
const DEMO_MESSAGE_ADDRESSES = {
    alice: 'demo1alicexchaincounterpartyaddr00000000001',
    bob: 'demo1bobxchaincounterpartyaddr0000000000002',
    carol: 'demo1carolxchaincounterpartyaddr00000000003',
    dave: 'demo1davexchaincounterpartyaddr0000000000004',
    // Erin Calloway's Bitcoin address: this conversation resolves to her name.
    contact: DEMO_CONTACTS[0].entries[0].address,
};

/**
 * Synthesize the message list the §41.7.2 inbox renders for a demo wallet:
 * five conversations against the owner's address, one per encryption mode plus
 * one resolved to a contact name, so the list exercises every preview path.
 *
 *   1. Alice   - plain text (unencrypted), newest
 *   2. Erin    - ECIES, but the counterparty is a saved contact, so the row
 *                shows the contact name instead of the address
 *   3. Bob     - ECIES (decrypts to text)
 *   4. Carol   - ECDH shared session key (decrypts to text, like ECIES)
 *   5. Dave    - AES pre-shared key (stays encrypted -> 🔒 placeholder)
 *
 * Each row matches `getMessagingInbox`'s message shape (from / to /
 * timestamp / method / text / txid), so the inbox's conversation grouping
 * and thread view accept them unchanged.
 *
 * @param {string} ownerAddress  the address whose inbox is being read
 * @param {{ now?: number }} [opts]
 * @returns {Array<{ txid: string, from: string, to: string, timestamp: number, method: number, text: string | null }>}
 */
export function synthesizeDemoMessages(ownerAddress, opts = {}) {
    if (typeof ownerAddress !== 'string' || !ownerAddress) return [];
    const now = typeof opts.now === 'number' ? opts.now : Date.now();
    const sec = (deltaSec) => Math.floor(now / 1000) - deltaSec;

    const { alice, bob, carol, dave, contact } = DEMO_MESSAGE_ADDRESSES;

    let n = 0;
    const mk = (from, to, deltaSec, method, text) => ({
        txid: `demo-msg-${++n}`,
        from,
        to,
        timestamp: sec(deltaSec),
        method,
        text,
        // Demo threads live on Bitcoin so the inbox network filter has
        // something to act on (Bitcoin shows them; Litecoin/Dogecoin hide them).
        chainId: 'bitcoin-mainnet',
    });

    return [
        // 1. Alice - plain text (method 0, unencrypted), the newest activity.
        mk(alice, ownerAddress, 30, 0, 'Sent you a plain unencrypted note - no key needed to read this one.'),
        mk(ownerAddress, alice, 20, 0, 'Got it, thanks!'),

        // 2. Erin - ECIES, and a saved contact, so the row shows the name.
        mk(contact, ownerAddress, 360, 1, 'Moved the savings stash to the new address. All set.'),
        mk(ownerAddress, contact, 300, 1, 'Perfect, confirmed on my end.'),

        // 3. Bob - ECIES (decrypts to text).
        mk(bob, ownerAddress, 7_200, 1, 'gm, are you joining the XChain call later?'),
        mk(ownerAddress, bob, 7_000, 1, 'gm! yeah, I will be there.'),

        // 4. Carol - ECDH shared session key; the wallet derives the shared
        //    secret from both addresses' keys, so it decrypts like ECIES.
        mk(carol, ownerAddress, 86_400, 2, 'Shared-key (ECDH) thread: we can both read this one.'),
        mk(ownerAddress, carol, 86_100, 2, 'Confirmed, reading you loud and clear.'),

        // 5. Dave - AES pre-shared key; no key to enter, so it stays locked.
        mk(dave, ownerAddress, 259_200, 3, null),
    ];
}

/**
 * Demo contacts to seed into a fresh demo wallet's address book. Returns
 * `saveContact`-input shapes (name + entries[{ chain, address, label }]), one
 * per contact, spanning one to three chains each. The caller persists them via
 * `messaging.saveContact`, so they behave as real, editable contacts across
 * the Contacts screen, Send picker, history labels, and message inbox.
 *
 * @returns {Array<{ name: string, entries: Array<{ chain: string, address: string, label: string }> }>}
 */
export function synthesizeDemoContacts() {
    // Deep-copy so callers can't mutate the module-level fixtures.
    return DEMO_CONTACTS.map((c) => ({
        name: c.name,
        entries: c.entries.map((e) => ({ ...e })),
    }));
}

/**
 * Fabricated dispensers the demo wallet "owns", keyed by chain. Shapes
 * mirror the explorer's dispenser rows (flattened DISPENSER fields on the
 * action), so DispensersList / DispenserDetail render them unchanged:
 * a mix of coin-paid and token-paid, open / closed / canceled, with and
 * without a memo and a dedicated dispenser sub-address.
 */
const DEMO_DISPENSERS = /** @type {Record<string, any[]>} */ ({
    'bitcoin-mainnet': [
        {
            // In the 1-hour close window: close requested (status
            // 'cancelling'), escrow not yet released.
            action_index: '4201230', tx_hash: 'demo-disp-btc-4', block_index: 962011,
            status: 'cancelling', give_tick: 'BANANE', give_amount: '20',
            get_coin: 'BTC', get_tick: '', get_amount: '0.0004',
            escrow_remaining: '160', dispense_count: 42,
            memo: 'Winding down: close requested, escrow releases when the window ends.',
        },
        {
            action_index: '4200981', tx_hash: 'demo-disp-btc-1', block_index: 961842,
            status: 'open', give_tick: 'RAREPEPE', give_amount: '1', imageUrl: DEMO_TOKEN_ICONS.RAREPEPE,
            get_coin: 'BTC', get_tick: '', get_amount: '0.005',
            address: 'bc1qdemodispenserrarepepe000000000000000001',
            escrow_remaining: '7', dispense_count: 3,
            memo: 'Rare Pepe vault: one per fill.',
        },
        {
            action_index: '4200714', tx_hash: 'demo-disp-btc-2', block_index: 960377,
            status: 'open', give_tick: 'PEPECASH', give_amount: '500', imageUrl: DEMO_TOKEN_ICONS.PEPECASH,
            get_coin: '', get_tick: 'XCP', get_amount: '5',
            memo: '',
            escrow_remaining: '5500', dispense_count: 1,
        },
        {
            action_index: '4198220', tx_hash: 'demo-disp-btc-3', block_index: 955104,
            status: 'closed', give_tick: 'EXAMPLE', give_amount: '10', imageUrl: DEMO_TOKEN_ICONS.EXAMPLE,
            get_coin: 'BTC', get_tick: '', get_amount: '0.0002',
            memo: 'Launch promo (sold out).',
            escrow_remaining: '0', dispense_count: 120,
        },
    ],
    'dogecoin-mainnet': [
        {
            action_index: '7301556', tx_hash: 'demo-disp-doge-1', block_index: 6334120,
            status: 'open', give_tick: 'DOGI', give_amount: '250',
            get_coin: 'DOGE', get_tick: '', get_amount: '100',
            address: 'D7demoDispenserDogi00000000000000001',
            escrow_remaining: '4750', dispense_count: 2,
        },
        {
            action_index: '7298431', tx_hash: 'demo-disp-doge-2', block_index: 6329988,
            status: 'canceled', give_tick: 'WOW', give_amount: '10',
            get_coin: '', get_tick: 'DOGI', get_amount: '50',
            memo: 'Mispriced, reopened as #7301556.',
            escrow_remaining: '0', dispense_count: 0,
        },
    ],
    'litecoin-mainnet': [
        {
            action_index: '2107744', tx_hash: 'demo-disp-ltc-1', block_index: 3159402,
            status: 'open', give_tick: 'MWEB', give_amount: '2.5',
            get_coin: 'LTC', get_tick: '', get_amount: '0.5',
            escrow_remaining: '47.5', dispense_count: 19,
        },
    ],
});

/**
 * Fabricated fill events per dispenser action_index, for the detail page's
 * "Recent dispenses" list. Buyer addresses are vanity fakes.
 */
const DEMO_DISPENSES = /** @type {Record<string, any[]>} */ ({
    4200981: [
        { action_index: '4201002', give_amount: '1', give_tick: 'RAREPEPE', get_amount: '0.005', get_coin: 'BTC', destination: 'bc1qdemobuyeralpha0000000000000000000000001', status: 'valid', ageSec: 7_200 },
        { action_index: '4200997', give_amount: '1', give_tick: 'RAREPEPE', get_amount: '0.005', get_coin: 'BTC', destination: 'bc1qdemobuyerbravo0000000000000000000000002', status: 'valid', ageSec: 86_400 },
        { action_index: '4200990', give_amount: '1', give_tick: 'RAREPEPE', get_amount: '0.005', get_coin: 'BTC', destination: 'bc1qdemobuyercharlie000000000000000000000003', status: 'valid', ageSec: 5 * 86_400 },
    ],
    4200714: [
        { action_index: '4200850', give_amount: '500', give_tick: 'PEPECASH', get_amount: '5', get_tick: 'XCP', destination: 'bc1qdemobuyerdelta0000000000000000000000004', status: 'valid', ageSec: 32 * 86_400 },
    ],
    7301556: [
        { action_index: '7301610', give_amount: '250', give_tick: 'DOGI', get_amount: '100', get_coin: 'DOGE', destination: 'D7demoBuyerEcho000000000000000000005', status: 'valid', ageSec: 90 },
        { action_index: '7301587', give_amount: '250', give_tick: 'DOGI', get_amount: '100', get_coin: 'DOGE', destination: 'D7demoBuyerFoxtrot0000000000000000006', status: 'valid', ageSec: 3_600 },
    ],
});

/**
 * Dispensers the demo wallet opened on `chainId`, sourced from its first
 * address so DispenserDetail's ownership check marks them "(you)".
 * Regtest chain ids reuse their mainnet fixture so a regtest demo wallet
 * is populated too.
 *
 * @param {string} chainId
 * @param {string} sourceAddress   the demo wallet's address on that chain
 * @returns {any[]}
 */
export function synthesizeDemoDispensers(chainId, sourceAddress) {
    if (typeof sourceAddress !== 'string' || !sourceAddress) return [];
    const rows = DEMO_DISPENSERS[chainId]
        || DEMO_DISPENSERS[String(chainId).replace(/-(regtest|testnet)$/, '-mainnet')]
        || [];
    return rows.map((r) => ({ ...r, source: sourceAddress }));
}

/**
 * Fill events for one demo dispenser (empty array when the fixture has
 * none, e.g. the canceled one).
 *
 * @param {string | number} actionIndex
 * @param {object} [opts]
 * @param {number} [opts.now]   clock injection for tests and for the
 *                              store-listing capture, which freezes every
 *                              demo clock so two captures of an unchanged
 *                              tree produce byte-identical images
 *                              (flows/demoCapture.js)
 * @returns {any[]}
 */
export function synthesizeDemoDispenses(actionIndex, opts = {}) {
    const rows = DEMO_DISPENSES[String(actionIndex)] || [];
    const nowMs = typeof opts.now === 'number' ? opts.now : Date.now();
    const now = Math.floor(nowMs / 1000);
    return rows.map(({ ageSec, ...r }) => ({ ...r, timestamp: now - (ageSec || 0) }));
}
