// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §9 / G002: `@xchain-wallet/signers-ledger` package entry point.
//
// Ledger-specific signer implementation extracted from
// `@xchain-wallet/core/signers/`. Mirrors the §9 / G001 split for
// `@xchain-wallet/signers-trezor`: the base `Signer` class stays in
// core; vendor implementations live in their own workspace packages
// so the wallet's surface area scales by vendor instead of bloating
// core's dep graph (Ledger pulls `@noble/hashes`, future vendors may
// pull device-specific transport libs).
//
// Consumers can import the concrete class + helpers via this entry
// point (canonical) or the back-compat re-exports in
// `@xchain-wallet/core/signers/index.js` (kept so existing shell
// imports that go through `core` keep working). The factory
// (`makeLedgerFactory`) still lives in `@xchain-wallet/core/signerFactories`
// It owns the post-init pair sequence, which is shell-agnostic.

export {
    LedgerSigner,
    deriveLedgerDeviceIdentifier,
    modelFromLedgerTransport,
} from './LedgerSigner.js';

export { readLedgerAppInfo } from './appInfo.js';

export {
    chainIdToLedgerCurrency,
    serializeOutputs,
    synthesizeMinimalPrevTx,
    toLedgerCreatePayment,
    addressTypeFromPath,
    composeBitcoinCompactSignature,
} from './ledgerFormat.js';
