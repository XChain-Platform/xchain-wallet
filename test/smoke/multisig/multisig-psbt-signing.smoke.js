// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §56.3 Pre-launch Step 3 of 7 — Hardware-friendly
// signMultisigPsbt abstract + SoftwareSigner impl + HW stubs
// (closes FOLLOWUP 1 from 2026-04-24_phase4-close.md).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TrezorSigner } from '../../../packages/signers-trezor/src/TrezorSigner.js';
import { LedgerSigner } from '../../../packages/signers-ledger/src/LedgerSigner.js';
import { Signer, AbstractMethodError } from '../../../packages/core/src/signers/Signer.js';
import { SoftwareSigner } from '../../../packages/core/src/signers/SoftwareSigner.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');

// ─── Signer base exposes signMultisigPsbt as abstract ─────────

const base = new Signer();
await assert.rejects(
    async () => base.signMultisigPsbt({}),
    AbstractMethodError,
    'Signer.signMultisigPsbt is abstract',
);

// ─── TrezorSigner / LedgerSigner throw the right errors ──────

const trezor = new TrezorSigner({
    id: 't', displayName: 'Trezor', model: 'T2T1',
    deviceIdentifier: 'x', connect: {},
});
await assert.rejects(
    async () => trezor.signMultisigPsbt(),
    /signTransaction envelope requires multisig/i,
    'Trezor signMultisigPsbt surfaces the envelope-plumbing deferral',
);

const ledger = new LedgerSigner({
    id: 'l', displayName: 'Ledger', model: 'nanoX',
    deviceIdentifier: 'y', app: {},
});
await assert.rejects(
    async () => ledger.signMultisigPsbt(),
    /registered wallet policy/i,
    'Ledger signMultisigPsbt surfaces the wallet-policy deferral',
);

// ─── SoftwareSigner.signMultisigPsbt shape ────────────────────

// We can't easily exercise a real sdk.wallet.signMultisigPsbt call
// without a pinned SDK + an actual PSBT, so drive the method's
// guards using a stubbed unlock state + a stubbed sdkRegistry.
const softwareSigner = new SoftwareSigner({
    id: 'ss',
    displayName: 'Software',
    chainRegistry: { get: () => ({ wifVersionByte: 0x80 }) },
    walletEncryption: {
        encryptedSeed: '', kdfParams: {}, format: 'bip39', passphraseEnabled: false, importedKeys: [],
    },
});

await assert.rejects(
    async () => softwareSigner.signMultisigPsbt({
        chainId: 'bitcoin-mainnet',
        psbtHex: '70736274ff0100',
        signingPaths: [{ inputIndex: 0, path: "m/48'/0'/0'/2'/0/0" }],
    }),
    /Signer "ss" is locked/,
    'SoftwareSigner.signMultisigPsbt rejects when the signer is locked',
);

// Simulate unlock so the sdkRegistry guard fires next.
softwareSigner._acceptUnlockedState({
    seed: new Uint8Array(64),
    mnemonicBytes: new Uint8Array(0),
    importedWifs: new Map(),
});
await assert.rejects(
    async () => softwareSigner.signMultisigPsbt({
        chainId: 'bitcoin-mainnet',
        psbtHex: '',
        signingPaths: [{ inputIndex: 0, path: "m/48'/0'/0'/2'/0/0" }],
    }),
    /requires an sdkRegistry|psbtHex is required/,
    'SoftwareSigner.signMultisigPsbt requires psbtHex or an sdkRegistry to proceed',
);

// Install a stub sdkRegistry that surfaces the "bump xchain-sdk"
// guidance when sdk.wallet.signMultisigPsbt is absent.
const stubRegistryOld = { get: () => ({ wallet: { /* no signMultisigPsbt */ } }) };
softwareSigner._sdkRegistry = stubRegistryOld;
await assert.rejects(
    async () => softwareSigner.signMultisigPsbt({
        chainId: 'bitcoin-mainnet',
        psbtHex: '70736274ff0100',
        signingPaths: [{ inputIndex: 0, path: "m/48'/0'/0'/2'/0/0" }],
    }),
    /bump xchain-sdk to \^1\.13\.0/,
    'SoftwareSigner surfaces a clear "bump SDK" message when signMultisigPsbt is missing',
);

// With a stub that DOES implement signMultisigPsbt we verify the
// method completes and returns the expected shape — even with a
// placeholder PSBT. The stub echoes back a mutated PSBT hex so we
// can check the return plumbing.
let capturedPsbt = null;
let capturedWif = null;
const stubRegistryNew = {
    get: () => ({
        wallet: {
            signMultisigPsbt(psbtHex, wif) {
                capturedPsbt = psbtHex;
                capturedWif = wif;
                return { psbtHex: `${psbtHex}00` };
            },
        },
    }),
};
softwareSigner._sdkRegistry = stubRegistryNew;

// Stub the WIF derivation (the real path requires a real seed).
softwareSigner._deriveWifFor = () => 'Kx-fake-wif';

const result = await softwareSigner.signMultisigPsbt({
    chainId: 'bitcoin-mainnet',
    psbtHex: '70736274ff0100',
    signingPaths: [{ inputIndex: 0, path: "m/48'/0'/0'/2'/0/0" }],
});
assert.equal(result.psbtHex, '70736274ff010000',
    'signMultisigPsbt returns the SDK\'s signed PSBT hex');
assert.equal(capturedPsbt, '70736274ff0100',
    'SDK received the input PSBT verbatim');
assert.equal(capturedWif, 'Kx-fake-wif',
    'SDK received the WIF from _deriveWifFor');

// Empty signingPaths rejected.
await assert.rejects(
    async () => softwareSigner.signMultisigPsbt({
        chainId: 'bitcoin-mainnet',
        psbtHex: '70736274ff0100',
        signingPaths: [],
    }),
    /signingPaths must be non-empty/,
);

// ─── Signer.js typedef additions ──────────────────────────────

const signerSrc = readFileSync(join(core, 'src', 'signers', 'Signer.js'), 'utf8');
assert.ok(/typedef \{Object\} SignMultisigPsbtParams/.test(signerSrc),
    'Signer.js declares SignMultisigPsbtParams typedef');
assert.ok(/typedef \{Object\} SignMultisigPsbtReturn/.test(signerSrc),
    'Signer.js declares SignMultisigPsbtReturn typedef');

// ─── SDK pin bumped to ^1.13.0 ────────────────────────────────

for (const [shell, pkgPath] of [
    ['extension', join(ext, 'package.json')],
    ['web', join(web, 'package.json')],
]) {
    const pkg = readFileSync(pkgPath, 'utf8');
    assert.ok(/"xchain-sdk":\s*"(?:link:|\^1\.(?:1[3-9]|[2-9]\d)\.0)/.test(pkg),
        `${shell} pkg pins xchain-sdk ≥ ^1.13.0 or uses link: for sibling-repo dev`);
}

console.log(
    'OK — multisig PSBT signing smoke (Signer.signMultisigPsbt abstract + Trezor envelope-deferral error + Ledger wallet-policy-deferral error + SoftwareSigner guards lock / empty psbtHex / empty signingPaths / SDK-too-old / sends PSBT+WIF through sdk.wallet.signMultisigPsbt + typedef additions + SDK pin ^1.13.0)',
);
