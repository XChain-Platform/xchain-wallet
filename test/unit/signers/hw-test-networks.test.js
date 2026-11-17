/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Node environment: the real SDK's ecpair self-test rejects jsdom's Buffer
// realm (as in ScopedPaySignerRealSdk.test.js).
//
// Unit: hardware signers on every network (operator rulings 2026-11-15:
// mainnet and the test networks wherever the device can sign them, and a
// hardware wallet uses each device's OWN native test derivation, coin type 1').
//
// The proof is address-level, not path-level. One fixed seed feeds a fake
// device that derives from it and encodes addresses with the VENDOR's coin
// parameters, transcribed below from the vendor sources. Each expected address
// is computed independently: the seed's key at the expected path, encoded by
// the SDK's WalletUtils for that chain, which is what the wallet and the
// backend watch. Mainnet expectations come from the real SoftwareSigner, whose
// addresses a mainnet hardware account must keep equalling.
//
// The fakes behave like the vendors where it matters:
//   - Trezor Connect refuses a path whose coin type is not the coin's slip44
//     ("Parameters path and coin do not match") on every method, and the
//     firmware runs Strict safety checks by default. No call may carry an
//     unsafe-path flag.
//   - A Ledger answers according to the app that is OPEN, not the client's
//     currency. The Bitcoin Test app is OS-restricted to coin type 1' and
//     writes Bitcoin testnet addresses (tb1, m/n, 2) on testnet and regtest
//     alike, so a regtest bcrt1 address only appears if the signer rewrites it.
//
// Nothing here reaches a device, Connect, an emulator or any network.

import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';
import bitcoin from 'bitcoinjs-lib';
import { mnemonicToSeedSync } from '@scure/bip39';
import { SoftwareSigner } from '../../../packages/core/src/signers/SoftwareSigner.js';
import { assertInputSignaturesVerify } from '../../../packages/core/src/signers/verifyInputSignatures.js';
import { defaultRegistry, ChainRegistry } from '../../../packages/core/src/registry/index.js';
import { derive, hdKeyFromSeed } from '../../../packages/core/src/crypto/hd.js';
import { InMemoryBackend, Vault } from '../../../packages/core/src/storage/index.js';
import { addHardwareWallet } from '../../../packages/core/src/flows/hardwareWallet.js';
import { createAccount } from '../../../packages/core/src/flows/createAccount.js';
import { TrezorSigner } from '../../../packages/signers-trezor/src/TrezorSigner.js';
import {
    CHAIN_ID_TO_TREZOR_COIN,
    TREZOR_NETWORK_SUPPORT,
    pathToAddressN,
} from '../../../packages/signers-trezor/src/trezorFormat.js';
import {
    LedgerSigner, LEDGER_APP_NAME_FOR_CHAIN, regtestAddressFromTestApp,
} from '../../../packages/signers-ledger/src/LedgerSigner.js';
import { LEDGER_NETWORK_SUPPORT } from '../../../packages/signers-ledger/src/ledgerFormat.js';
import { decomposedFor, signedReplyFor } from '../../helpers/hwSignedReply.js';
import { MockHardwareSigner } from './MockHardwareSigner.js';

const require = createRequire(import.meta.url);
const { WalletUtils } = require('xchain-sdk');

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SEED = mnemonicToSeedSync(MNEMONIC);
const ROOT = hdKeyFromSeed(SEED);
const REGISTRY = defaultRegistry();

const ALL_CHAIN_IDS = ['bitcoin', 'litecoin', 'dogecoin']
    .flatMap((family) => ['mainnet', 'testnet', 'regtest'].map((kind) => `${family}-${kind}`));
const DERIVABLE = ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh'];
const PURPOSE = { p2pkh: 44, 'p2sh-p2wpkh': 49, p2wpkh: 84 };
const isMainnet = (chainId) => chainId.endsWith('-mainnet');

// Trezor coin parameters, from trezor-firmware common/defs/bitcoin/*.json
// (address_type, address_type_p2sh, bech32_prefix, slip44), read 2026-11-15.
const TREZOR_COIN_DEFS = {
    btc: { slip44: 0, p2pkh: 0, p2sh: 5, bech32: 'bc' }, // bitcoin.json
    test: { slip44: 1, p2pkh: 111, p2sh: 196, bech32: 'tb' }, // bitcoin_testnet.json
    regtest: { slip44: 1, p2pkh: 111, p2sh: 196, bech32: 'bcrt' }, // bitcoin_regtest.json
    ltc: { slip44: 2, p2pkh: 48, p2sh: 50, bech32: 'ltc' }, // litecoin.json
    tltc: { slip44: 1, p2pkh: 111, p2sh: 58, bech32: 'tltc' }, // litecoin_testnet.json
    doge: { slip44: 3, p2pkh: 30, p2sh: 22, bech32: null }, // dogecoin.json
};

