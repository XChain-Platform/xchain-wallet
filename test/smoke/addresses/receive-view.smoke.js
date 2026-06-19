// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke test for Batch 2 piece 7 (Receive view + BIP21 QR).
//
// Behavioural coverage drives the two new host handlers end-to-end:
//   - `addresses.byChain` buckets a wallet's addresses by chainId and
//     skips addresses belonging to other wallets.
//   - `addresses.newest` returns the highest external-index HD address
//     for a (wallet, chain) pair, and `null` when nothing qualifies.
//
// Static coverage confirms the Receive component wires to QRCode +
// encodeBip21Uri + the three messaging helpers, the popup router has
// a `receive` sub-route, Home exposes `onReceive`, and `qrcode` is
// declared as a runtime dep.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    crypto as cryptoLib,
    registry as registryLib,
    schemas,
    sdk as sdkLib,
    storage as storageLib,
    uri as uriLib,
} from '../../../packages/core/src/index.js';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const ext = join(wsRoot, 'packages', 'extension');

// --- 1. Static surface ------------------------------------------------

// Receive is shared-hoisted at @xchain-wallet/core/shared/routes/Receive.jsx.
// Same data model as before (getAddressesByChain / getNewestAddress /
// generateReceiveAddress), but routed through useMessaging().messaging.
const sharedReceive = join(
    wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Receive.jsx',
);
const receive = readFileSync(sharedReceive, 'utf8');
for (const symbol of [
    'QRCode',
    'encodeBip21Uri',
    'ChainBadge',
    'AddressText',
    'CopyButton',
]) {
    assert.ok(receive.includes(symbol), `shared Receive.jsx references ${symbol}`);
}
// QR-first redesign: Receive reads existing addresses only
// (getAddressesByChain + getNewestAddress). The inline "derive a fresh
// next-index address" flow (messaging.generateReceiveAddress, which
// prompted for the password and surfaced InvalidPasswordError) was
// dropped from the screen. The backend handler + messaging export are
// retained (asserted below) for callers that still derive.
for (const call of [
    'messaging.getAddressesByChain',
    'messaging.getNewestAddress',
]) {
    assert.ok(receive.includes(call), `shared Receive.jsx wires ${call}`);
}
assert.ok(
    !receive.includes('messaging.generateReceiveAddress'),
    'shared Receive.jsx no longer derives a fresh address inline (QR-first)',
);

const sharedHome = join(
    wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Home.jsx',
);
const home = readFileSync(sharedHome, 'utf8');
assert.ok(
    /onReceive/.test(home),
    'shared Home.jsx accepts onReceive prop',
);
assert.ok(home.includes('onClick={onReceive}'), 'shared Home.jsx wires the Receive button');

const app = readFileSync(
    join(ext, 'src', 'popup', 'App.jsx'),
    'utf8',
);
assert.ok(app.includes("'receive'"), 'popup App.jsx tracks receive sub-route');
assert.ok(app.includes('<Receive'), 'popup App.jsx renders <Receive>');

const msg = readFileSync(
    join(ext, 'src', 'popup', 'messaging.js'),
    'utf8',
);
for (const fn of ['getAddressesByChain', 'getNewestAddress', 'generateReceiveAddress']) {
    assert.ok(
        new RegExp(`export function ${fn}\\b`).test(msg),
        `messaging.js exports ${fn}`,
    );
}
assert.ok(msg.includes("'addresses.byChain'"), 'wires addresses.byChain');
assert.ok(msg.includes("'addresses.newest'"), 'wires addresses.newest');
assert.ok(msg.includes("'receive.getAddress'"), 'wires receive.getAddress');

const extPkg = JSON.parse(readFileSync(join(ext, 'package.json'), 'utf8'));
assert.ok(extPkg.dependencies?.qrcode, 'extension declares qrcode dep');

