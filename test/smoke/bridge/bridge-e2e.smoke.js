// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke test for Batch 3 piece 10 (end-to-end bridge).
//
// Simulates the full Phase-1 bridge stack: dApp request -> content
// script relay -> background MessageHost -> ApprovalBroker -> popup
// resolve, against a real Vault + real broker + real MessageHost.
//
// The unit-tested layers (inject, content, adapter) are pure relays
// with no business logic, so the integration exercise here skips
// those plumbing steps and dispatches bridge messages directly to the
// host. Every other layer is the real one: real `registerBridgeHandlers`,
// real ApprovalBroker (with fake chrome.windows), real flows module,
// real vault-persisted ConnectedSite records.
//
// Coverage:
//   - bridge.connect  → approval parked → resolve → ConnectedSite written
//   - bridge.getAccounts / getAddresses / getSupportedChains
//   - bridge.signAction with an unsupported kind (ISSUE) →
//     structured { error: 'UNSUPPORTED_ACTION', ... } (no approval popup)
//   - bridge.connect on the same origin again → idempotent, returns
//     existing permissions, no new approval
//   - bridge.disconnect → site removed
//
// Sign paths that require real crypto/SDK (signMessage, signPsbt,
// signAction SEND) are exercised in the smoke up to the approval
// hand-off; going further needs real SDK wiring which lands in a
// later piece.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readDoc, skipUnlessDocs } from '../_docs-repo.js';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    registry as registryLib,
    schemas,
    sdk as sdkLib,
    storage as storageLib,
} from '../../../packages/core/src/index.js';
import { ApprovalBroker } from '../../../packages/extension/src/background/approvalBroker.js';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. Runbook exists ------------------------------------------------

// a later change moved the runbook to the sibling xchain-documentation checkout.
skipUnlessDocs('bridge-e2e smoke');
const runbook = readDoc('release', 'extension', 'test-dapp-runbook.md');
// Phrases, not filenames: the port reworded the runbook's worked example
// (the old `runExample` / `ISSUE` literals are gone), so these pin the
// stages an operator has to actually click through.
for (const section of [
    'test-dapp',
    'example flow',
    'connect',
    'signMessage',
    'signAction',
]) {
    assert.ok(
        runbook.toLowerCase().includes(section.toLowerCase()),
        `runbook mentions "${section}"`,
    );
}

// --- 2. Fake chrome.windows ------------------------------------------

function makeFakeWindows() {
    let nextId = 700;
    const open = [];
    const removedListeners = [];
    return {
        _opened: () => open.slice(),
        surface: {
            async create(options) {
                const id = nextId++;
                open.push({ id, options });
                return { id };
            },
            async remove(id) {
                const i = open.findIndex((w) => w.id === id);
                if (i >= 0) open.splice(i, 1);
            },
            onRemoved: {
                addListener(fn) { removedListeners.push(fn); },
                removeListener(fn) {
                    const i = removedListeners.indexOf(fn);
                    if (i >= 0) removedListeners.splice(i, 1);
                },
            },
        },
    };
}

// --- 3. Build the whole stack ----------------------------------------

