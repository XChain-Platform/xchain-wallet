// §25.2 / Cluster J FOLLOWUP 1 — synthesized fixture data for demo
// wallets so Home / History / TokenDetail surfaces feel populated
// without requiring the user to fund the wallet.
//
// `nftImg` returns an inline SVG data URI used as a stand-in for an
// tick's image. Real wallets get imageUrl from the indexer; the demo
// path needs offline-safe placeholders so the NFTs tab (which filters
// by imageUrl presence) actually shows tiles. Pure SVG keeps the
// payload tiny and avoids any network fetch.

function nftImg(label, bgFrom, bgTo, fg = '#FFFFFF') {
    const t = String(label || '').slice(0, 5);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${bgFrom}"/><stop offset="100%" stop-color="${bgTo}"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><text x="100" y="118" font-family="system-ui,sans-serif" font-size="44" font-weight="800" fill="${fg}" text-anchor="middle">${t}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
//
// Demo wallets are real BIP39 wallets — they have real addresses on
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
            // Divisible mainnet tokens
            { tick: 'XCP', displayName: 'Counterparty', divisibility: 8, quantity: '500000000', fiatRate: 35 }, // 5 XCP
            { tick: 'PEPECASH', displayName: 'PepeCash', divisibility: 8, quantity: '10000000000', fiatRate: 0.0012, imageUrl: nftImg('PEPE', '#1B5E20', '#388E3C') }, // 100 PEPECASH
            { tick: 'BANANE', displayName: 'Banane', divisibility: 8, quantity: '20000000000', fiatRate: 0.04 }, // 200 BANANE
            { tick: 'RUSTBITS', displayName: 'Rustbits', divisibility: 8, quantity: '750000000', fiatRate: 2.50 }, // 7.5 RUSTBITS
            // Indivisible — surfaced in NFTs because they carry imageUrl
            { tick: 'RAREPEPE', displayName: 'Rare Pepe', divisibility: 0, quantity: '1', fiatRate: 650, imageUrl: nftImg('PEPE', '#7B2C8F', '#C2185B') },
            { tick: 'BITCRYSTAL', displayName: 'Bitcrystals', divisibility: 0, quantity: '1', fiatRate: 220, imageUrl: nftImg('BIT', '#1565C0', '#00838F') },
            { tick: 'XCPCARD', displayName: 'XCP Founders Card', divisibility: 0, quantity: '1', fiatRate: 120, imageUrl: nftImg('XCP', '#1E90C7', '#7B2C8F') },
        ],
    },
    'bitcoin-testnet': {
        native: { tick: 'BTC', divisibility: 8, quantity: '5000000' }, // 0.05 tBTC
        tokens: [],
    },
    'bitcoin-regtest': {
        native: { tick: 'BTC', divisibility: 8, quantity: '10000000000', fiatRate: 70000 }, // 100 rBTC @ $70k
        tokens: [
            // Divisible tokens — appear in Tokens tab
            { tick: 'XCP', displayName: 'Counterparty', divisibility: 8, quantity: '500000000', fiatRate: 30 },
            // PEPECASH carries an image, so it appears in BOTH Tokens (row) and NFTs (tile)
            { tick: 'PEPECASH', displayName: 'PEPECASH', divisibility: 8, quantity: '10000000000', fiatRate: 0.0008, imageUrl: nftImg('PEPE', '#1B5E20', '#388E3C') },
            { tick: 'USDX', displayName: 'USD Stablecoin (demo)', divisibility: 8, quantity: '25000000000', fiatRate: 1 },
            { tick: 'DEMOCOIN', displayName: 'Demo Coin', divisibility: 8, quantity: '100000000', fiatRate: 0.05 },
            // Indivisible tokens — also appear in NFTs because they have an imageUrl
            { tick: 'RAREPEPE', displayName: 'Rare Pepe', divisibility: 0, quantity: '1', fiatRate: 500, imageUrl: nftImg('PEPE', '#7B2C8F', '#C2185B') },
            { tick: 'BITCRYSTAL', displayName: 'Bitcrystals', divisibility: 0, quantity: '1', fiatRate: 200, imageUrl: nftImg('BIT', '#1565C0', '#00838F') },
            { tick: 'XCHAINLOGO', displayName: 'XChain Logo NFT', divisibility: 0, quantity: '1', fiatRate: 50, imageUrl: nftImg('XC', '#1E90C7', '#7B2C8F') },
        ],
    },
    'litecoin-mainnet': {
        native: { tick: 'LTC', divisibility: 8, quantity: '500000000', fiatRate: 90 }, // 5 LTC ≈ $450
        tokens: [
            // Divisible LTC-side tokens
            { tick: 'LITECRED', displayName: 'LiteCred Stablecoin', divisibility: 8, quantity: '15000000000', fiatRate: 1 }, // 150 LITECRED
            { tick: 'OMNILITE', displayName: 'OmniLite Token', divisibility: 8, quantity: '4200000000', fiatRate: 3.10 }, // 42 OMNILITE
            { tick: 'MWEB', displayName: 'MimbleWimble Token', divisibility: 8, quantity: '2500000000', fiatRate: 6 }, // 25 MWEB
            // Indivisible — NFTs tab
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
            // Indivisible — NFTs tab (have imageUrl)
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
            // Indivisible — NFTs tab
            { tick: 'DOGINAL', displayName: 'Doginal #1337', divisibility: 0, quantity: '1', fiatRate: 18, imageUrl: nftImg('1337', '#F59E0B', '#B45309') },
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
            // Indivisible — NFTs tab (have imageUrl)
            { tick: 'DOGINAL', displayName: 'Doginal #1337', divisibility: 0, quantity: '1', fiatRate: 15, imageUrl: nftImg('1337', '#F59E0B', '#B45309') },
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

    // Rows mirror the real `getAddressHistory` shape — top-level
    // action_index / tx_hash / block_index / source / destination /
    // tick / tick / amount — so History.jsx accepts them as entries
    // (it skips rows without action_index, and summarizeRow / search
    // read flat top-level fields). The `params` nest is preserved so
    // HomeTabs' demo activity list (which reads `r.params.*`) keeps
    // working unchanged.
    const rows = [];

    // Native receive — newest, pending.
    rows.push({
        action_index: 100001,
        tx_hash: `demo-${chainId}-incoming-1`,
        txHash: `demo-${chainId}-incoming-1`,
        block_index: null, // pending — exercises the timeline pending state
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

    // Token receive — a friend tipped us some of the first divisible
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

    // NFT / indivisible receive — someone shipped us a 1-of-1 collectible.
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
        // 100005) via `order_action_index` — grouping collapses these
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
        // SWEEP — standalone, demonstrates another action type.
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
 * a contract deployment / execution) rather than a position snapshot —
 * lets the DeFi tab render as a History-style feed of recent actions.
 *
 * Stakes are XCHAIN-only because that's what the protocol actually
 * supports; dispensers and contracts can wrap any token. Title /
 * secondary / badge are preserved so a future detail view can show
 * them, but the list-row render only consumes `action / primary /
 * blockIndex / timestamp / status / confirms / chainId`.
 *
 * @returns {Array<{ id: string, kind: 'stake' | 'dispenser' | 'contract', action: string, status: 'confirmed' | 'pending' | 'failed', title: string, primary: string, secondary: string, badge: string, blockIndex: number | null, timestamp: number, confirms: number, chain: string, chainId: string, tick?: string }>}
 */
export function synthesizeDemoDefiPositions() {
    const nowSec = Math.floor(Date.now() / 1000);
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
        // Litecoin mainnet — stake doesn't exist outside Bitcoin in
        // the current protocol; only dispensers and contracts on LTC.
        {
            id: 'demo-dispenser-litecred-mainnet',
            kind: 'dispenser', action: 'DISPENSER', status: 'confirmed',
            title: 'LITECRED dispenser', primary: '500 LITECRED remaining',
            secondary: '0.2 LTC per dispense · 3 dispenses so far', badge: 'Open',
            blockIndex: 4_512_010, timestamp: ago(60 * 60 * 18), confirms: 96,
            chain: 'LITECOIN', chainId: 'litecoin-mainnet', tick: 'LITECRED',
        },
        // Dogecoin mainnet — stake is Bitcoin-only.
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
        // Litecoin regtest — stake is Bitcoin-only.
        {
            id: 'demo-dispenser-litecred',
            kind: 'dispenser', action: 'DISPENSER', status: 'confirmed',
            title: 'LITECRED dispenser', primary: '2,000 LITECRED remaining',
            secondary: '0.5 LTC per dispense · 6 dispenses so far', badge: 'Open',
            blockIndex: 7_810, timestamp: ago(60 * 60 * 30), confirms: 220,
            chain: 'LITECOIN', chainId: 'litecoin-regtest', tick: 'LITECRED',
        },
        // Dogecoin regtest — stake is Bitcoin-only.
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

/**
 * Synthesize the response shape `messaging.getLinksForAddress` returns
 * for a demo wallet — empty for now (cross-chain LINK fabrication is
 * a deeper exercise). Callers' .catch(() => []) path already handles
 * an empty list gracefully; this export exists so the shell can opt
 * out of the live call entirely without faking an SDK error.
 *
 * @returns {Array<unknown>}
 */
export function synthesizeDemoLinks() {
    return [];
}
