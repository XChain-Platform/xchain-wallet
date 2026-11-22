// @vitest-environment node

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every bridge signing route unlocks the wallet's software keys with the
// typed password. A seed wallet can also hold addresses whose key lives on a
// paired device, or no key at all, so each route must refuse those addresses
// rather than sign their stored path with the seed: the signature would be a
// hot key presented under an address the user holds on the device.

import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { importMnemonic } from '../../../../packages/core/src/flows/importMnemonic.js';
import { importSingleWif } from '../../../../packages/core/src/flows/importSingleWif.js';
import { defaultRegistry } from '../../../../packages/core/src/registry/index.js';
import { adaptXChainSDK } from '../../../../packages/core/src/sdk/defaultFactory.js';
import { SDKRegistry } from '../../../../packages/core/src/sdk/SDKRegistry.js';
import { createAddress } from '../../../../packages/core/src/schemas/address.js';
import { createConnectedSite } from '../../../../packages/core/src/schemas/connectedSite.js';
import { createDefaultSettings } from '../../../../packages/core/src/schemas/settings.js';
import { createSignerRecord } from '../../../../packages/core/src/schemas/signer.js';
import { Vault } from '../../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../../packages/core/src/storage/backend.js';
import { MessageHost } from '../../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../../packages/extension/src/bridge/handlers.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');

const CHAIN_ID = 'bitcoin-regtest';
const ORIGIN = 'https://device-address.example';
const LOCAL_ORIGIN = 'http://localhost:5173';
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'device-address-password';
// A regtest WIF for private key 0x...01, a key the mnemonic above does not hold.
const WIF = 'cMahea7zqjxrtgAbB7LSGbcQUr1uX1ojuat9jZodMN87JcbXMTcA';
const KDF = {
    algorithm: 'argon2id',
    salt: Buffer.alloc(16, 41).toString('base64'),
    iterations: 1,
    memory: 8192,
    parallelism: 1,
};

const chainRegistry = defaultRegistry();
const sdkRegistry = new SDKRegistry({ chainRegistry, sdkFactory: adaptXChainSDK(XChainSDK), rateLimiter: null });
const signSpy = vi.spyOn(sdkRegistry.get(CHAIN_ID).auth, 'signMessage');

let vault;
const addr = {};

function deviceRecord(accountId, source, index, signerId) {
    return createAddress({
        accountId,
        chain: 'bitcoin',
        network: 'regtest',
        source,
        addressType: 'p2wpkh',
        derivationPath: `m/84'/1'/0'/0/${index}`,
        address: `bcrt1qheldaddress${index}`,
        publicKey: `02${String(index).repeat(64).slice(0, 64)}`,
        signerId,
    });
}

beforeAll(async () => {
    vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(43), autoSave: false });
    await vault.open();
    const seed = await importMnemonic({
        password: PASSWORD, mnemonic: MNEMONIC, vault, chainRegistry, sdkRegistry,
        activeChainIds: [CHAIN_ID], kdfParams: KDF,
    });
    const accountId = seed.account.id;
    addr.hd = seed.addresses[0].address.address;
    const wif = await importSingleWif({
        vault, password: PASSWORD, chainRegistry, sdkRegistry, chainId: CHAIN_ID, wif: WIF, kdfParams: KDF,
    });
    addr.wif = wif.address.address;
    const ledger = createSignerRecord({
        walletId: seed.wallet.id, kind: 'ledger', vendor: 'Ledger', model: 'Nano S Plus', deviceIdentifier: 'ledger-1',
    });
    await vault.signers.put(ledger);
    const trezor = deviceRecord(accountId, 'trezor', 7, null);
    const linked = deviceRecord(accountId, 'ledger', 8, ledger.id);
    const watch = createAddress({
        accountId: null, chain: 'bitcoin', network: 'regtest', source: 'watch-only', addressType: 'p2wpkh',
        derivationPath: null, address: 'bcrt1qnokeyaddress', publicKey: `03${'9'.repeat(64)}`,
    });
    for (const rec of [trezor, linked, watch]) await vault.addresses.put(rec);
    addr.trezor = trezor.address;
    addr.ledger = linked.address;
    addr.watch = watch.address;
    for (const origin of [ORIGIN, LOCAL_ORIGIN]) {
        await vault.connectedSites.put(createConnectedSite({
            origin,
            appName: 'Device address test',
            permissions: { chains: [CHAIN_ID], accounts: [], canSignMessage: true, canSignAction: {} },
        }));
    }
    const settings = {
        ...createDefaultSettings(), activeNetwork: 'regtest', blockedOrigins: [],
        developerMode: true, autoSignLocalhostMs: 60_000,
    };
    vault.settings.get = async () => settings;
});

