// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { decimalFromBaseUnits } from '../shared/utils/amountFormat.js';

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

// Inline tiles keep demo holdings available under the app's `img-src 'self'`
// policy and avoid third-party requests from an otherwise synthetic wallet.
export const DEMO_TOKEN_ICONS = {
    EXAMPLE: nftImg('EX', '#1E90C7', '#7B2C8F'),
    PEPECREATURE: nftImg('PEPE', '#15803D', '#713F12'),
    RAREPEPE: nftImg('RARE', '#166534', '#854D0E'),
    PEPECASH: nftImg('CASH', '#16A34A', '#A16207'),
    XCP: nftImg('XCP', '#1E90C7', '#7B2C8F'),
    DOGINAL: nftImg('DOGE', '#EAB308', '#92400E'),
    BEANCOIN: nftImg('BEAN', '#B45309', '#78350F'),
    STUDIOPASS: nftImg('PASS', '#0E7490', '#1E3A8A'),
    HARBORFEST: nftImg('HARBR', '#BE185D', '#6D28D9'),
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
            // The platform token, so the demo's mainnet wallet holds XCHAIN like
            // the regtest one does.
            { tick: 'XCHAIN', displayName: 'XChain', divisibility: 8, quantity: '200000000000', fiatRate: 1.25 }, // 2,000 XCHAIN
            // Divisible mainnet tokens
            { tick: 'XCP', displayName: 'Counterparty', divisibility: 8, quantity: '500000000', fiatRate: 35 }, // 5 XCP
            { tick: 'PEPECASH', displayName: 'PepeCash', divisibility: 8, quantity: '10000000000', fiatRate: 0.0012, imageUrl: DEMO_TOKEN_ICONS.PEPECASH }, // 100 PEPECASH
            { tick: 'BANANE', displayName: 'Banane', divisibility: 8, quantity: '20000000000', fiatRate: 0.04 }, // 200 BANANE
            // Tokens this demo wallet issued (listed in My Tokens by
            // synthesizeDemoOwnedTokens), with the supply it still holds.
            { tick: 'BEANCOIN', displayName: 'Bean Coin', divisibility: 8, quantity: '2500000000000', fiatRate: 0.08, imageUrl: DEMO_TOKEN_ICONS.BEANCOIN }, // 25,000 BEANCOIN
            { tick: 'STUDIOPASS', displayName: 'Studio North Pass', divisibility: 0, quantity: '12', fiatRate: 120, imageUrl: DEMO_TOKEN_ICONS.STUDIOPASS },
            { tick: 'HARBORFEST', displayName: 'Harbor Fest 2027 Ticket', divisibility: 0, quantity: '8', fiatRate: 45, imageUrl: DEMO_TOKEN_ICONS.HARBORFEST },
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
        native: { tick: 'DOGE', divisibility: 8, quantity: '1000000000000', fiatRate: 0.08 }, // 10000 rDOGE @ $0.08
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
 * @returns {Record<string, Array<{ address: string, label: string, addressType: string, derivationPath: string | null, balances: BalanceFixture | null, error: null, errorCode: null, retryAfterSeconds: null }>>}
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
                ? {
                    native: fixture.native ? { ...fixture.native } : null,
                    tokens: fixture.tokens.map((token) => ({ ...token })),
                }
                : { native: fixture?.native ? { ...fixture.native, quantity: '0' } : null, tokens: [] },
            error: null,
            // The typed failure fields beside `error` (see `AddressBalancesEntry`
            // in flows/balances.js): a demo read never fails, so both are null,
            // but a reader keyed on the typed shape must find them present.
            errorCode: null,
            retryAfterSeconds: null,
        }));
    }
    return out;
}

// Fixed 24-hour moves for the demo wallet's native coins, one per
// coin family (the three networks of a family share a figure, the way
// they share a fixture). Every coin is up: a demo never advertises a
// loss, and the synthesized charts rise to match.
//
// They are fixed rather than read from the live price oracle: every
// other number on a demo screen is synthetic, a demo wallet fetches
// nothing, and two store-listing captures of one tree must match, which
// a fetch racing the screenshot (moving the card below by 24px) breaks.
const DEMO_NATIVE_CHANGE_24H_PCT = /** @type {Record<string, number>} */ ({
    bitcoin: 1.24,
    litecoin: 0.72,
    dogecoin: 3.15,
});

// Tokens the demo wallet has issued and still owns, for My Tokens. Bitcoin
// only (the demo's token chain). Supplies are in whole units.
const DEMO_OWNED_TOKENS_BY_CHAIN = {
    'bitcoin-mainnet': [
        {
            tick: 'BEANCOIN',
            description: 'Loyalty points for the Sunrise Roasters coffee network. Earn on every cup, spend at any cafe.',
            divisibility: 8,
            totalSupply: '1250000',
            maxSupply: '10000000',
            locked: false,
            holders: 412,
            fiatRate: 0.08,
            displayName: 'Bean Coin',
            quantity: '2500000000000',
            imageUrl: DEMO_TOKEN_ICONS.BEANCOIN,
        },
        {
            tick: 'STUDIOPASS',
            description: 'Lifetime member passes for Studio North, the shared creative workspace.',
            divisibility: 0,
            totalSupply: '500',
            maxSupply: '500',
            locked: true,
            holders: 187,
            fiatRate: 120,
            displayName: 'Studio North Pass',
            quantity: '12',
            imageUrl: DEMO_TOKEN_ICONS.STUDIOPASS,
        },
        {
            tick: 'HARBORFEST',
            description: 'Weekend tickets for Harbor Fest 2027, the waterfront music and food festival.',
            divisibility: 0,
            totalSupply: '2000',
            maxSupply: '2000',
            // Fully issued and supply-locked, so the indivisible ticket also
            // classifies as a collectible on the NFTs tab.
            locked: true,
            holders: 1206,
            fiatRate: 45,
            displayName: 'Harbor Fest 2027 Ticket',
            quantity: '8',
            imageUrl: DEMO_TOKEN_ICONS.HARBORFEST,
        },
    ],
};