async function buildStack() {
    // Vault with a stub-encrypted wallet + one account + one regtest BTC
    // address. Nothing touches the encryptedSeed in this smoke (no
    // signing); the address is what the bridge reads out of the vault.
    const masterKey = new Uint8Array(32);
    crypto.getRandomValues(masterKey);
    const vault = new storageLib.Vault({
        backend: new storageLib.InMemoryBackend(),
        masterKey,
    });
    await vault.open();

    const wallet = schemas.createWallet({
        name: 'Test',
        origin: 'created',
        format: 'bip39',
        passphraseEnabled: false,
        encryptedSeed: 'c3R1Yg==',
        kdfParams: {
            algorithm: 'argon2id',
            salt: Buffer.alloc(16, 7).toString('base64'),
            iterations: 3,
            memory: 64 * 1024,
            parallelism: 1,
        },
    });
    await vault.wallets.put(wallet);

    const account = schemas.createAccount({
        walletId: wallet.id,
        name: 'Main',
        index: 0,
    });
    await vault.accounts.put(account);

    const address = schemas.createAddress({
        accountId: account.id,
        chain: 'bitcoin',
        network: 'regtest',
        source: 'hd',
        addressType: 'p2wpkh',
        derivationPath: "m/84'/1'/0'/0/0",
        address: 'bcrt1qtestaddr00000000000000000000000000000000',
        publicKey: 'pk-test',
        label: 'Test #1',
    });
    await vault.addresses.put(address);

    const chainRegistry = registryLib.defaultRegistry();
    const sdkRegistry = new sdkLib.SDKRegistry({
        chainRegistry,
        sdkFactory: () => ({ wallet: {}, auth: {} }),
    });

    const fw = makeFakeWindows();
    const broker = new ApprovalBroker({
        newId: (() => {
            let counter = 0;
            return () => `req-${++counter}`;
        })(),
        getUrl: (p) => `ext://${p}`,
        windows: fw.surface,
    });

    const host = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry,
        approvals: broker,
        // Stand in for chrome.runtime.getURL so getSupportedChains can
        // resolve chain-icon filenames to extension-origin URLs.
        getAssetUrl: (p) => `chrome-extension://testext/${p}`,
    });

    return { host, vault, broker, fakeWindows: fw, wallet, account, address };
}

async function call(host, type, request) {
    const resp = await host.handle({ type, request });
    if (!resp.ok) {
        throw Object.assign(new Error(resp.error.message), {
            name: resp.error.name,
        });
    }
    return resp.result;
}

async function autoApprove(host, fakeWindows, result) {
    // Give the bridge handler a couple of microtask ticks to call
    // approvals.connect / signMessage / etc., which in turn calls
    // chrome.windows.create via the broker.
    for (let i = 0; i < 5; i += 1) {
        await new Promise((r) => setImmediate(r));
    }
    const opened = fakeWindows._opened();
    const last = opened[opened.length - 1];
    if (!last) throw new Error('autoApprove: no approval window opened');
    const url = new URL(last.options.url);
    const id = url.searchParams.get('id');
    if (!id) throw new Error('autoApprove: approval URL missing id');
    await call(host, 'approval.resolve', { id, result });
}

// --- 4. bridge.connect round-trip -----------------------------------