afterAll(async () => {
    await vault?.close();
});

function hostWith(approvals) {
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry });
    registerBridgeHandlers(host, { approvals, signThrottle: { check: () => ({ allowed: true }) } });
    return host;
}

const approve = (extra = {}) => vi.fn(async () => ({ approved: true, password: PASSWORD, ...extra }));

function expectRefused(response) {
    expect(response.ok).toBe(false);
    expect(response.error.message).toContain('ADDRESS_NOT_SIGNABLE');
    expect(response.error.code).toBe('ADDRESS_NOT_AUTHORIZED');
    // The page is never told where the key lives.
    expect(response.error.message).not.toMatch(/trezor|ledger|watch-only/i);
}

function signMessage(host, address, origin = ORIGIN) {
    return host.handle({
        type: 'bridge.signMessage',
        request: { origin, chainId: CHAIN_ID, address, message: 'device address check' },
    });
}

describe('bridge.signMessage refuses an address the software key does not hold', () => {
    it.each(['trezor', 'ledger', 'watch'])('refuses a %s address and computes no signature', async (kind) => {
        signSpy.mockClear();
        const host = hostWith({ signMessage: approve() });
        expectRefused(await signMessage(host, addr[kind]));
        expect(signSpy).not.toHaveBeenCalled();
    });

    it('still signs for the seed address and the imported key in the same vault', async () => {
        const host = hostWith({ signMessage: approve() });
        for (const address of [addr.hd, addr.wif]) {
            const response = await signMessage(host, address);
            expect(response).toMatchObject({ ok: true, result: { ok: true, signature: expect.any(String) } });
        }
    });

    it('signs a stored record that predates the source tag as a software key', async () => {
        const list = vault.addresses.list.bind(vault.addresses);
        vault.addresses.list = async () => (await list()).map((a) => (
            a.address === addr.hd ? { ...a, source: undefined } : a
        ));
        try {
            const response = await signMessage(hostWith({ signMessage: approve() }), addr.hd);
            expect(response).toMatchObject({ ok: true, result: { ok: true } });
        } finally {
            vault.addresses.list = list;
        }
    });

    it('refuses on the localhost auto-sign path without a prompt', async () => {
        const prompt = approve();
        const host = hostWith({ signMessage: prompt });
        expect((await signMessage(host, addr.hd, LOCAL_ORIGIN)).ok).toBe(true);
        expect(prompt).toHaveBeenCalledTimes(1);
        signSpy.mockClear();
        expectRefused(await signMessage(host, addr.trezor, LOCAL_ORIGIN));
        expect(prompt).toHaveBeenCalledTimes(1);
        expect(signSpy).not.toHaveBeenCalled();
    });
});

describe('the other bridge signing routes refuse device and watch-only addresses', () => {
    it.each(['trezor', 'ledger', 'watch'])('bridge.signIn refuses a chosen %s address', async (kind) => {
        signSpy.mockClear();
        const host = hostWith({ signIn: approve({ address: addr[kind], chainId: CHAIN_ID }) });
        const response = await host.handle({
            type: 'bridge.signIn',
            request: { origin: ORIGIN, appId: 'device-address-test', chainId: CHAIN_ID, nonce: `n-${kind}` },
        });
        expectRefused(response);
        expect(signSpy).not.toHaveBeenCalled();
    });

    it.each([
        ['a device input alone', () => [{ inputIndex: 0, address: addr.trezor }]],
        ['a seed input beside a device input', () => [
            { inputIndex: 0, address: addr.hd },
            { inputIndex: 1, address: addr.ledger },
        ]],
    ])('bridge.signPsbt refuses %s before any signing', async (_label, paths) => {
        const host = hostWith({ signPsbt: approve() });
        const response = await host.handle({
            type: 'bridge.signPsbt',
            request: { origin: ORIGIN, chainId: CHAIN_ID, psbtHex: '70736274ff', signingPaths: paths() },
        });
        expectRefused(response);
    });

    it.each(['trezor', 'ledger', 'watch'])('bridge.signAction SEND refuses spending from a %s address', async (kind) => {
        const host = hostWith({ signAction: approve() });
        const response = await host.handle({
            type: 'bridge.signAction',
            request: {
                origin: ORIGIN,
                chainId: CHAIN_ID,
                action: 'SEND',
                params: { fromAddress: addr[kind], toAddress: addr.hd, asset: 'BTC', amount: '0.0001' },
            },
        });
        expectRefused(response);
    });
});
