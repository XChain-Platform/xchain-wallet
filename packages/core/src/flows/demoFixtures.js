// §25.2 / Cluster J FOLLOWUP 1 — synthesized fixture data for demo
// wallets so Home / History / TokenDetail surfaces feel populated
// without requiring the user to fund the wallet.
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
        native: { asset: 'BTC', divisibility: 8, quantity: '100000000' }, // 1 rBTC
        assets: [],
    },
    'litecoin-mainnet': {
        native: { asset: 'LTC', divisibility: 8, quantity: '250000000' }, // 2.5 LTC
        assets: [],
    },
    'dogecoin-mainnet': {
        native: { asset: 'DOGE', divisibility: 8, quantity: '5000000000' }, // 50 DOGE
        assets: [],
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
    return [
        {
            txHash: `demo-${chainId}-incoming-1`,
            blockIndex: null, // pending — exercises the timeline pending state
            timestamp: Math.floor(now / 1000) - 300,
            action: 'SEND',
            params: {
                source: 'demo-faucet-1xchainpubdemoxchain',
                destination: address,
                asset: tick,
                amount: fixture.native.quantity,
                memo: 'Welcome to the demo wallet',
            },
        },
        {
            txHash: `demo-${chainId}-issue-1`,
            blockIndex: 12345,
            timestamp: Math.floor(now / 1000) - 86400,
            action: 'ISSUE',
            params: {
                source: address,
                asset: 'DEMOCOIN',
                quantity: '100000000',
                divisible: true,
                description: 'Demo asset issued during the demo session.',
            },
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
