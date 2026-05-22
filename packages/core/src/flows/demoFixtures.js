// §25.2 / Cluster J FOLLOWUP 1 — synthesized fixture data for demo
// wallets so Home / History / TokenDetail surfaces feel populated
// without requiring the user to fund the wallet.
//
// `nftImg` returns an inline SVG data URI used as a stand-in for an
// asset's image. Real wallets get imageUrl from the indexer; the demo
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
 * @typedef {{ asset: string, divisibility: number, quantity: string }} NativeFixture
 * @typedef {{ asset: string, displayName: string, divisibility: number, quantity: string }} AssetFixture
 * @typedef {{ native: NativeFixture | null, assets: AssetFixture[] }} BalanceFixture
 */

const PER_CHAIN_DEFAULTS = /** @type {Record<string, BalanceFixture>} */ ({
    'bitcoin-mainnet': {
        native: { asset: 'BTC', divisibility: 8, quantity: '12345678' }, // 0.12345678 BTC
        assets: [
            { asset: 'XCP', displayName: 'Counterparty', divisibility: 8, quantity: '500000000' }, // 5 XCP
            { asset: 'PEPECASH', displayName: 'PEPECASH', divisibility: 8, quantity: '10000000000' }, // 100 PEPECASH
        ],
    },
    'bitcoin-testnet': {
        native: { asset: 'BTC', divisibility: 8, quantity: '5000000' }, // 0.05 tBTC
        assets: [],
    },
    'bitcoin-regtest': {
        native: { asset: 'BTC', divisibility: 8, quantity: '10000000000', fiatRate: 70000 }, // 100 rBTC @ $70k
        assets: [
            // Divisible tokens — appear in Tokens tab
            { asset: 'XCP', displayName: 'Counterparty', divisibility: 8, quantity: '500000000', fiatRate: 30 },
            // PEPECASH carries an image, so it appears in BOTH Tokens (row) and NFTs (tile)
            { asset: 'PEPECASH', displayName: 'PEPECASH', divisibility: 8, quantity: '10000000000', fiatRate: 0.0008, imageUrl: nftImg('PEPE', '#1B5E20', '#388E3C') },
            { asset: 'USDX', displayName: 'USD Stablecoin (demo)', divisibility: 8, quantity: '25000000000', fiatRate: 1 },
            { asset: 'DEMOCOIN', displayName: 'Demo Coin', divisibility: 8, quantity: '100000000', fiatRate: 0.05 },
            // Indivisible tokens — also appear in NFTs because they have an imageUrl
            { asset: 'RAREPEPE', displayName: 'Rare Pepe', divisibility: 0, quantity: '1', fiatRate: 500, imageUrl: nftImg('PEPE', '#7B2C8F', '#C2185B') },
            { asset: 'BITCRYSTAL', displayName: 'Bitcrystals', divisibility: 0, quantity: '1', fiatRate: 200, imageUrl: nftImg('BIT', '#1565C0', '#00838F') },
            { asset: 'XCHAINLOGO', displayName: 'XChain Logo NFT', divisibility: 0, quantity: '1', fiatRate: 50, imageUrl: nftImg('XC', '#1E90C7', '#7B2C8F') },
        ],
    },
    'litecoin-mainnet': {
        native: { asset: 'LTC', divisibility: 8, quantity: '250000000' }, // 2.5 LTC
        assets: [],
    },
    'litecoin-regtest': {
        native: { asset: 'LTC', divisibility: 8, quantity: '100000000000', fiatRate: 80 }, // 1000 rLTC @ $80
        assets: [
            // Divisible LTC-side tokens
            { asset: 'LITECRED', displayName: 'LiteCred Stablecoin (demo)', divisibility: 8, quantity: '50000000000', fiatRate: 1 },
            { asset: 'MWEB', displayName: 'MimbleWimble Token', divisibility: 8, quantity: '7500000000', fiatRate: 5 },
            { asset: 'LTCDOGE', displayName: 'LTC × DOGE Pair', divisibility: 8, quantity: '12500000000', fiatRate: 2 },
            // Indivisible — NFTs tab (have imageUrl)
            { asset: 'LITEORD', displayName: 'Lite Ordinal #042', divisibility: 0, quantity: '1', fiatRate: 40, imageUrl: nftImg('LO42', '#0EA5E9', '#1E40AF') },
            { asset: 'MIMBLEPUNK', displayName: 'MimblePunk #7', divisibility: 0, quantity: '1', fiatRate: 80, imageUrl: nftImg('MP7', '#06B6D4', '#0369A1') },
        ],
    },
    'dogecoin-mainnet': {
        native: { asset: 'DOGE', divisibility: 8, quantity: '5000000000' }, // 50 DOGE
        assets: [],
    },
    'dogecoin-regtest': {
        native: { asset: 'DOGE', divisibility: 8, quantity: '1000000000000', fiatRate: 0.15 }, // 10000 rDOGE @ $0.15
        assets: [
            // Divisible DRC-20-style tokens
            { asset: 'DOGI', displayName: 'Dogi Coin', divisibility: 8, quantity: '500000000000', fiatRate: 0.01 },
            { asset: 'WOW', displayName: 'Wow Such Token', divisibility: 8, quantity: '12500000000', fiatRate: 0.5 },
            { asset: 'DSHIB', displayName: 'Doge Shib', divisibility: 8, quantity: '7500000000000', fiatRate: 0.0001 },
            { asset: 'BARK', displayName: 'Bark Stablecoin (demo)', divisibility: 8, quantity: '20000000000', fiatRate: 1 },
            // Indivisible — NFTs tab (have imageUrl)
            { asset: 'DOGINAL', displayName: 'Doginal #1337', divisibility: 0, quantity: '1', fiatRate: 15, imageUrl: nftImg('1337', '#F59E0B', '#B45309') },
            { asset: 'MEMECARD', displayName: 'Meme Card: To The Moon', divisibility: 0, quantity: '1', fiatRate: 30, imageUrl: nftImg('MOON', '#EAB308', '#92400E') },
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
                ? { native: fixture.native, assets: fixture.assets }
                : { native: fixture?.native ? { ...fixture.native, quantity: '0' } : null, assets: [] },
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
    const tick = fixture.native.asset;
    const sec = (deltaSec) => Math.floor(now / 1000) - deltaSec;

    // Rows mirror the real `getAddressHistory` shape — top-level
    // action_index / tx_hash / block_index / source / destination /
    // tick / asset / amount — so History.jsx accepts them as entries
    // (it skips rows without action_index, and summarizeRow / search
    // read flat top-level fields). The `params` nest is preserved so
    // HomeTabs' demo activity list (which reads `r.params.*`) keeps
    // working unchanged.
    return [
        {
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
        },
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
            // the top-level tick/asset so this row is searchable by the
            // native ticker (the TokenDetail → View activity flow opens
            // History pre-filtered to the asset).
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
    ];
}

/**
 * Synthesized DeFi positions for the demo wallet. Surfaces a single
 * stake, a single dispenser, and a single contract balance — enough
 * to demonstrate the DeFi tab's eventual structure without pretending
 * to be a real LP.
 *
 * @returns {Array<{ id: string, kind: 'stake' | 'dispenser' | 'contract', title: string, primary: string, secondary: string, badge: string }>}
 */
export function synthesizeDemoDefiPositions() {
    return [
        // Bitcoin-side positions
        {
            id: 'demo-stake-btc',
            kind: 'stake',
            title: 'BTC validator stake',
            primary: '5.00000000 BTC',
            secondary: 'Earning · 0.012 BTC unclaimed rewards',
            badge: 'Tier 3',
            chain: 'BITCOIN',
            chainId: 'bitcoin-regtest',
        },
        {
            id: 'demo-stake-xcp',
            kind: 'stake',
            title: 'XCP delegation',
            primary: '1,500.00000000 XCP',
            secondary: 'Delegated to demo-validator-7 · 4.2% APY',
            badge: 'Active',
            chain: 'BITCOIN',
            chainId: 'bitcoin-regtest',
        },
        {
            id: 'demo-dispenser-democoin',
            kind: 'dispenser',
            title: 'DEMOCOIN dispenser',
            primary: '500 DEMOCOIN remaining',
            secondary: '0.001 BTC per dispense · 12 dispenses so far',
            badge: 'Open',
            chain: 'BITCOIN',
            chainId: 'bitcoin-regtest',
        },
        {
            id: 'demo-contract-vault',
            kind: 'contract',
            title: 'BTC vault contract',
            primary: '0.25 BTC locked',
            secondary: 'demo-contract-vault · withdraw window in 14h',
            badge: 'Vault',
            chain: 'BITCOIN',
            chainId: 'bitcoin-regtest',
        },
        // Litecoin-side positions
        {
            id: 'demo-stake-ltc',
            kind: 'stake',
            title: 'LTC validator stake',
            primary: '250.00000000 LTC',
            secondary: 'Earning · 0.85 LTC unclaimed rewards',
            badge: 'Tier 2',
            chain: 'LITECOIN',
            chainId: 'litecoin-regtest',
        },
        {
            id: 'demo-dispenser-litecred',
            kind: 'dispenser',
            title: 'LITECRED dispenser',
            primary: '2,000 LITECRED remaining',
            secondary: '0.5 LTC per dispense · 6 dispenses so far',
            badge: 'Open',
            chain: 'LITECOIN',
            chainId: 'litecoin-regtest',
        },
        // Dogecoin-side positions
        {
            id: 'demo-stake-doge',
            kind: 'stake',
            title: 'DOGE community stake',
            primary: '50,000.00000000 DOGE',
            secondary: 'Delegated to demo-validator-much-wow · 6.1% APY',
            badge: 'Active',
            chain: 'DOGECOIN',
            chainId: 'dogecoin-regtest',
        },
        {
            id: 'demo-dispenser-dogi',
            kind: 'dispenser',
            title: 'DOGI dispenser',
            primary: '10,000 DOGI remaining',
            secondary: '50 DOGE per dispense · 22 dispenses so far',
            badge: 'Open',
            chain: 'DOGECOIN',
            chainId: 'dogecoin-regtest',
        },
        {
            id: 'demo-contract-doge-vault',
            kind: 'contract',
            title: 'DOGE memepool vault',
            primary: '5,000 DOGE locked',
            secondary: 'demo-contract-memepool · withdraw window in 3d',
            badge: 'Vault',
            chain: 'DOGECOIN',
            chainId: 'dogecoin-regtest',
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
