export {
    Signer,
    AbstractMethodError,
    SignerLockedError,
    SignerStatusError,
    NotImplementedError,
} from './Signer.js';

export { SoftwareSigner } from './SoftwareSigner.js';
export { SignerPool } from './SignerPool.js';

// §9 / G001 — TrezorSigner now lives in @xchain-wallet/signers-trezor.
// Cross-package relative path (matches the shell-factory convention)
// keeps the back-compat surface working without depending on pnpm
// workspace symlinks at smoke-test time.
export {
    TrezorSigner,
    deviceIdentifierFromFeatures,
    modelFromFeatures,
    firmwareVersionFromFeatures,
} from '../../../signers-trezor/src/TrezorSigner.js';

export {
    LedgerSigner,
    deriveLedgerDeviceIdentifier,
    modelFromLedgerTransport,
} from './LedgerSigner.js';

export { RemoteSigner } from './RemoteSigner.js';

export {
    bindRendererPortBridge,
    createBackgroundTransport,
} from './signerPortProtocol.js';

export { checkFirmware, compareVersions } from './checkFirmware.js';
export { FIRMWARE_MANIFEST } from './firmware-manifest.js';