{
    const { host, vault, fakeWindows, account, address } = await buildStack();
    const connectPromise = call(host, 'bridge.connect', {
        origin: 'https://dapp.example',
        appName: 'Example DApp',
        chains: ['bitcoin-regtest'],
    });
    await autoApprove(host, fakeWindows, {
        approved: true,
        chains: ['bitcoin-regtest'],
        accounts: [account.id],
        canSignMessage: false,
        canSignAction: {},
    });
    const conn = await connectPromise;
    // The bridge-spec ConnectSuccess envelope: an `ok` flag,
    // Account RECORDS under `accounts`, and the granted SitePermissions.
    assert.equal(conn.ok, true, 'connect answers the ConnectSuccess envelope');
    assert.equal(conn.chains[0], 'bitcoin-regtest');
    assert.deepEqual(conn.accounts, [{ id: account.id, name: account.name }]);
    assert.deepEqual(conn.permissions.accounts, [account.id]);
    assert.equal(conn.permissions.canSignMessage, false);

    const sites = await vault.connectedSites.list();
    assert.equal(sites.length, 1);
    assert.equal(sites[0].origin, 'https://dapp.example');
    assert.equal(sites[0].permissions.chains[0], 'bitcoin-regtest');

    // 4a. Second connect on the same origin is idempotent; no approval
    //     window opens, response reflects existing permissions.
    const secondConn = await call(host, 'bridge.connect', {
        origin: 'https://dapp.example',
        appName: 'Example DApp',
    });
    assert.deepEqual(secondConn.chains, ['bitcoin-regtest']);
    assert.equal(
        fakeWindows._opened().length,
        0,
        'second connect opens no new approval window',
    );

    // 4b. getAccounts + getAddresses + getSupportedChains.
    const accounts = await call(host, 'bridge.getAccounts', {
        origin: 'https://dapp.example',
    });
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].id, account.id);

    const addrs = await call(host, 'bridge.getAddresses', {
        origin: 'https://dapp.example',
        chainId: 'bitcoin-regtest',
    });
    assert.equal(addrs.length, 1);
    assert.equal(addrs[0].address, address.address);

    const chains = await call(host, 'bridge.getSupportedChains', {
        origin: 'https://dapp.example',
    });
    assert.equal(chains.length, 9, 'registry exposes all 9 chains');
    assert.ok(
        chains.every(
            (d) => typeof d.icon === 'string'
                && d.icon.startsWith('chrome-extension://testext/chain-icons/')
                && d.icon.endsWith('-icon-20.png'),
        ),
        'bridge.getSupportedChains resolves icons to web-accessible extension URLs',
    );
    const btc = chains.find((d) => d.id === 'bitcoin-mainnet');
    assert.equal(
        btc.icon,
        'chrome-extension://testext/chain-icons/bitcoin-mainnet-icon-20.png',
        'bitcoin-mainnet icon resolves to its chain-icons path',
    );

    // 4c. signAction ISSUE → structured UNSUPPORTED_ACTION, no approval.
    const issueResp = await call(host, 'bridge.signAction', {
        origin: 'https://dapp.example',
        chainId: 'bitcoin-regtest',
        action: 'ISSUE',
        params: { tick: 'NEWCOIN', quantity: '1000000' },
    });
    // bridge-spec's UnsupportedActionResult: an `ok: false` envelope carrying
    // the wallet's current action list.
    assert.equal(issueResp.ok, false);
    assert.equal(issueResp.error, 'UNSUPPORTED_ACTION');
    assert.deepEqual(issueResp.supportedActions, ['SEND', 'SWEEP']);
    assert.equal(
        fakeWindows._opened().length,
        0,
        'UNSUPPORTED_ACTION did not open an approval window',
    );

    // 4c-scope (BRIDGE-2). The site was granted only `account.id`. A
    // signAction whose `from` belongs to a DIFFERENT (ungranted) account
    // must be rejected up front with ADDRESS_NOT_PERMITTED, before any
    // approval window opens: per-account scope is enforced, not just chain.
    const otherAccount = schemas.createAccount({
        walletId: account.walletId,
        name: 'Other',
        index: 1,
    });
    await vault.accounts.put(otherAccount);
    const otherAddress = schemas.createAddress({
        accountId: otherAccount.id,
        chain: 'bitcoin',
        network: 'regtest',
        source: 'hd',
        addressType: 'p2wpkh',
        derivationPath: "m/84'/1'/1'/0/0",
        address: 'bcrt1qOTHERaddr0000000000000000000000000000000',
        publicKey: 'pk-other',
        label: 'Other #1',
    });
    await vault.addresses.put(otherAddress);

    let scopeErr = null;
    try {
        await call(host, 'bridge.signAction', {
            origin: 'https://dapp.example',
            chainId: 'bitcoin-regtest',
            action: 'SEND',
            params: { from: otherAddress.address, to: 'bcrt1qdest', amount: '1', tick: 'BTC' },
        });
    } catch (e) {
        scopeErr = e;
    }
    assert.ok(scopeErr, 'out-of-scope signAction is rejected');
    assert.match(scopeErr.message, /ADDRESS_NOT_PERMITTED/, 'rejects with ADDRESS_NOT_PERMITTED');
    assert.equal(
        fakeWindows._opened().length,
        0,
        'out-of-scope signAction opened no approval window',
    );

    // 4d. disconnect.
    const disc = await call(host, 'bridge.disconnect', {
        origin: 'https://dapp.example',
    });
    assert.deepEqual(disc, { disconnected: true });
    assert.equal((await vault.connectedSites.list()).length, 0);
}

// --- 5. Reject path (user closes the approval window) ---------------

