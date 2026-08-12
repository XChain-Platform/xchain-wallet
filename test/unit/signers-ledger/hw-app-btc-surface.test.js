// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pins the Ledger app-client surface the wallet calls against the class
// @ledgerhq/hw-app-btc actually ships.
//
// Every other Ledger test injects a hand-written fake. Those fakes were
// written from our own call sites, so for two releases they asserted a
// device API that does not exist: `app.getAppAndVersion()` (never a
// method, only a standalone helper) and `app.signMessageNew()` (renamed
// to `signMessage` in hw-app-btc v10). Both threw TypeError on first
// contact with real hardware and every unit test stayed green.
//
// A fake can only be as correct as the surface it is modelled on, so
// this file models nothing: it reads the installed package.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The CJS build deliberately: hw-app-btc's lib-es entry uses
// extensionless relative imports that only a bundler resolves. Same
// source, same version, and it makes the test independent of how the
// runner happens to resolve ESM.
const require = createRequire(import.meta.url);
const BtcModule = require('@ledgerhq/hw-app-btc');
const Btc = BtcModule.default ?? BtcModule;

/**
 * Methods LedgerSigner + makeLedgerFactory invoke on the injected app
 * client. Keep in sync with the `LedgerBtcApp` typedef in
 * packages/signers-ledger/src/LedgerSigner.js.
 */
const METHODS_THE_WALLET_CALLS = [
    'getWalletPublicKey',
    'signMessage',
    'createPaymentTransaction',
    'splitTransaction',
];

/**
 * Names the wallet used to call that the shipped class never had. Pinned
 * so a future "restore the old name" edit fails here instead of on a
 * user's desk.
 */
const NAMES_THAT_DO_NOT_EXIST = ['getAppAndVersion', 'signMessageNew'];

describe('@ledgerhq/hw-app-btc surface the wallet depends on', () => {
    it('exposes a constructable Btc class', () => {
        expect(typeof Btc).toBe('function');
        expect(Btc.name).toBe('Btc');
    });

    it.each(METHODS_THE_WALLET_CALLS)('ships %s as an instance method', (method) => {
        expect(typeof Btc.prototype[method]).toBe('function');
    });

    it.each(NAMES_THAT_DO_NOT_EXIST)('does NOT ship %s (why appInfo.js exists)', (method) => {
        expect(Btc.prototype[method]).toBeUndefined();
    });

    // The list above is hand-maintained, so on its own it only catches a
    // name someone remembered to add. This reads the call sites straight
    // out of the source, which is what makes the check survive the next
    // method someone wires up.
    it('every app-client method the source calls exists on the shipped class', () => {
        const sources = [
            '../../../packages/signers-ledger/src/LedgerSigner.js',
            '../../../packages/core/src/signerFactories/ledger.js',
        ];
        const called = new Set();
        for (const rel of sources) {
            const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
            // `this._app.foo(` and `app.foo(`, skipping `this._app.foo =`
            // style assignments (there are none today, and a match there
            // would be a definition rather than a call).
            for (const m of src.matchAll(/(?:this\._app|\bapp)\.([A-Za-z_$][\w$]*)\s*\(/g)) {
                called.add(m[1]);
            }
        }
        expect(called.size).toBeGreaterThan(0);

        const missing = [...called].filter((name) => typeof Btc.prototype[name] !== 'function');
        expect(missing, `called on the Ledger app client but absent from hw-app-btc's Btc: ${missing.join(', ')}`)
            .toEqual([]);
    });

    it('exposes getAppAndVersion only as a standalone transport helper', () => {
        const helper = require('@ledgerhq/hw-app-btc/lib/getAppAndVersion');
        expect(typeof helper.getAppAndVersion).toBe('function');
        // Takes a transport, not a bound app client: it reads one BOLOS
        // APDU, which is what packages/signers-ledger/src/appInfo.js
        // reimplements so the package stays free of @ledgerhq imports.
        expect(helper.getAppAndVersion.length).toBe(1);
    });
});

// defect 4: `makeLedgerFactory` never passed an sdkRegistry, and it is
// the only construction site, so EVERY hardware PSBT attempt threw "requires an
// sdkRegistry". It looked like an architecture call - which shell's registry? -
// until you look at what the signer asks for: decomposePsbt and txidOf, both
// pure parsing. `walletOnlyRegistry` is the answer to that question, and these
// pin the two properties that make it safe to build in a popup.
describe('walletOnlyRegistry', () => {

    it('answers per chainId and caches the instance', async () => {
        const { walletOnlyRegistry } = await import('../../../packages/core/src/signerFactories/ledger.js');
        let built = 0;
        class FakeWalletUtils {
            constructor(chainId) { this.chainId = chainId; built += 1; }
        }
        const registry = walletOnlyRegistry(FakeWalletUtils);

        const a = registry.get('bitcoin-mainnet');
        const b = registry.get('bitcoin-mainnet');
        expect(a).toBe(b);                       // a signer signs for one chain many times
        expect(a.wallet.chainId).toBe('bitcoin-mainnet');
        expect(built).toBe(1);

        registry.get('litecoin-mainnet');
        expect(built).toBe(2);
    });

    it('exposes ONLY wallet, so no signer path can quietly acquire network access', async () => {
        const { walletOnlyRegistry } = await import('../../../packages/core/src/signerFactories/ledger.js');
        class FakeWalletUtils {}
        const entry = walletOnlyRegistry(FakeWalletUtils).get('bitcoin-mainnet');
        expect(Object.keys(entry)).toEqual(['wallet']);
        expect(entry.explorer).toBeUndefined();
        expect(entry.encoder).toBeUndefined();
    });
});