const bgHost = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
assert.ok(
    /host\.register\('addresses\.byChain'/.test(bgHost),
    'host registers addresses.byChain',
);
assert.ok(
    /host\.register\('addresses\.newest'/.test(bgHost),
    'host registers addresses.newest',
);

// --- 2. Round-trip the two new handlers against a real Vault --------

async function buildHost() {
    // Real Vault with a random 32-byte master key; we don't care about
    // password derivation here; these handlers never touch the password.
    const masterKey = new Uint8Array(32);
    crypto.getRandomValues(masterKey);

    // In-memory backend via the core's InMemoryBackend (works in Node).
    const backend = new storageLib.InMemoryBackend();
    const vault = new storageLib.Vault({ backend, masterKey });
    await vault.open();

    // Seed a wallet + account + addresses. Bypass createWallet (which
    // pulls in SDK / derivation); these handlers only read persisted
    // records so synthetic ones with valid schema are sufficient.
    const kdfParams = cryptoLib.makeFreshKdfParams();
    const wallet = schemas.createWallet({
        name: 'Test',
        origin: 'created',
        format: 'bip39',
        passphraseEnabled: false,
        encryptedSeed: 'c3R1Yg==', // "stub" base64; decrypted seed never needed here
        kdfParams,
    });
    await vault.wallets.put(wallet);

    // Second wallet's records must not leak into the first's responses.
    const otherWallet = schemas.createWallet({
        name: 'Other',
        origin: 'created',
        format: 'bip39',
        passphraseEnabled: false,
        encryptedSeed: 'c3R1Yg==',
        kdfParams,
    });
    await vault.wallets.put(otherWallet);

    const account = schemas.createAccount({
        walletId: wallet.id,
        name: 'Main',
        index: 0,
    });
    await vault.accounts.put(account);

    const otherAccount = schemas.createAccount({
        walletId: otherWallet.id,
        name: 'Other',
        index: 0,
    });
    await vault.accounts.put(otherAccount);

    // Seed BTC-mainnet addresses at change=0, indexes 0 / 1 / 2, plus an
    // internal (change=1) address that should NOT be picked by
    // `addresses.newest`, plus one DOGE-mainnet address to prove
    // `byChain` buckets correctly.
    const btcAddrs = [0, 1, 2].map((i) =>
        schemas.createAddress({
            accountId: account.id,
            chain: 'bitcoin',
            network: 'mainnet',
            source: 'hd',
            addressType: 'p2wpkh',
            derivationPath: `m/84'/0'/0'/0/${i}`,
            address: `bc1q-external-${i}`,
            publicKey: `pk-${i}`,
            label: `Address #${i + 1}`,
        }),
    );
    const btcInternal = schemas.createAddress({
        accountId: account.id,
        chain: 'bitcoin',
        network: 'mainnet',
        source: 'hd',
        addressType: 'p2wpkh',
        derivationPath: "m/84'/0'/0'/1/99",
        address: 'bc1q-change-99',
        publicKey: 'pk-change',
        label: 'change',
    });
    const dogeAddr = schemas.createAddress({
        accountId: account.id,
        chain: 'dogecoin',
        network: 'mainnet',
        source: 'hd',
        addressType: 'p2pkh',
        derivationPath: "m/44'/3'/0'/0/0",
        address: 'D-external-0',
        publicKey: 'pk-doge',
        label: 'Doge #1',
    });
    const otherWalletAddr = schemas.createAddress({
        accountId: otherAccount.id,
        chain: 'bitcoin',
        network: 'mainnet',
        source: 'hd',
        addressType: 'p2wpkh',
        derivationPath: "m/84'/0'/0'/0/0",
        address: 'bc1q-other',
        publicKey: 'pk-other',
        label: 'should not show',
    });
    for (const a of [...btcAddrs, btcInternal, dogeAddr, otherWalletAddr]) {
        await vault.addresses.put(a);
    }

    const chainRegistry = registryLib.defaultRegistry();
    const sdkRegistry = new sdkLib.SDKRegistry({
        chainRegistry,
        sdkFactory: () => ({
            wallet: {}, auth: {},
        }),
    });
    const host = createBackgroundHost({ vault, chainRegistry, sdkRegistry });
    return { host, wallet, otherWallet, vault };
}

async function call(host, type, request) {
    const response = await host.handle({ type, request });
    if (!response.ok) {
        throw Object.assign(new Error(response.error.message), {
            name: response.error.name,
        });
    }
    return response.result;
}

// 2a. addresses.byChain
{
    const { host, wallet } = await buildHost();
    const byChain = await call(host, 'addresses.byChain', { walletId: wallet.id });
    assert.deepEqual(
        Object.keys(byChain).sort(),
        ['bitcoin-mainnet', 'dogecoin-mainnet'],
        'buckets by chainId',
    );
    assert.equal(
        byChain['bitcoin-mainnet'].length,
        4,
        'includes BTC external + internal (no filtering here; it is a full listing)',
    );
    assert.equal(byChain['dogecoin-mainnet'].length, 1);
    // Records from the other wallet must be absent.
    const allAddrs = Object.values(byChain).flat();
    assert.ok(
        !allAddrs.some((a) => a.address === 'bc1q-other'),
        'other wallet leak check',
    );
}

// 2b. addresses.newest: picks highest external HD index, skips change=1.
{
    const { host, wallet } = await buildHost();
    const newest = await call(host, 'addresses.newest', {
        walletId: wallet.id,
        chainId: 'bitcoin-mainnet',
    });
    assert.ok(newest, 'BTC newest found');
    assert.equal(newest.address, 'bc1q-external-2');
    assert.equal(newest.derivationPath, "m/84'/0'/0'/0/2");
}

// 2c. addresses.newest for a chain with no addresses returns null.
{
    const { host, wallet } = await buildHost();
    const newest = await call(host, 'addresses.newest', {
        walletId: wallet.id,
        chainId: 'litecoin-mainnet',
    });
    assert.equal(newest, null, 'no LTC addresses → null');
}

// 2d. addresses.newest rejects missing fields.
{
    const { host, wallet } = await buildHost();
    let threw = false;
    try {
        await call(host, 'addresses.newest', { walletId: wallet.id });
    } catch (e) {
        threw = true;
        assert.match(e.message, /chainId is required/);
    }
    assert.ok(threw, 'missing chainId rejected');
}

// 2e. BIP21 URI round-trip: prove the Receive QR payload we'd encode
//     parses back to the same address.
{
    const descriptor = registryLib.defaultRegistry().get('bitcoin-mainnet');
    const uri = uriLib.encodeBip21Uri({
        scheme: descriptor.uriScheme,
        address: 'bc1q-external-2',
    });
    assert.ok(uri.startsWith('bitcoin:'), 'encoded with bitcoin scheme');
    const parts = uriLib.parseBip21Uri(uri);
    assert.equal(parts.address, 'bc1q-external-2');
    assert.equal(parts.scheme, 'bitcoin');
}

console.log(
    'OK: receive view smoke (static wiring + addresses.byChain / addresses.newest round-trips + BIP21 encode/parse)',
);
