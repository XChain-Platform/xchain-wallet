// Barrel for the schema module. Consumers should import from
// '@xchain-wallet/core/schemas' once the package exports are wired.

export * from './constants.js';
export * from './validate.js';

export * as wallet from './wallet.js';
export * as account from './account.js';
export * as address from './address.js';
export * as contact from './contact.js';
export * as connectedSite from './connectedSite.js';
export * as multisigConfig from './multisigConfig.js';
export * as settings from './settings.js';
export * as pendingTx from './pendingTx.js';
export * as migrations from './migrations.js';

export { createWallet, validateWallet } from './wallet.js';
export { createAccount, validateAccount } from './account.js';
export { createAddress, validateAddress } from './address.js';
export { createContact, validateContact } from './contact.js';
export { createConnectedSite, validateConnectedSite } from './connectedSite.js';
export { validateMultisigConfig } from './multisigConfig.js';
export {
    createDefaultSettings,
    createDefaultAdsChainState,
    validateSettings,
    ADS_DEFAULT_ENABLED,
} from './settings.js';
export { createPendingTx, validatePendingTx } from './pendingTx.js';
export {
    migrate,
    migrateWallet,
    migrateAccount,
    migrateAddress,
    migrateContact,
    migrateConnectedSite,
    migrateSettings,
    migratePendingTx,
    migrateMultisigConfig,
} from './migrations.js';