// Ledger app parameters, from LedgerHQ/app-bitcoin-new and
// LedgerHQ/app-bitcoin-legacy Makefiles (COIN_P2PKH_VERSION,
// COIN_P2SH_VERSION, COIN_NATIVE_SEGWIT_PREFIX, PATH_APP_LOAD_PARAMS), read
// 2026-11-15. `coinType` is the app's path restriction where the Makefile
// states one the wallet relies on; the Bitcoin app's is not modelled, so the
// signer's own guard is what keeps a test network out of it.
const LEDGER_APPS = {
    Bitcoin: { coinType: null, p2pkh: 0, p2sh: 5, bech32: 'bc' },
    'Bitcoin Test': { coinType: 1, p2pkh: 111, p2sh: 196, bech32: 'tb' },
    Litecoin: { coinType: 2, p2pkh: 48, p2sh: 50, bech32: 'ltc' },
    Dogecoin: { coinType: 3, p2pkh: 30, p2sh: 22, bech32: null },
};

function sdkRegistry() {
    const cache = new Map();
    return {
        get(chainId) {
            if (!cache.has(chainId)) cache.set(chainId, { wallet: new WalletUtils(chainId) });
            return cache.get(chainId);
        },
    };
}
const SDK = sdkRegistry();

function softwareSigner() {
    const signer = new SoftwareSigner({
        id: 'sw-parity',
        displayName: 'Software',
        chainRegistry: REGISTRY,
        walletEncryption: {},
        sdkRegistry: sdkRegistry(),
    });
    signer._acceptUnlockedState({ mnemonicBytes: new Uint8Array(0), seed: SEED, importedWifs: new Map() });
    return signer;
}

/** The path a hardware signer derives at: mainnet as the registry, test networks at 1'. */
function hardwarePath(chainId, addressType, accountIndex, change, index) {
    const parts = REGISTRY.derivationPathFor(chainId, addressType, accountIndex, change, index).split('/');
    if (!isMainnet(chainId)) parts[2] = "1'";
    return parts.join('/');
}

/** What the wallet and backend watch for the seed's key at `path`: the SDK's encoding. */
function sdkAddress(chainId, path, addressType) {
    return SDK.get(chainId).wallet.deriveAddress(derive(ROOT, path).publicKeyHex, { type: addressType });
}

/** Encode a pubkey the way a device with these version bytes would. */
function encodeAddress(pubkeyHex, purpose, params) {
    const network = {
        messagePrefix: '', bech32: params.bech32 ?? 'none', bip32: { public: 0, private: 0 },
        pubKeyHash: params.p2pkh, scriptHash: params.p2sh, wif: 0,
    };
    const pubkey = Buffer.from(pubkeyHex, 'hex');
    if (purpose === 44) return bitcoin.payments.p2pkh({ pubkey, network }).address;
    if (purpose === 84) return bitcoin.payments.p2wpkh({ pubkey, network }).address;
    if (purpose === 49) {
        return bitcoin.payments.p2sh({ redeem: bitcoin.payments.p2wpkh({ pubkey, network }), network }).address;
    }
    throw new Error(`fake device: no encoder for purpose ${purpose}`);
}

const fail = (error, code = 'Method_InvalidParameter') => ({ success: false, payload: { error, code } });

// Coins whose previous transactions Trezor's own backend cannot supply here.
const NO_TREZOR_BACKEND = new Set(['regtest', 'tltc']);

/**
 * A Trezor Connect stand-in that derives from SEED and enforces Connect's
 * coin-path check (no escape) and the firmware's strict safety checks.
 */
function fakeTrezorConnect({ strictSafetyChecks = true, signTransaction } = {}) {
    const unsafeFlags = [];
    const guard = (params) => {
        if ('crossChain' in params) unsafeFlags.push(params);
        const def = TREZOR_COIN_DEFS[params.coin];
        if (!def) return fail(`Coin ${params.coin} not found`);
        const slip = pathToAddressN(params.path)[1] & 0x7fffffff;
        if (slip !== def.slip44) return fail('Parameters "path" and "coin" do not match.');
        return null;
    };
    const addressItem = (params) => {
        const refused = guard(params);
        if (refused) return { refused };
        const n = pathToAddressN(params.path);
        const dk = derive(ROOT, params.path);
        return { item: { path: n, address: encodeAddress(dk.publicKeyHex, n[0] & 0x7fffffff, TREZOR_COIN_DEFS[params.coin]) } };
    };
    const keyItem = (params) => {
        const refused = guard(params);
        if (refused) return { refused };
        const dk = derive(ROOT, params.path);
        return { item: { path: pathToAddressN(params.path), publicKey: dk.publicKeyHex, chainCode: Buffer.from(dk.chainCode).toString('hex'), fingerprint: 0 } };
    };
    const answer = (fn) => vi.fn(async (params) => {
        const items = params.bundle ?? [params];
        const results = items.map(fn);
        const refused = results.find((r) => r.refused);
        if (refused) return refused.refused;
        return { success: true, payload: params.bundle ? results.map((r) => r.item) : results[0].item };
    });
    return {
        unsafeFlags,
        getFeatures: vi.fn(async () => ({ success: true, payload: { device_id: 'DEV-1' } })),
        getAddress: answer(addressItem),
        getPublicKey: answer(keyItem),
        signMessage: vi.fn(async (params) => guard(params)
            ?? { success: true, payload: { signature: 'c2lnbmF0dXJl' } }),
        signTransaction: vi.fn(async (payload) => {
            if ('crossChain' in payload) unsafeFlags.push(payload);
            for (const input of payload.inputs) {
                const def = TREZOR_COIN_DEFS[payload.coin];
                if (!def) return fail(`Coin ${payload.coin} not found`);
                const slip = input.address_n[1] & 0x7fffffff;
                if (slip !== def.slip44 && strictSafetyChecks) return fail('Forbidden key path', 'Failure_DataError');
            }
            // Connect 9: a given refTxs list is used as is, and the device asks
            // for every input's previous transaction; with none given, Connect
            // fetches from Trezor's backend, which cannot reach the team regtest
            // rail and has none for Litecoin testnet.
            const prevIds = [...new Set(payload.inputs.map((i) => i.prev_hash))];
            if (payload.refTxs) {
                const missing = prevIds.find((h) => !payload.refTxs.some((tx) => tx.hash === h));
                if (missing) return fail(`refTx ${missing} not provided`);
            } else if (NO_TREZOR_BACKEND.has(payload.coin)) {
                return fail(`Backend for ${payload.coin} cannot see transaction ${prevIds[0]}`);
            }
            return signTransaction(payload);
        }),
    };
}

