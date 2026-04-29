// §9 / G001 — `@xchain-wallet/signers-trezor` package entry point.
//
// Trezor-specific signer implementation extracted from
// `@xchain-wallet/core/signers/`. The base `Signer` class and shared
// firmware-manifest infrastructure stay in `@xchain-wallet/core` so
// every vendor package can depend on a single source of truth.
//
// Consumers can import the concrete class + helpers via this entry
// point (canonical) or the back-compat re-exports in
// `@xchain-wallet/core/signers/index.js` (kept for now so existing
// shell imports that go through `core` keep working). The factory
// (`makeTrezorFactory`) still lives in `@xchain-wallet/core/signerFactories`
// — it owns the post-init pair sequence, which is shell-agnostic.

export {
    TrezorSigner,
    deviceIdentifierFromFeatures,
    modelFromFeatures,
    firmwareVersionFromFeatures,
} from './TrezorSigner.js';

export {
    chainIdToTrezorCoin,
    toTrezorSignTransaction,
    pathToAddressN,
} from './trezorFormat.js';