/**
 * The tokens a demo wallet issued and owns, shaped like the rows
 * `messaging.getOwnedTokens` returns for an address (My Tokens adds the chain
 * and owner address itself).
 *
 * @param {string} chainId
 * @returns {Array<{ tick: string, description: string, divisibility: number, totalSupply: string, maxSupply: string, locked: boolean, holders: number, fiatRate: number, youOwn: boolean }>}
 */
export function synthesizeDemoOwnedTokens(chainId) {
    return (DEMO_OWNED_TOKENS_BY_CHAIN[chainId] || []).map((t) => ({ ...t, youOwn: true, demo: true }));
}

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
    const nativeAmount = decimalFromBaseUnits(
        fixture.native.quantity,
        fixture.native.divisibility,
    );
    const outgoingAmount = decimalFromBaseUnits('5000000', fixture.native.divisibility);
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
        amount: nativeAmount,
        quantity: nativeAmount,
        memo: 'Welcome to the demo wallet',
        params: {
            source: 'demo-faucet-1xchainpubdemoxchain',
            destination: address,
            amount: nativeAmount,
            memo: 'Welcome to the demo wallet',
        },
    });

    // Token receive: a friend tipped us some of the first divisible
    // token on this chain. Exercises the "non-native receive" row in
    // Activity so the icon swaps to the token's image / tinted letter
    // instead of the chain icon.
    if (divisibleToken) {
        // History rows carry whole-token units, like the native receive above.
        const tokenAmount = decimalFromBaseUnits('100000000', divisibleToken.divisibility);
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
            amount: outgoingAmount, // 0.05 of the native coin
            quantity: outgoingAmount,
            memo: 'thanks for lunch',
            params: {
                source: address,
                destination: 'demo-friend-1xchainpubrecipient',
                amount: outgoingAmount,
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

// The one validator stake the demo wallet holds. The DeFi tab rows on every
// network and the Staking screen read these fields, so the amount and the
// validator name never differ between the two.
const DEMO_VALIDATOR_STAKE = {
    amount: '50000',
    validator: 'demo-validator-7',
    apy: '4.2%',
};

const DEMO_VALIDATOR_STAKE_PRIMARY = `${Number(DEMO_VALIDATOR_STAKE.amount).toLocaleString('en-US')}.00000000 XCHAIN`;
const DEMO_VALIDATOR_STAKE_SECONDARY = `Delegated to ${DEMO_VALIDATOR_STAKE.validator} · ${DEMO_VALIDATOR_STAKE.apy} APY`;

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
            title: 'XCHAIN stake', primary: DEMO_VALIDATOR_STAKE_PRIMARY,
            secondary: DEMO_VALIDATOR_STAKE_SECONDARY, badge: 'Active',
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
            title: 'XCHAIN stake', primary: DEMO_VALIDATOR_STAKE_PRIMARY,
            secondary: DEMO_VALIDATOR_STAKE_SECONDARY, badge: 'Active',
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
// aggregate; the demo path drops this in instead. Only Bitcoin is
// populated (staking is BTC-only), keyed under bitcoin-mainnet because the
// demo wallet lands on mainnet; demoStakingFixture() resolves the regtest
// and testnet ids to the same entry so a network switch
// still shows the positions. The narrative matches the DeFi-tab
// "XCHAIN stake delegated to demo-validator-7" position above.
// Contract-flavored positions live in DEMO_CONTRACT_STAKES_BY_CHAIN
// below; keeping them out of this lane avoids duplicate rows in the
// unified staking list.
/**
 * The staking fixture entry for `chainId`. Regtest and testnet ids reuse
 * the mainnet entry, as demoDispenserRows() does, so the demo shows the same
 * positions on whichever network it is viewing.
 *
 * @template T
 * @param {Record<string, T>} table
 * @param {string} chainId
 * @returns {T | undefined}
 */
function demoStakingFixture(table, chainId) {
    return table[chainId]
        || table[String(chainId).replace(/-(regtest|testnet)$/, '-mainnet')];
}

const DEMO_STAKING_BY_CHAIN = {
    'bitcoin-mainnet': {
        stakes: [
            // The validator position: XCHAIN staked toward the cross-chain
            // operator capability. This is stakes[0], so it drives the
            // "Staked" headline and the Unstake/Delegate/Operator actions.
            {
                stake_id: 'demo-stake-validator',
                asset: 'XCHAIN',
                amount: DEMO_VALIDATOR_STAKE.amount,
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
        // Accrual ledger only: without separate demo claim rows,
        // unclaimedRewards() reports all 80.25 as unclaimed. reward_claims,
        // not these legacy display statuses, supply the subtraction.
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
    const fixture = demoStakingFixture(DEMO_STAKING_BY_CHAIN, chainId);
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
// on unstake and a slash destination. Only Bitcoin is populated (staking
// is BTC-only), keyed and resolved like the validator fixture above. The 1,000 EXAMPLE in contract #1024 matches the
// DeFi-tab narrative, so the surfaces tell one story.
const DEMO_CONTRACT_STAKES_BY_CHAIN = {
    'bitcoin-mainnet': {
        stakes: [
            {
                action_index: 'demo-cstake-1024',
                target_contract_index: '1024',
                tick: 'EXAMPLE',
                amount: '1000',
                block_index: 12_405,
                signing_pubkey: '02a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f901',
            },
            {
                action_index: 'demo-cstake-2048',
                target_contract_index: '2048',
                tick: 'PEPECASH',
                amount: '25000',
                block_index: 12_390,
                signing_pubkey: '03f0e1d2c3b4a5968778695a4b3c2d1e0fa1b2c3d4e5f60718293a4b5c6d7e8f9',
            },
            // A later top-up keeps this position's staked-balance chart net up
            // across the slash below.
            {
                action_index: 'demo-cstake-2048b',
                target_contract_index: '2048',
                tick: 'PEPECASH',
                amount: '2000',
                block_index: 12_520,
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
                destination_address: 'bc1qdemoslashdest0xchain0treasury0demo0addr',
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
    const fixture = demoStakingFixture(DEMO_CONTRACT_STAKES_BY_CHAIN, chainId);
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
// the Staking form's contract stakeable gate (cooldown_blocks set at DEPLOY)
// rejects the very contracts the demo says you hold positions in. The
// slash destination matches the slash-event fixture so the #2048 story
// stays coherent.
const DEMO_CONTRACT_META_BY_CHAIN = {
    'bitcoin-mainnet': {
        1024: {
            contract_action_index: '1024',
            cooldown_blocks: 144,
            slash_destination: 'bc1qdemoslashdest0xchain0treasury0demo0addr',
        },
        2048: {
            contract_action_index: '2048',
            cooldown_blocks: 240,
            slash_destination: 'bc1qdemoslashdest0xchain0treasury0demo0addr',
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
    const meta = demoStakingFixture(DEMO_CONTRACT_META_BY_CHAIN, chainId)?.[String(contractActionIndex)];
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
 * The token is matched against the caller's visible chain fixtures, or
 * mainnet when no chain list is supplied. Tokens without a matching holding
 * use the visible Bitcoin chain so the demo marketplace remains populated.
 *
 * Each feed entry is already wrapped as `{ chainId, row }`, the shape
 * MarketActivity builds per-chain, so the caller can set state directly.
 *
 * @param {string} token  ticker the user searched for
 * @param {{ now?: number, chainIds?: string[] }} [opts]
 * @returns {{ offers: Array<{chainId: string, row: any}>, sales: Array<{chainId: string, row: any}>, dexOrders: Array<{chainId: string, row: any}>, dexSwaps: Array<{chainId: string, row: any}> }}
 */
export function synthesizeDemoMarketActivity(token, opts = {}) {
    const tick = String(token || '').trim().toUpperCase();
    const empty = { offers: [], sales: [], dexOrders: [], dexSwaps: [] };
    if (!tick) return empty;

    const now = typeof opts.now === 'number' ? opts.now : Date.now();
    const sec = (deltaSec) => Math.floor(now / 1000) - deltaSec;

    const requestedChainIds = Array.isArray(opts.chainIds)
        ? opts.chainIds.filter((chainId) => (
            typeof chainId === 'string' && PER_CHAIN_DEFAULTS[chainId]
        ))
        : Object.keys(PER_CHAIN_DEFAULTS).filter((chainId) => chainId.endsWith('-mainnet'));

    // Locate a visible chain whose fixture lists this token so the rows and
    // badges stay on the network the caller is currently displaying.
    let chainId = null;
    for (const cid of requestedChainIds) {
        const fix = PER_CHAIN_DEFAULTS[cid];
        if ((fix.tokens || []).some((t) => t.tick.toUpperCase() === tick)) {
            chainId = cid;
            break;
        }
    }
    // Featured / platform tokens (e.g. XCHAIN) and anything the demo wallet
    // doesn't hold still get a demo market, homed on Bitcoin, so the
    // Marketplace landing page is never empty in the demo.
    if (!chainId) {
        chainId = requestedChainIds.find((cid) => cid.startsWith('bitcoin-'))
            || requestedChainIds[0];
    }
    if (!chainId) return empty;

    const coinTick = PER_CHAIN_DEFAULTS[chainId].native.tick; // BTC / LTC / DOGE
    const unit = DEMO_COIN_UNIT_PRICE[coinTick] ?? 0.00002;
    // Coin amount that `qty` of the token is priced at, trimmed to a
    // clean 8-dp value so toLocaleString() reads nicely.
    const px = (qty) => Number((unit * qty).toFixed(8));
    const wrap = (row) => ({ chainId, row });
    // Dispense rows use the explorer's own fields (decimal strings, a
    // string status) so the demo drives the same render path real rows do.
    const pxs = (qty) => px(qty).toFixed(8).replace(/\.?0+$/, '');
    const sale = (n, give, ago) => ({
        tx_hash: `demo-${chainId}-dispense-${n}`, status: 'valid',
        give_tick: tick, give_amount: String(give), get_coin: coinTick, get_amount: pxs(give), timestamp: sec(ago),
    });

    // Open dispensers are the demo wallet's own open fixtures selling this
    // token on each visible chain, the same rows DispenserDetail resolves,
    // so every listing opens its detail page. A token with no open demo
    // dispenser lists none.
    const offers = requestedChainIds.flatMap((cid) => demoDispenserRows(cid)
        .filter((r) => String(r.status).toLowerCase() === 'open'
            && String(r.give_tick || '').toUpperCase() === tick
            && Number(r.escrow_remaining) > 0)
        .map((r) => ({ chainId: cid, row: { ...r } })));

    const sales = [sale(1, 1000, 3_600), sale(2, 250, 14_400), sale(3, 2000, 86_400)].map(wrap);

    const dexOrders = [
        // A sell (give the token, get coin) and a buy (give coin, get the token).
        { action_index: 900201, status: 'valid', give_tick: tick, give_coin: coinTick, give_amount: '5000', get_tick: null, get_coin: coinTick, get_amount: String(px(5000)) },
        { action_index: 900202, status: 'valid', give_tick: null, give_coin: coinTick, give_amount: String(px(3000)), get_tick: tick, get_coin: coinTick, get_amount: '3000' },
    ].map(wrap);

    const dexSwaps = [
        { action_index: 900301, tx_hash: `demo-${chainId}-swap-1`, status: 'valid', swap_status: 'complete', give_tick: tick, give_coin: coinTick, give_amount: '1500', get_tick: null, get_coin: coinTick, get_amount: String(px(1500)), timestamp: sec(7_200) },
        { action_index: 900302, tx_hash: `demo-${chainId}-swap-2`, status: 'valid', swap_status: 'complete', give_tick: null, give_coin: coinTick, give_amount: String(px(800)), get_tick: tick, get_coin: coinTick, get_amount: '800', timestamp: sec(18_000) },
        { action_index: 900303, tx_hash: `demo-${chainId}-swap-3`, status: 'valid', swap_status: 'complete', give_tick: tick, give_coin: coinTick, give_amount: '4200', get_tick: null, get_coin: coinTick, get_amount: String(px(4200)), timestamp: sec(90_000) },
    ].map(wrap);

    return { offers, sales, dexOrders, dexSwaps };
}

// Five demo contacts, one to three chains each. Addresses are valid mainnet
// addresses hashed from the contact name (no one holds the keys), since the
// edit form re-validates them on save. Erin's Bitcoin address is also an
// inbox counterparty, so one inbox row shows a contact name.
const DEMO_CONTACTS = [
    {
        name: 'Erin Calloway',
        entries: [
            { chain: 'bitcoin', address: 'bc1q3wkwr0udwwkynvuy53tct3r4jfgek5v2c3pftc', label: 'Main' },
            { chain: 'litecoin', address: 'ltc1qqtte56w7s7gst5evtgc64p0vczch7g574fawyk', label: 'LTC' },
            { chain: 'dogecoin', address: 'DCchvMkFGrjDx28gZsgQro4jexPZ8QDC68', label: 'DOGE tips' },
        ],
    },
    {
        name: 'Marcus Webb',
        entries: [
            { chain: 'bitcoin', address: 'bc1q9dtk64wl74dyllt0mjmsw609a5hry6r7j8l4fu', label: 'Cold storage' },
            { chain: 'litecoin', address: 'ltc1qncndj80v4q7pkmymyqz4zhe8jqtwe5pvx38jel', label: '' },
        ],
    },
    {
        name: 'Priya Nair',
        entries: [
            { chain: 'bitcoin', address: 'bc1q52zecvw8lrg75c3xypsld6w4qyc6s8x3aplpw9', label: '' },
        ],
    },
    {
        name: 'Diego Santos',
        entries: [
            { chain: 'litecoin', address: 'ltc1qp86vwem7c3f4w4u6j4rf5sh5p958lcp2r985a9', label: 'Savings' },
            { chain: 'dogecoin', address: 'DN2LX8cnzuW3M5RRADSxyp43k6CWyKNRph', label: '' },
        ],
    },
    {
        name: 'Yuki Tanaka',
        entries: [
            { chain: 'bitcoin', address: 'bc1q6g6t6t3kd4hlynpc60udg5s3ygw38n58fgajfd', label: 'Trading' },
            { chain: 'dogecoin', address: 'DT9cQMVsSvZoTETsDo9bAn6Zb13ALzCZYs', label: 'Memes' },
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
            // The indexer writes `cancelled`, which the list and detail pages key on.
            status: 'cancelled', give_tick: 'WOW', give_amount: '10',
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

const DEMO_MARKET_DISPENSERS = /** @type {Record<string, any[]>} */ ({
    'bitcoin-mainnet': [
        {
            action_index: '4202001', tx_hash: 'demo-market-disp-btc-1', block_index: 962101,
            status: 'open', give_tick: 'PEPECASH', give_coin: '', give_amount: '500',
            get_tick: 'XCP', get_coin: '', get_amount: '5',
            source: 'bc1qdemomarketselleralpha000000000000000001',
            address: 'bc1qdemomarketdispenseralpha00000000000001',
            escrow_remaining: '12500', dispense_count: 4,
        },
        {
            action_index: '4202002', tx_hash: 'demo-market-disp-btc-2', block_index: 962099,
            status: 'open', give_tick: 'RAREPEPE', give_coin: '', give_amount: '1',
            get_tick: 'PEPECASH', get_coin: '', get_amount: '2500',
            source: 'bc1qdemomarketsellerbravo00000000000000002',
            address: 'bc1qdemomarketdispenserbravo0000000000002',
            escrow_remaining: '18', dispense_count: 2,
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
    return demoDispenserRows(chainId).map((r) => ({ ...r, source: sourceAddress }));
}

/**
 * Marketplace dispensers across all sellers for one selected token. The same
 * bulk fixture contains both directions so Buy and Sell filter one response.
 * An empty token returns the full chain fixture for detail lookup.
 *
 * @param {string} chainId
 * @param {string} [token]
 * @returns {any[]}
 */
export function synthesizeDemoMarketDispensers(chainId, token = '') {
    const rows = DEMO_MARKET_DISPENSERS[chainId]
        || DEMO_MARKET_DISPENSERS[String(chainId).replace(/-(regtest|testnet)$/, '-mainnet')]
        || [];
    const selected = String(token || '').toUpperCase();
    return rows
        .filter((row) => !selected
            || String(row.give_tick || row.give_coin || '').toUpperCase() === selected
            || String(row.get_tick || row.get_coin || '').toUpperCase() === selected)
        .map((row) => ({ ...row }));
}

/**
 * The demo dispenser fixture rows for `chainId`. Regtest and testnet ids
 * reuse their mainnet fixture, so every network the demo wallet can show
 * resolves the same dispensers.
 *
 * @param {string} chainId
 * @returns {any[]}
 */
function demoDispenserRows(chainId) {
    return DEMO_DISPENSERS[chainId]
        || DEMO_DISPENSERS[String(chainId).replace(/-(regtest|testnet)$/, '-mainnet')]
        || [];
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

/**
 * Fabricated ORDER rows per chain, shaped like the explorer's orders feed
 * with the `state` block hydrated, so My orders reads them without a
 * detail fetch. Ages and expiry offsets are seconds relative to the
 * injected clock; an open order expires in the future, a closed one shows
 * its terminal status.
 */
const DEMO_ORDERS = /** @type {Record<string, any[]>} */ ({
    'bitcoin-mainnet': [
        {
            action_index: '4201240', tx_hash: 'demo-order-btc-1', block_index: 960512,
            give_tick: 'RAREPEPE', give_coin: '', give_amount: '2', give_ownership: 0,
            get_tick: '', get_coin: 'BTC', get_amount: '0.012', get_ownership: 0,
            ageSec: 3 * 3_600, expiresInSec: 4 * 86_400, state: 'open', giveRemaining: '2',
        },
        {
            action_index: '4201118', tx_hash: 'demo-order-btc-2', block_index: 960431,
            give_tick: 'PEPECASH', give_coin: '', give_amount: '1000', give_ownership: 0,
            get_tick: 'XCP', get_coin: '', get_amount: '10', get_ownership: 0,
            ageSec: 2 * 86_400, expiresInSec: 12 * 86_400, state: 'open', giveRemaining: '400',
        },
        {
            action_index: '4200655', tx_hash: 'demo-order-btc-3', block_index: 959870,
            give_tick: 'EXAMPLE', give_coin: '', give_amount: '50', give_ownership: 0,
            get_tick: '', get_coin: 'BTC', get_amount: '0.001', get_ownership: 0,
            ageSec: 9 * 86_400, expiresInSec: 21 * 86_400, state: 'filled', giveRemaining: '0',
        },
    ],
    'litecoin-mainnet': [
        {
            action_index: '2107902', tx_hash: 'demo-order-ltc-1', block_index: 3159588,
            give_tick: 'MWEB', give_coin: '', give_amount: '5', give_ownership: 0,
            get_tick: '', get_coin: 'LTC', get_amount: '1.25', get_ownership: 0,
            ageSec: 6 * 3_600, expiresInSec: 7 * 86_400, state: 'open', giveRemaining: '5',
        },
    ],
    'dogecoin-mainnet': [
        {
            action_index: '7301702', tx_hash: 'demo-order-doge-1', block_index: 6334251,
            give_tick: 'DOGI', give_coin: '', give_amount: '1000', give_ownership: 0,
            get_tick: '', get_coin: 'DOGE', get_amount: '400', get_ownership: 0,
            ageSec: 40 * 60, expiresInSec: 3 * 86_400, state: 'open', giveRemaining: '1000',
        },
        {
            action_index: '7299015', tx_hash: 'demo-order-doge-2', block_index: 6330760,
            give_tick: 'WOW', give_coin: '', give_amount: '20', give_ownership: 0,
            get_tick: 'DOGI', get_coin: '', get_amount: '100', get_ownership: 0,
            ageSec: 16 * 86_400, expiresInSec: -2 * 86_400, state: 'expired', giveRemaining: '0',
        },
    ],
});

/**
 * Fabricated SWAP rows per chain, shaped like the explorer's swaps feed
 * with `swap_status` and the hydrated `state` block.
 */
const DEMO_SWAPS = /** @type {Record<string, any[]>} */ ({
    'bitcoin-mainnet': [
        {
            action_index: '4201260', tx_hash: 'demo-swap-btc-1', block_index: 960530,
            give_tick: 'RAREPEPE', give_coin: '', give_amount: '1', give_ownership: 0,
            get_tick: 'PEPECASH', get_coin: '', get_amount: '2500', get_ownership: 0,
            ageSec: 90 * 60, expiresInSec: 2 * 86_400, state: 'open',
        },
        {
            action_index: '4200702', tx_hash: 'demo-swap-btc-2', block_index: 959911,
            give_tick: 'EXAMPLE', give_coin: '', give_amount: '25', give_ownership: 0,
            get_tick: 'XCP', get_coin: '', get_amount: '3', get_ownership: 0,
            ageSec: 6 * 86_400, expiresInSec: 8 * 86_400, state: 'settled',
        },
    ],
    'litecoin-mainnet': [
        {
            action_index: '2107955', tx_hash: 'demo-swap-ltc-1', block_index: 3159640,
            give_tick: 'MWEB', give_coin: '', give_amount: '1', give_ownership: 0,
            get_tick: 'LITECRED', get_coin: '', get_amount: '200', get_ownership: 0,
            ageSec: 5 * 3_600, expiresInSec: 5 * 86_400, state: 'open',
        },
    ],
    'dogecoin-mainnet': [
        {
            action_index: '7301730', tx_hash: 'demo-swap-doge-1', block_index: 6334280,
            give_tick: 'DOGI', give_coin: '', give_amount: '500', give_ownership: 0,
            get_tick: 'WOW', get_coin: '', get_amount: '40', get_ownership: 0,
            ageSec: 25 * 60, expiresInSec: 86_400, state: 'open',
        },
    ],
});

/**
 * The fixture rows in `table` for `chainId`. Regtest and testnet ids reuse
 * their mainnet fixture, so every network the demo wallet can show
 * resolves the same rows.
 *
 * @param {Record<string, any[]>} table
 * @param {string} chainId
 * @returns {any[]}
 */
function demoMarketRows(table, chainId) {
    return table[chainId]
        || table[String(chainId).replace(/-(regtest|testnet)$/, '-mainnet')]
        || [];
}

/**
 * Orders the demo wallet placed on `chainId`, sourced from its first
 * address so My orders lists them as the wallet's own. Each row carries
 * the hydrated `state` block (status, give_remaining, expiration) the
 * list feed returns, so the view needs no detail read.
 *
 * @param {string} chainId
 * @param {string} sourceAddress   the demo wallet's address on that chain
 * @param {object} [opts]
 * @param {number} [opts.now]   clock injection for tests and for the
 *                              store-listing capture (flows/demoCapture.js)
 * @returns {any[]}
 */
export function synthesizeDemoOrders(chainId, sourceAddress, opts = {}) {
    if (typeof sourceAddress !== 'string' || !sourceAddress) return [];
    const nowMs = typeof opts.now === 'number' ? opts.now : Date.now();
    const now = Math.floor(nowMs / 1000);
    return demoMarketRows(DEMO_ORDERS, chainId).map(({
        ageSec, expiresInSec, state, giveRemaining, ...row
    }) => ({
        ...row,
        source: sourceAddress,
        status: 'valid',
        timestamp: now - ageSec,
        expiration: now + expiresInSec,
        state: { status: state, give_remaining: giveRemaining, expiration: now + expiresInSec },
    }));
}

/**
 * Swaps the demo wallet offered on `chainId`, sourced from its first
 * address so My swaps lists them as the wallet's own. Each row carries
 * `swap_status` and the hydrated `state` block the list feed returns.
 *
 * @param {string} chainId
 * @param {string} sourceAddress   the demo wallet's address on that chain
 * @param {object} [opts]
 * @param {number} [opts.now]   clock injection for tests and for the
 *                              store-listing capture (flows/demoCapture.js)
 * @returns {any[]}
 */
export function synthesizeDemoSwaps(chainId, sourceAddress, opts = {}) {
    if (typeof sourceAddress !== 'string' || !sourceAddress) return [];
    const nowMs = typeof opts.now === 'number' ? opts.now : Date.now();
    const now = Math.floor(nowMs / 1000);
    return demoMarketRows(DEMO_SWAPS, chainId).map(({
        ageSec, expiresInSec, state, ...row
    }) => ({
        ...row,
        source: sourceAddress,
        status: 'valid',
        swap_status: state,
        timestamp: now - ageSec,
        expiration: now + expiresInSec,
        state: { status: state, expiration: now + expiresInSec },
    }));
}

// Cosigner keys for the demo signing sessions: valid-shaped compressed
// public keys hashed from each name, so no one holds the private keys.
// "You" stands for the demo wallet's own cosigner key.
const DEMO_COSIGNERS = {
    you: { name: 'You (this wallet)', pubkey: '028aaf1887c041271b46b9f547a84a1e6dc6db2a285ae3924455710016c6231938' },
    erin: { name: DEMO_CONTACTS[0].name, pubkey: '0321b018bd0e958f8a235ef569c68a9cc2e685d0f6355a009d8fa7781c1927ea31' },
    marcus: { name: DEMO_CONTACTS[1].name, pubkey: '0390fced50ca3a3e5b75e987ed484483a50dc9106ed6a174a2a256ae92e42dc920' },
    priya: { name: DEMO_CONTACTS[2].name, pubkey: '02fc217f0996828c2006440133dc9e4b5f90821a25c6dff0142f17632f7cd8c95b' },
    diego: { name: DEMO_CONTACTS[3].name, pubkey: '0242515cdf95588a5122e3665b6b5cb465c0a33d23cdab00c09600e28c16c217fd' },
    yuki: { name: DEMO_CONTACTS[4].name, pubkey: '02d170dbdcf6c6ec02c1f12bfc909e390c28c95099a2cf26b1fc9de02644482a8a' },
};

// Fixed hex blocks the sessions are built from (sighashes, txids, DER
// signatures). They only have to be well formed: a demo session is never
// finalized, exported or broadcast.
const DEMO_SESSION_HEX = {
    msg1: 'ecc15c3b49f62f640dc5f4d5ff8c1f2b623997abd7475ae7d83b9344b809ad9d',
    msg2: '71ed4e6e8d9af2d284cbd140ab4acea6282251d4a1d75fa7045c75a4f1dabef3',
    msg3: '3e7d5557ce3dd4d23bbccccf928c77fe118ad027093dca40906e1bf00c436e73',
    msg4: 'b4c1b264b96e5b1f73612e70c4e4b2904cb48977e0ce9bbc108a37cb72bbbc3c',
    tx3: '749999b4ed44b9294c7a9a7b2fcd77abf916c1812a4d05f53945abe67908bf97',
    tx4: '34961311320abfdf4fc8263a149e1c2d1c6bce8aa2021e6d44870b05c7e5e056',
    sig1: '304402208c4bba9e7c828a1bbd6fb23f09d445de192ac2e9fc0e580f8b236f5d6c7eb5c60220b2c21dbb68957cc0d5ed859319dd922e4b68ac4485519463f6ae8ce6e134c17c',
    sig2: '30440220b604257892f6c012bf913cef1edd2d3a489850457173b549795f4551eb6b45e902209bc6e4fa5d522384082d1e5c1605de5475e40b01fd77c07b6669219edf7e82d5',
    sig3: '30440220b266db9649984b4dd680ab7dd39fb64f2ce4ec3f154bfb588bc44eacb84e39a00220d5faee0062014a6c28aa4d626c62f78487c02d2a58cd35b4a6945fa481cf8460',
    sig4: '30440220e64cc85c8ee32b61c4c3076eae1fdf058dfb786ca25fb66e4f5ceb2e404921cd022033f7772814ee8933a86eb3d9c498a57d8d04fc4417077a5eb148b2d12bbde766',
    sig5: '30440220763cf3a267dda123334838bc50d8c5e80f70e8c550c009235b71bcd55cacfb05022052e631e20c1632dca5439643fa36aa1712574eb71471d231e4e5bcc569bc93eb',
};

/**
 * Sample multisig signing sessions for a demo wallet's Multisig Signing
 * Sessions page, one per state the list groups by:
 *
 *   1. Waiting on your signature: a 3-of-3 spend both other cosigners
 *      have signed; this wallet's key is the only one left.
 *   2. Waiting on others: a 2-of-3 spend this wallet signed (1 of 2).
 *   3. Ready to broadcast: a 2-of-3 Classic spend, signed and finalized.
 *   4. Broadcast: a 2-of-2 Taproot spend on Bitcoin testnet, sent.
 *
 * Records carry the vault's MultisigSigningSession shape plus
 * `cosignerNames` (cosigner key to display name), so the session page names
 * each signer, and `localPubkeys` (this wallet's key). They are served by demoMessaging and never written to a vault.
 *
 * @param {string} walletId
 * @param {{ now?: number }} [opts]
 * @returns {Array<Record<string, any>>}
 */
export function synthesizeDemoMultisigSessions(walletId, opts = {}) {
    const now = typeof opts.now === 'number' ? opts.now : Date.now();
    const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
    const { you, erin, marcus, priya, diego, yuki } = DEMO_COSIGNERS;
    const H = DEMO_SESSION_HEX;
    const sig = (who, hex, minutesAgo) => ({ pubkey: who.pubkey, sig: hex, contributedAt: at(minutesAgo) });
    const names = (...who) => Object.fromEntries(who.map((c) => [c.pubkey, c.name]));
    const base = (id, chainId, scheme, threshold, cosigners, msgHash, actionSummary) => ({
        schemaVersion: 1,
        id,
        walletId: String(walletId || ''),
        chainId,
        scheme,
        threshold,
        cosignerPubkeys: cosigners.map((c) => c.pubkey),
        cosignerNames: names(...cosigners),
        // This wallet's own key, so the list can tell a session waiting on
        // your signature (Ready) from one waiting on others (Waiting).
        localPubkeys: [you.pubkey],
        msgHash,
        psbtHex: '',
        actionSummary,
        nonces: [],
        aggNonce: null,
        partialSigs: [],
        aggregatedSchnorrSig: null,
        signatures: [],
        status: 'collecting-sigs',
        finalizedTxHex: null,
        txid: null,
    });
    return [
        {
            ...base('demo-multisig-your-signature', 'bitcoin-mainnet', 'p2wsh-multisig', 3,
                [you, erin, marcus], H.msg1, `Send 1.2 BTC to ${priya.name}`),
            signatures: [sig(erin, H.sig1, 95), sig(marcus, H.sig2, 40)],
            createdAt: at(120),
            updatedAt: at(40),
        },
        {
            ...base('demo-multisig-waiting-others', 'bitcoin-mainnet', 'p2wsh-multisig', 2,
                [you, priya, yuki], H.msg2, `Send 0.35 BTC to ${erin.name}`),
            signatures: [sig(you, H.sig3, 300)],
            createdAt: at(310),
            updatedAt: at(300),
        },
        {
            ...base('demo-multisig-ready', 'bitcoin-mainnet', 'p2sh-multisig', 2,
                [you, marcus, erin], H.msg3, `Send 0.08 BTC to ${diego.name}`),
            signatures: [sig(you, H.sig4, 1_500), sig(marcus, H.sig5, 1_380)],
            status: 'finalized',
            finalizedTxHex: `0200000001${H.tx4}0000000000ffffffff0100127a000000000017a914${H.msg3.slice(0, 40)}8700000000`,
            txid: H.tx3,
            createdAt: at(1_560),
            updatedAt: at(1_370),
        },
        {
            ...base('demo-multisig-sent', 'bitcoin-testnet', 'taproot-musig2', 2,
                [you, yuki], H.msg4, `Send 0.015 TBTC to ${yuki.name}`),
            nonces: [
                { pubkey: you.pubkey, publicNonce: `${H.msg1}${H.msg2}02a1`, contributedAt: at(4_400) },
                { pubkey: yuki.pubkey, publicNonce: `${H.msg2}${H.msg3}03b2`, contributedAt: at(4_380) },
            ],
            aggNonce: `${H.msg3}${H.msg4}02c3`,
            partialSigs: [
                sig(you, H.msg1, 4_360),
                sig(yuki, H.msg2, 4_340),
            ],
            aggregatedSchnorrSig: `${H.msg3}${H.msg4}`,
            status: 'broadcast',
            finalizedTxHex: `02000000000101${H.tx3}0000000000ffffffff01983a000000000000225120${H.msg4}0140${H.msg3}${H.msg4}00000000`,
            txid: H.tx4,
            createdAt: at(4_420),
            updatedAt: at(4_320),
        },
    ];
}

/**
 * The messaging module a demo wallet's views read through. Each read a view
 * makes for a wallet's addresses answers from the fixtures above, in the
 * response envelope the explorer route returns, so a view calls the same
 * methods for a demo wallet and a real one and never asks which it has. A
 * demo wallet's addresses never reach an explorer (issue #82). Every other
 * method passes through to `messaging`.
 *
 * @param {Record<string, any>} messaging
 * @returns {Record<string, any>}
 */
export function demoMessaging(messaging) {
    const rows = (data) => Promise.resolve({ data });
    const none = () => rows([]);
    // The session records name the wallet the list was read for.
    let sessionsWalletId = '';
    return {
        ...messaging,
        getWalletBalances: async (walletId, ...rest) => synthesizeDemoBalances(
            typeof messaging?.getAddressesByChain === 'function'
                ? await messaging.getAddressesByChain(walletId, ...rest)
                : {},
        ),
        getNativePricesRequest: async ({ chainIds } = {}) => ({
            prices: synthesizeDemoNativePrices(Array.isArray(chainIds) ? chainIds : []),
        }),
        getAddressHistory: ({ chainId, address } = {}) => rows(synthesizeDemoHistory(chainId, address)),
        // The value chart's batch reads: the demo line is synthesized, so
        // these answer empty and a demo address never reaches an explorer.
        getWalletHistoryBatch: async ({ addresses } = {}) => ({
            amount_unit: 'base', addresses: Array.isArray(addresses) ? addresses : [], next_cursor: null, actions: [],
        }),
        getNativeHistoryBatch: async () => ({ transactions: [], cursor: null, history_from_height: 0 }),
        getLinksForAddress: () => rows(synthesizeDemoLinks()),
        getAddressMempool: none,
        getPendingTxsForAddress: none,
        getDispensersForSource: ({ chainId, address } = {}) => rows(synthesizeDemoDispensers(chainId, address)),
        getDispensersForToken: ({ chainId, token, tick } = {}) => rows(synthesizeDemoMarketDispensers(chainId, token || tick)),
        getOrdersForAddress: ({ chainId, address } = {}) => rows(synthesizeDemoOrders(chainId, address)),
        getSwapsForAddress: ({ chainId, address } = {}) => rows(synthesizeDemoSwaps(chainId, address)),
        getDispenserLifecycle: none,
        getContractsForSource: none,
        getDepositsForAddress: none,
        getWithdrawalsForAddress: none,
        getContractsBrowseAll: none,
        getStakesForAddress: ({ chainId } = {}) => rows(synthesizeDemoStaking(chainId).stakes),
        getDelegationsForAddress: ({ chainId } = {}) => rows(synthesizeDemoStaking(chainId).delegations),
        getRewardsForAddress: ({ chainId } = {}) => rows(synthesizeDemoStaking(chainId).rewards),
        getRewardClaimsForAddress: none,
        getContractStakesForAddress: ({ chainId } = {}) => rows(synthesizeDemoContractStakes(chainId).stakes),
        getContractUnstakesForAddress: ({ chainId } = {}) => rows(synthesizeDemoContractStakes(chainId).unstakes),
        // Signing sessions are vault reads, answered as the host answers
        // them: a bare array, and one record by id.
        listMultisigSigningSessions: ({ walletId } = {}) => {
            sessionsWalletId = String(walletId || '');
            return Promise.resolve(synthesizeDemoMultisigSessions(sessionsWalletId));
        },
        getMultisigSigningSession: ({ sessionId } = {}) => {
            const found = synthesizeDemoMultisigSessions(sessionsWalletId).find((s) => s.id === sessionId);
            if (found) return Promise.resolve(found);
            return typeof messaging?.getMultisigSigningSession === 'function'
                ? messaging.getMultisigSigningSession({ sessionId })
                : Promise.resolve(null);
        },
    };
}