function trezor(connect, registry = sdkRegistry()) {
    return new TrezorSigner({
        id: 'trezor-net', displayName: 'Trezor', model: 'T3T1', deviceIdentifier: 'DEV-1', connect, sdkRegistry: registry,
    });
}

/** GET_APP_AND_VERSION answer bytes for an app name and version. */
function appInfoBytes(name, version = '2.2.1') {
    const enc = (s) => [...new TextEncoder().encode(s)];
    return Uint8Array.from([1, name.length, ...enc(name), version.length, ...enc(version), 1, 0, 0x90, 0x00]);
}

/** A Ledger whose answers come from the app that is open on it. */
function fakeLedger(openApp = 'Bitcoin', { registry = sdkRegistry(), createPaymentTransaction } = {}) {
    const params = LEDGER_APPS[openApp];
    const getApp = vi.fn(() => ({
        getWalletPublicKey: vi.fn(async (path) => {
            const n = pathToAddressN(path);
            if (params.coinType !== null && (n[1] & 0x7fffffff) !== params.coinType) {
                throw Object.assign(new Error('Ledger device: Invalid data received (0x6a80)'), { statusCode: 0x6a80 });
            }
            const dk = derive(ROOT, path);
            return { publicKey: dk.publicKeyHex, bitcoinAddress: encodeAddress(dk.publicKeyHex, n[0] & 0x7fffffff, params), chainCode: '' };
        }),
        createPaymentTransaction: createPaymentTransaction ?? vi.fn(),
        splitTransaction: vi.fn(() => ({ split: true })),
        signMessage: vi.fn(async () => ({ v: 0, r: '11'.repeat(32), s: '22'.repeat(32) })),
    }));
    const transport = { send: vi.fn().mockResolvedValue(appInfoBytes(openApp)) };
    const signer = new LedgerSigner({
        id: 'ledger-net', displayName: 'Ledger', model: 'nanoX', deviceIdentifier: 'abcdef01', getApp, transport, sdkRegistry: registry,
    });
    return { signer, getApp, transport };
}

/** Each (chainId, addressType) pair a vendor's support map offers, from the descriptors. */
function pairsFor(chainIds) {
    return chainIds.flatMap((chainId) => REGISTRY.get(chainId).addressTypes
        .filter((type) => DERIVABLE.includes(type))
        .map((type) => [chainId, type]));
}

const TUPLE = { accountIndex: 0, change: 0, startIndex: 0 };
const TREZOR_CHAINS = Object.keys(CHAIN_ID_TO_TREZOR_COIN);
const LEDGER_CHAINS = Object.keys(LEDGER_APP_NAME_FOR_CHAIN);

