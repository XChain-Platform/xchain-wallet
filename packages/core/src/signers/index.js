// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

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

// §9 / G002 — LedgerSigner now lives in @xchain-wallet/signers-ledger.
// Same back-compat shim as @xchain-wallet/signers-trezor above.
export {
    LedgerSigner,
    deriveLedgerDeviceIdentifier,
    modelFromLedgerTransport,
} from '../../../signers-ledger/src/LedgerSigner.js';

export { RemoteSigner } from './RemoteSigner.js';

export {
    bindRendererPortBridge,
    createBackgroundTransport,
} from './signerPortProtocol.js';

export { checkFirmware, compareVersions } from './checkFirmware.js';
export { FIRMWARE_MANIFEST } from './firmware-manifest.js';
