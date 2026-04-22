// Shared enums used across multiple schemas. Schema-specific enums
// (Wallet.origin, PendingTx.status, etc.) live next to their owning schema.

export const NETWORKS = /** @type {const} */ (['mainnet', 'testnet', 'regtest']);

export const ACTION_PERMISSIONS = /** @type {const} */ (['always', 'ask', 'never']);

export const ADDRESS_SOURCES = /** @type {const} */ ([
    'hd',
    'imported-wif',
    'watch-only',
    'trezor',
    'ledger',
]);