describe('vendor parameters against the SDK', () => {
    // The one known encoding gap, pinned so a firmware or SDK change shows up here.
    it('Trezor Litecoin Testnet writes P2SH at version 58 where the SDK writes 0xc4', () => {
        const path = hardwarePath('litecoin-testnet', 'p2sh-p2wpkh', 0, 0, 0);
        const device = encodeAddress(derive(ROOT, path).publicKeyHex, 49, TREZOR_COIN_DEFS.tltc);
        const sdk = sdkAddress('litecoin-testnet', path, 'p2sh-p2wpkh');
        expect(device.startsWith('Q')).toBe(true);
        expect(sdk.startsWith('2')).toBe(true);
    });

    it('every other Trezor test coin encodes exactly as the SDK does for its chain', () => {
        for (const [chainId, addressType] of pairsFor(TREZOR_CHAINS.filter((id) => !isMainnet(id)))) {
            if (chainId === 'litecoin-testnet' && addressType === 'p2sh-p2wpkh') continue;
            const path = hardwarePath(chainId, addressType, 0, 0, 0);
            const device = encodeAddress(derive(ROOT, path).publicKeyHex, PURPOSE[addressType], TREZOR_COIN_DEFS[CHAIN_ID_TO_TREZOR_COIN[chainId]]);
            expect([chainId, addressType, device]).toEqual([chainId, addressType, sdkAddress(chainId, path, addressType)]);
        }
    });

    it('the Bitcoin Test app writes regtest addresses with testnet parameters, so segwit needs the bcrt prefix', () => {
        const path = hardwarePath('bitcoin-regtest', 'p2wpkh', 0, 0, 0);
        const device = encodeAddress(derive(ROOT, path).publicKeyHex, 84, LEDGER_APPS['Bitcoin Test']);
        expect(device.startsWith('tb1')).toBe(true);
        expect(regtestAddressFromTestApp(device)).toBe(sdkAddress('bitcoin-regtest', path, 'p2wpkh'));
        // Base58 forms already match: regtest shares testnet's version bytes.
        for (const type of ['p2pkh', 'p2sh-p2wpkh']) {
            const p = hardwarePath('bitcoin-regtest', type, 0, 0, 0);
            const legacy = encodeAddress(derive(ROOT, p).publicKeyHex, PURPOSE[type], LEDGER_APPS['Bitcoin Test']);
            expect(regtestAddressFromTestApp(legacy)).toBe(legacy);
            expect(legacy).toBe(sdkAddress('bitcoin-regtest', p, type));
        }
    });
});

describe('Trezor mainnet: address parity with the software signer, unchanged', () => {
    // Count 1 and count 3 take different code paths (single call vs bundle).
    for (const [chainId, addressType] of pairsFor(TREZOR_CHAINS.filter(isMainnet))) {
        for (const count of [1, 3]) {
            it(`${chainId} ${addressType}: path, address and key equal the software signer's (count ${count})`, async () => {
                const hw = await trezor(fakeTrezorConnect()).getAddresses({ chainId, addressType, ...TUPLE, count });
                const sw = await softwareSigner().getAddresses({ chainId, addressType, ...TUPLE, count });
                expect(hw.map((r) => r.path)).toEqual(sw.map((r) => r.path));
                expect(hw.map((r) => r.address)).toEqual(sw.map((r) => r.address));
                expect(hw.map((r) => r.publicKey)).toEqual(sw.map((r) => r.publicKey));
            });
        }
    }

    it('sends mainnet calls exactly as before: coin and path, no other key', async () => {
        const connect = fakeTrezorConnect();
        await trezor(connect).getAddresses({ chainId: 'bitcoin-mainnet', addressType: 'p2wpkh', ...TUPLE, count: 1 });
        expect(connect.getAddress.mock.calls[0][0]).toEqual({ path: "m/84'/0'/0'/0/0", coin: 'btc', showOnTrezor: false });
        expect(connect.getPublicKey.mock.calls[0][0]).toEqual({ path: "m/84'/0'/0'/0/0", coin: 'btc' });
    });
});

describe('Trezor test networks: the device\'s own native 1\' derivation', () => {
    const pairs = pairsFor(TREZOR_CHAINS.filter((id) => !isMainnet(id)));

    it('covers every test network Trezor supports', () => {
        expect([...new Set(pairs.map(([c]) => c))].sort()).toEqual(['bitcoin-regtest', 'bitcoin-testnet', 'litecoin-testnet']);
    });

    for (const [chainId, addressType] of pairs) {
        if (chainId === 'litecoin-testnet' && addressType === 'p2sh-p2wpkh') {
            it(`refuses ${chainId} ${addressType}, whose device encoding differs`, async () => {
                const connect = fakeTrezorConnect();
                await expect(trezor(connect).getAddresses({ chainId, addressType, ...TUPLE, count: 1 }))
                    .rejects.toMatchObject({ code: 'HW_ADDRESS_FORMAT_UNSUPPORTED' });
                expect(connect.getAddress).not.toHaveBeenCalled();
            });
            continue;
        }
        for (const count of [1, 3]) {
            it(`${chainId} ${addressType}: the device address at the 1' path is the SDK's encoding (count ${count}, strict safety checks)`, async () => {
                const connect = fakeTrezorConnect({ strictSafetyChecks: true });
                const rows = await trezor(connect).getAddresses({ chainId, addressType, ...TUPLE, count });
                const paths = Array.from({ length: count }, (_, i) => hardwarePath(chainId, addressType, 0, 0, i));
                expect(rows.map((r) => r.path)).toEqual(paths);
                expect(rows.every((r) => r.path.split('/')[2] === "1'")).toBe(true);
                expect(rows.map((r) => r.address)).toEqual(paths.map((p) => sdkAddress(chainId, p, addressType)));
                expect(rows.map((r) => r.publicKey)).toEqual(paths.map((p) => derive(ROOT, p).publicKeyHex));
                expect(connect.unsafeFlags).toEqual([]);
            });
        }
    }

    it('sends the test coin with a plain coin and path, no unsafe-path flag', async () => {
        const connect = fakeTrezorConnect();
        await trezor(connect).getAddresses({ chainId: 'bitcoin-testnet', addressType: 'p2wpkh', ...TUPLE, count: 1 });
        expect(connect.getAddress.mock.calls[0][0]).toEqual({ path: "m/84'/1'/0'/0/0", coin: 'test', showOnTrezor: false });
        await trezor(connect).getPublicKey({ chainId: 'litecoin-testnet', path: "m/44'/1'/0'" });
        expect(connect.getPublicKey.mock.calls.at(-1)[0]).toEqual({ path: "m/44'/1'/0'", coin: 'tltc' });
    });

    it('defaults Litecoin testnet to the legacy 44\' purpose, like Litecoin mainnet', async () => {
        const [row] = await trezor(fakeTrezorConnect()).getAddresses({ chainId: 'litecoin-testnet', ...TUPLE, count: 1 });
        expect(row.path).toBe("m/44'/1'/0'/0/0");
    });

    it('differs from a software wallet on the same seed: the accepted cost of native test derivation', async () => {
        const [hw] = await trezor(fakeTrezorConnect()).getAddresses({ chainId: 'bitcoin-testnet', addressType: 'p2wpkh', ...TUPLE, count: 1 });
        const [sw] = await softwareSigner().getAddresses({ chainId: 'bitcoin-testnet', addressType: 'p2wpkh', ...TUPLE, count: 1 });
        expect(sw.path).toBe("m/84'/0'/0'/0/0");
        expect(hw.path).toBe("m/84'/1'/0'/0/0");
        expect(hw.address).not.toBe(sw.address);
    });
});

