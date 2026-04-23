// Shell-agnostic hardware-signer pair factories. Each shell binds its
// own HW SDK imports (`@trezor/connect-web`, `@ledgerhq/hw-transport-*`,
// `@ledgerhq/hw-app-btc`) and feeds them to these builders via DI so
// core stays free of native HW dependencies.
//
// Intended call-sites: `packages/{extension,web,desktop}/…/signerFactories/`.

export { makeTrezorFactory } from './trezor.js';
export { makeLedgerFactory } from './ledger.js';