{
    const { host, fakeWindows, broker } = await buildStack();
    const connectPromise = call(host, 'bridge.connect', {
        origin: 'https://reject.example',
        appName: 'Reject DApp',
        chains: ['bitcoin-regtest'],
    });
    // Wait for broker to park the request + open the window.
    for (let i = 0; i < 5; i += 1) {
        await new Promise((r) => setImmediate(r));
    }
    const opened = fakeWindows._opened();
    const winId = opened[opened.length - 1].id;
    // Simulate the user closing the window without deciding.
    for (const fn of fakeWindows.surface.onRemoved
        ? [] // onRemoved.addListener already captured by broker
        : []) fn(winId);
    // Broker installed its listener during construction; invoke it by
    // using the internal _onWindowRemoved (equivalent to chrome firing
    // the onRemoved event on the window).
    broker._onWindowRemoved(winId);

    let thrown = null;
    try {
        await connectPromise;
    } catch (err) {
        thrown = err;
    }
    assert.ok(thrown, 'close-without-decision throws');
    assert.equal(thrown.name, 'UserRejectedError');
}

// --- 6. Test-dapp source surface is consumable ------------------------

{
    // The runExample + MockXChainProvider are TypeScript source; we
    // can't import them directly in Node, but verify the files exist
    // and expose the expected top-level symbols so the runbook isn't
    // pointing at code that has drifted away.
    const idx = readFileSync(
        join(wsRoot, 'packages', 'test-dapp', 'src', 'index.ts'),
        'utf8',
    );
    assert.ok(idx.includes('MockXChainProvider'));
    assert.ok(idx.includes('runExample'));
    const example = readFileSync(
        join(wsRoot, 'packages', 'test-dapp', 'src', 'example.ts'),
        'utf8',
    );
    assert.ok(
        /provider\.connect\(/.test(example),
        'runExample calls provider.connect',
    );
    assert.ok(
        /provider\.signMessage\(/.test(example),
        'runExample calls provider.signMessage',
    );
    assert.ok(
        /provider\.signAction\(/.test(example),
        'runExample calls provider.signAction',
    );
    assert.ok(
        /'UNSUPPORTED_ACTION'/.test(example),
        'runExample asserts UNSUPPORTED_ACTION for ISSUE',
    );
}

// --- 7.: switching the active network seeds per-chain fees -----

{
    // Regression for. `settings.setActiveNetwork` used to flip
    // activeNetwork + derive addresses but NEVER seed settings.fees for the
    // target network's chains, so on regtest the fee-derived active-chain set
    // (Object.keys(settings.fees) filtered by activeNetwork) was empty, and
    // useReachability -> reachability.check mapped empty -> 'offline', showing
    // a false "You're offline" that suppressed the confirm pre-flight. This is
    // the extension's ONLY path to regtest (no Settings UI), so it bit
    // every second popup. Assert the host route now seeds the network's chains.
    const { host, vault, wallet } = await buildStack();

    const { settings } = await call(host, 'settings.setActiveNetwork', {
        network: 'regtest',
        walletId: wallet.id,
    });

    const regtestChains = ['bitcoin-regtest', 'litecoin-regtest', 'dogecoin-regtest'];
    for (const chainId of regtestChains) {
        assert.ok(
            settings.fees && settings.fees[chainId],
            `settings.setActiveNetwork must seed settings.fees[${chainId}]`,
        );
    }

    // Persisted, not just returned: a second popup reads the vault snapshot.
    const persisted = await vault.settings.get();
    for (const chainId of regtestChains) {
        assert.ok(
            persisted.fees && persisted.fees[chainId],
            `seeded fees[${chainId}] must be persisted to the vault`,
        );
    }
    assert.equal(persisted.activeNetwork, 'regtest');
}

console.log(
    'OK: bridge e2e smoke (connect/resolve round-trip, idempotent reconnect, reads, UNSUPPORTED_ACTION, disconnect, window-close reject, test-dapp surface intact, runbook published, setActiveNetwork seeds per-chain fees )',
);