describe('Ledger mainnet: address parity with the software signer, unchanged', () => {
    for (const [chainId, addressType] of pairsFor(LEDGER_CHAINS.filter(isMainnet))) {
        it(`${chainId} ${addressType}: path and address equal the software signer's, with no app probe`, async () => {
            const { signer, transport } = fakeLedger(LEDGER_APP_NAME_FOR_CHAIN[chainId]);
            const hw = await signer.getAddresses({ chainId, addressType, ...TUPLE, count: 2 });
            const sw = await softwareSigner().getAddresses({ chainId, addressType, ...TUPLE, count: 2 });
            expect(hw.map((r) => r.path)).toEqual(sw.map((r) => r.path));
            expect(hw.map((r) => r.address)).toEqual(sw.map((r) => r.address));
            expect(transport.send).not.toHaveBeenCalled();
        });
    }
});

describe('Ledger Bitcoin testnet and regtest: the Bitcoin Test app at 1\'', () => {
    const pairs = pairsFor(LEDGER_CHAINS.filter((id) => !isMainnet(id)));

    it('covers both Bitcoin test networks', () => {
        expect([...new Set(pairs.map(([c]) => c))].sort()).toEqual(['bitcoin-regtest', 'bitcoin-testnet']);
        expect(LEDGER_APP_NAME_FOR_CHAIN['bitcoin-testnet']).toBe('Bitcoin Test');
        expect(LEDGER_APP_NAME_FOR_CHAIN['bitcoin-regtest']).toBe('Bitcoin Test');
    });

    for (const [chainId, addressType] of pairs) {
        it(`${chainId} ${addressType}: the stored address is the device's, in the SDK's encoding for the chain`, async () => {
            const { signer, getApp } = fakeLedger('Bitcoin Test');
            const rows = await signer.getAddresses({ chainId, addressType, ...TUPLE, count: 2 });
            const paths = [0, 1].map((i) => hardwarePath(chainId, addressType, 0, 0, i));
            expect(rows.map((r) => r.path)).toEqual(paths);
            expect(rows.map((r) => r.address)).toEqual(paths.map((p) => sdkAddress(chainId, p, addressType)));
            expect(getApp).toHaveBeenCalledWith(chainId === 'bitcoin-testnet' ? 'bitcoin_testnet' : 'bitcoin_regtest');
        });
    }

    it('regtest native segwit comes back bcrt1 although the device wrote tb1', async () => {
        const { signer } = fakeLedger('Bitcoin Test');
        const [row] = await signer.getAddresses({ chainId: 'bitcoin-regtest', addressType: 'p2wpkh', ...TUPLE, count: 1 });
        expect(row.address.startsWith('bcrt1')).toBe(true);
    });

    for (const openApp of ['Bitcoin', 'Litecoin']) {
        it(`refuses a test-network derive with the ${openApp} app open, before the device is asked`, async () => {
            const { signer, getApp } = fakeLedger(openApp);
            const err = await signer.getAddresses({ chainId: 'bitcoin-testnet', addressType: 'p2wpkh', ...TUPLE, count: 1 })
                .catch((e) => e);
            expect(err).toMatchObject({ status: 'wrong-app', code: 'HW_WRONG_APP' });
            expect(err.cause.message).toMatch(/instead of Bitcoin Test/);
            const app = getApp.mock.results[0]?.value;
            expect(app?.getWalletPublicKey ?? vi.fn()).not.toHaveBeenCalled();
            expect(await signer.getStatus({ chainId: 'bitcoin-testnet' })).toBe('wrong-app');
        });
    }

    it('refuses an answer that is not a Bitcoin test address', async () => {
        const { signer } = fakeLedger('Bitcoin Test');
        expect(() => signer._testNetworkAddress('bitcoin-testnet', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toThrow(/not a Bitcoin test address/);
        expect(() => regtestAddressFromTestApp('tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c')).toThrow();
    });

    it('reports available with the Bitcoin Test app open', async () => {
        const { signer } = fakeLedger('Bitcoin Test');
        expect(await signer.getStatus({ chainId: 'bitcoin-regtest' })).toBe('available');
    });
});

// The script type each family signs at by default on hardware.
const SIGN_TYPE = { bitcoin: 'p2wpkh', litecoin: 'p2pkh', dogecoin: 'p2pkh' };

/**
 * A one-input spend the seed's key at the hardware path owns, plus its signed
 * reply. By default each input carries its previous transaction, as the
 * hardware send path asks the encoder to attach it (attachPrevTx).
 */
function spendFor(chainId, { withPrevTx = true } = {}) {
    const scriptType = SIGN_TYPE[chainId.split('-')[0]];
    const path = hardwarePath(chainId, scriptType, 0, 0, 0);
    const changePath = hardwarePath(chainId, scriptType, 0, 1, 0);
    const key = Buffer.from(derive(ROOT, path).privateKey).toString('hex');
    const changeKey = Buffer.from(derive(ROOT, changePath).privateKey).toString('hex');
    const change = decomposedFor({ inputs: [{ scriptType, key: changeKey }] }).inputs[0].scriptPubKeyHex;
    const decomposed = decomposedFor({
        network: chainId,
        inputs: [{ scriptType, key, value: 5_000_000 }],
        outputs: [{
            address: sdkAddress(chainId, changePath, scriptType),
            scriptPubKeyHex: change,
            scriptType,
            value: 4_900_000,
        }],
    });
    if (withPrevTx) {
        for (const inp of decomposed.inputs) {
            inp.prevTxInfo = { hash: inp.prevTxHash, version: 2, lock_time: 0, inputs: [], bin_outputs: [] };
            // Ledger splits the full previous transaction; the fake's split is a stub.
            inp.nonWitnessUtxoHex = 'aa';
        }
    }
    return { decomposed, path, key, txHex: signedReplyFor(decomposed, { keys: [key] }) };
}

function registryFor(decomposed) {
    return {
        get: () => ({
            wallet: {
                decomposePsbt: () => decomposed,
                txidOf: (hex) => bitcoin.Transaction.fromHex(hex).getId(),
            },
        }),
    };
}

describe('Trezor PSBT signing on every supported network', () => {
    for (const chainId of TREZOR_CHAINS) {
        it(`${chainId}: signs at the hardware path under strict safety checks and the reply verifies`, async () => {
            const { decomposed, path, txHex } = spendFor(chainId);
            const connect = fakeTrezorConnect({
                strictSafetyChecks: true,
                signTransaction: async () => ({ success: true, payload: { serializedTx: txHex } }),
            });
            const out = await trezor(connect, registryFor(decomposed))
                .signPsbt({ psbtHex: '70736274ff', chainId, signingPaths: [{ inputIndex: 0, path }] });
            expect(out.txHex).toBe(txHex);
            const sent = connect.signTransaction.mock.calls[0][0];
            expect(sent.coin).toBe(CHAIN_ID_TO_TREZOR_COIN[chainId]);
            expect(sent.inputs[0].address_n).toEqual(pathToAddressN(path));
            // The previous transaction rides along, so no backend is consulted.
            expect(sent.refTxs?.map((tx) => tx.hash)).toEqual([decomposed.inputs[0].prevTxHash]);
            expect(connect.unsafeFlags).toEqual([]);
        });
    }

    // Pins the dependency on attachPrevTx: a segwit regtest PSBT without its
    // previous transactions cannot be signed, because nothing can supply them.
    it('cannot sign a bitcoin-regtest segwit PSBT that lacks its previous transactions', async () => {
        const { decomposed, path, txHex } = spendFor('bitcoin-regtest', { withPrevTx: false });
        const connect = fakeTrezorConnect({
            signTransaction: async () => ({ success: true, payload: { serializedTx: txHex } }),
        });
        await expect(trezor(connect, registryFor(decomposed))
            .signPsbt({ psbtHex: '70736274ff', chainId: 'bitcoin-regtest', signingPaths: [{ inputIndex: 0, path }] }))
            .rejects.toThrow();
        expect(connect.signTransaction.mock.calls[0][0].refTxs).toBeUndefined();
    });

    it('signs messages on every test network at the coin\'s own 1\' path', async () => {
        const connect = fakeTrezorConnect();
        for (const chainId of ['bitcoin-testnet', 'bitcoin-regtest', 'litecoin-testnet']) {
            const path = hardwarePath(chainId, SIGN_TYPE[chainId.split('-')[0]], 0, 0, 0);
            await expect(trezor(connect).signMessage({ message: 'hi', chainId, path }))
                .resolves.toEqual({ signature: 'c2lnbmF0dXJl' });
        }
        expect(connect.signMessage.mock.calls.map(([p]) => p.coin)).toEqual(['test', 'regtest', 'tltc']);
        await expect(trezor(connect).signMessage({ message: 'hi', chainId: 'bitcoin-mainnet', path: "m/84'/0'/0'/0/0" }))
            .resolves.toEqual({ signature: 'c2lnbmF0dXJl' });
    });

    it('a mainnet-slot path on a test coin is refused by Connect, never signed', async () => {
        const connect = fakeTrezorConnect();
        await expect(trezor(connect).signMessage({ message: 'hi', chainId: 'bitcoin-testnet', path: "m/84'/0'/0'/0/0" }))
            .rejects.toThrow();
    });
});

describe('Ledger PSBT and message signing on the Bitcoin test networks', () => {
    for (const chainId of ['bitcoin-testnet', 'bitcoin-regtest']) {
        it(`${chainId}: signs in the Bitcoin Test app at the 1' path and the reply verifies`, async () => {
            const { decomposed, path, txHex } = spendFor(chainId);
            const createPaymentTransaction = vi.fn(async () => txHex);
            const { signer, getApp } = fakeLedger('Bitcoin Test', { registry: registryFor(decomposed), createPaymentTransaction });
            const out = await signer.signPsbt({ psbtHex: '70736274ff', chainId, signingPaths: [{ inputIndex: 0, path }] });
            expect(out.txHex).toBe(txHex);
            expect(createPaymentTransaction.mock.calls[0][0].associatedKeysets).toEqual([path]);
            expect(path.split('/')[2]).toBe("1'");
            expect(getApp).toHaveBeenCalledWith(chainId === 'bitcoin-testnet' ? 'bitcoin_testnet' : 'bitcoin_regtest');
        });

        it(`${chainId}: refuses to sign with the Bitcoin app open`, async () => {
            const { decomposed, path } = spendFor(chainId);
            const createPaymentTransaction = vi.fn();
            const { signer } = fakeLedger('Bitcoin', { registry: registryFor(decomposed), createPaymentTransaction });
            const err = await signer.signPsbt({ psbtHex: '70736274ff', chainId, signingPaths: [{ inputIndex: 0, path }] })
                .catch((e) => e);
            expect(err).toMatchObject({ status: 'wrong-app', code: 'HW_WRONG_APP' });
            expect(err.cause.message).toMatch(/instead of Bitcoin Test/);
            expect(createPaymentTransaction).not.toHaveBeenCalled();
        });

        it(`${chainId}: signs a message in the Bitcoin Test app`, async () => {
            const { signer, getApp } = fakeLedger('Bitcoin Test');
            const path = hardwarePath(chainId, 'p2wpkh', 0, 0, 0);
            const { signature } = await signer.signMessage({ message: 'hi', chainId, path });
            expect(Buffer.from(signature, 'base64')).toHaveLength(65);
            const app = getApp.mock.results.at(-1).value;
            expect(app.signMessage).toHaveBeenCalledWith(path, Buffer.from('hi').toString('hex'));
        });
    }
});

describe('MockHardwareSigner signs every supported vendor network', () => {
    const SUPPORT = { trezor: TREZOR_NETWORK_SUPPORT, ledger: LEDGER_NETWORK_SUPPORT };
    for (const vendor of ['trezor', 'ledger']) {
        for (const chainId of ALL_CHAIN_IDS.filter((id) => SUPPORT[vendor][id].supported)) {
            it(`${vendor} ${chainId}: a swapped-in mock's reply verifies against the approved inputs`, async () => {
                const { decomposed, path, txHex } = spendFor(chainId);
                const mock = new MockHardwareSigner({
                    vendor,
                    signPsbtResult: () => ({ signedPsbtHex: '', txHex, txid: bitcoin.Transaction.fromHex(txHex).getId() }),
                });
                const out = await mock.signPsbt({ psbtHex: '70736274ff', chainId, signingPaths: [{ inputIndex: 0, path }] });
                expect(() => assertInputSignaturesVerify({ txHex: out.txHex, decomposed, signerId: mock.id })).not.toThrow();
                expect(mock.calls.signPsbt).toBe(1);
            });
        }
    }
});

describe('a hardware account stores the device\'s own test-network address', () => {
    const chainRegistry = new ChainRegistry();

    async function hardwareWalletIn(vendor, chainId, firstRow) {
        const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(9) });
        await vault.open();
        const hw = await addHardwareWallet({
            vault,
            chainRegistry,
            name: `My ${vendor}`,
            device: { vendor, model: vendor === 'trezor' ? 'T3T1' : 'nanoX', deviceIdentifier: `${vendor}-dev`, firmwareVersion: null },
            accounts: [{ chainId, accountIndex: 0, addressType: 'p2wpkh', ...firstRow }],
        });
        return { vault, hw };
    }

    const cases = [
        ['trezor', 'bitcoin-testnet', () => trezor(fakeTrezorConnect())],
        ['trezor', 'bitcoin-regtest', () => trezor(fakeTrezorConnect())],
        ['trezor', 'litecoin-testnet', () => trezor(fakeTrezorConnect())],
        ['ledger', 'bitcoin-testnet', () => fakeLedger('Bitcoin Test').signer],
        ['ledger', 'bitcoin-regtest', () => fakeLedger('Bitcoin Test').signer],
    ];
    for (const [vendor, chainId, makeSigner] of cases) {
        it(`${vendor} ${chainId}: createAccount writes the device address at the 1' path, as the SDK encodes it`, async () => {
            const signer = makeSigner();
            const [first] = await signer.getAddresses({ chainId, addressType: 'p2wpkh', ...TUPLE, count: 1 });
            const { vault, hw } = await hardwareWalletIn(vendor, chainId, {
                address: first.address, publicKey: first.publicKey, derivationPath: first.path,
            });
            const out = await createAccount({
                vault, walletId: hw.wallet.id, signer, chainRegistry, sdkRegistry: SDK, activeChainIds: [chainId],
            });
            const stored = (await vault.addresses.list()).filter((a) => a.accountId === out.account.id);
            expect(stored).toHaveLength(1);
            const [record] = stored;
            expect(record.source).toBe(vendor);
            expect(record.derivationPath).toBe(hardwarePath(chainId, record.addressType, 1, 0, 0));
            expect(record.derivationPath.split('/')[2]).toBe("1'");
            expect(record.address).toBe(sdkAddress(chainId, record.derivationPath, record.addressType));
        });
    }
});

