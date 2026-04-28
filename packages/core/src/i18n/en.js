// Back-compat shim — the canonical English dictionary moved under
// `./locales/en/index.js` at v0.216.0 (§54 / G173). Existing imports of
// `./i18n/en.js` keep working through this re-export so we don't have
// to chase every consumer in one step. New code should import from
// `./i18n/locales/en/index.js` (or pull the `i18n` namespace from
// `@xchain-wallet/core`, which already routes through the new path).

export { en } from './locales/en/index.js';