describe('unsupported vendor networks are refused with a typed reason', () => {
    const trezorRefused = ALL_CHAIN_IDS.filter((id) => !TREZOR_NETWORK_SUPPORT[id].supported);
    const ledgerRefused = ALL_CHAIN_IDS.filter((id) => !LEDGER_NETWORK_SUPPORT[id].supported);

    it('the support tables agree with the signer maps', () => {
        expect(trezorRefused.sort()).toEqual(['dogecoin-regtest', 'dogecoin-testnet', 'litecoin-regtest']);
        expect(ledgerRefused.sort()).toEqual(['dogecoin-regtest', 'dogecoin-testnet', 'litecoin-regtest', 'litecoin-testnet']);
        for (const id of ALL_CHAIN_IDS) {
            expect(TREZOR_NETWORK_SUPPORT[id].supported).toBe(Object.prototype.hasOwnProperty.call(CHAIN_ID_TO_TREZOR_COIN, id));
            expect(LEDGER_NETWORK_SUPPORT[id].supported).toBe(Object.prototype.hasOwnProperty.call(LEDGER_APP_NAME_FOR_CHAIN, id));
        }
    });

    for (const chainId of trezorRefused) {
        it(`Trezor ${chainId}: status, derive and sign refuse without touching the device`, async () => {
            const connect = fakeTrezorConnect({ signTransaction: vi.fn() });
            const s = trezor(connect);
            expect(await s.getStatus({ chainId })).toBe('unsupported-network');
            await expect(s.getAddresses({ chainId, ...TUPLE, count: 1 })).rejects.toMatchObject({ code: 'HW_NETWORK_UNSUPPORTED' });
            await expect(s.signPsbt({ psbtHex: '70736274ff', chainId, signingPaths: [{ inputIndex: 0, path: "m/44'/1'/0'/0/0" }] }))
                .rejects.toMatchObject({ code: 'HW_NETWORK_UNSUPPORTED' });
            await expect(s.signMessage({ message: 'hi', chainId, path: "m/44'/1'/0'/0/0" }))
                .rejects.toMatchObject({ code: 'HW_NETWORK_UNSUPPORTED' });
            expect(connect.getAddress).not.toHaveBeenCalled();
            expect(connect.signTransaction).not.toHaveBeenCalled();
            expect(connect.signMessage).not.toHaveBeenCalled();
        });
    }

    for (const chainId of ledgerRefused) {
        it(`Ledger ${chainId}: status, derive and sign refuse with the vendor reason`, async () => {
            const { signer, getApp } = fakeLedger('Bitcoin Test');
            expect(await signer.getStatus({ chainId })).toBe('unsupported-network');
            const err = await signer.getAddresses({ chainId, ...TUPLE, count: 1 }).catch((e) => e);
            expect(err.code).toBe('HW_NETWORK_UNSUPPORTED');
            expect(err.message).toMatch(/software wallet/);
            expect(err.message).toMatch(/no (Litecoin|Dogecoin) test network app/);
            await expect(signer.signPsbt({ psbtHex: '70736274ff', chainId, signingPaths: [{ inputIndex: 0, path: "m/44'/1'/0'/0/0" }] }))
                .rejects.toMatchObject({ code: 'HW_NETWORK_UNSUPPORTED' });
            await expect(signer.signMessage({ message: 'hi', chainId, path: "m/44'/1'/0'/0/0" }))
                .rejects.toMatchObject({ code: 'HW_NETWORK_UNSUPPORTED' });
            expect(getApp).not.toHaveBeenCalled();
        });
    }
});
