// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A seeded stand-in for a Ledger or Trezor, for tests that need a device
// that answers like the vendor: keys come from a real BIP32 seed, addresses
// are encoded with the vendor's own coin parameters, and every Ledger app
// (the Bitcoin app included) refuses a path outside its coin type, as the
// device OS does. Pure Uint8Array code (noble, scure), so it runs under
// jsdom as well as node.

import { sha256 } from '@noble/hashes/sha2';
import { ripemd160 } from '@noble/hashes/legacy';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bech32, createBase58check } from '@scure/base';
import { mnemonicToSeedSync } from '@scure/bip39';
import { derive, hdKeyFromSeed } from '../../packages/core/src/crypto/hd.js';

const base58check = createBase58check(sha256);

export const SEED_A = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export const SEED_B = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

// Ledger app parameters (LedgerHQ app-bitcoin-new and app-bitcoin-legacy
// Makefiles: COIN_P2PKH_VERSION, COIN_P2SH_VERSION, COIN_NATIVE_SEGWIT_PREFIX,
// and the PATH_APP_LOAD_PARAMS coin-type restriction).
export const LEDGER_APPS = Object.freeze({
    Bitcoin: { coinType: 0, p2pkh: 0, p2sh: 5, bech32: 'bc', currency: 'bitcoin' },
    'Bitcoin Test': { coinType: 1, p2pkh: 111, p2sh: 196, bech32: 'tb', currency: 'bitcoin_testnet' },
    Litecoin: { coinType: 2, p2pkh: 48, p2sh: 50, bech32: 'ltc', currency: 'litecoin' },
    Dogecoin: { coinType: 3, p2pkh: 30, p2sh: 22, bech32: null, currency: 'dogecoin' },
});

// Trezor coin parameters (trezor-firmware common/defs/bitcoin/*.json).
export const TREZOR_COINS = Object.freeze({
    btc: { slip44: 0, p2pkh: 0, p2sh: 5, bech32: 'bc' },
    test: { slip44: 1, p2pkh: 111, p2sh: 196, bech32: 'tb' },
    regtest: { slip44: 1, p2pkh: 111, p2sh: 196, bech32: 'bcrt' },
    ltc: { slip44: 2, p2pkh: 48, p2sh: 50, bech32: 'ltc' },
    tltc: { slip44: 1, p2pkh: 111, p2sh: 58, bech32: 'tltc' },
    doge: { slip44: 3, p2pkh: 30, p2sh: 22, bech32: null },
});

// What the wallet watches for each chain (the SDK's network parameters).
export const CHAIN_PARAMS = Object.freeze({
    'bitcoin-mainnet': { p2pkh: 0, p2sh: 5, bech32: 'bc' },
    'bitcoin-testnet': { p2pkh: 111, p2sh: 196, bech32: 'tb' },
    'bitcoin-regtest': { p2pkh: 111, p2sh: 196, bech32: 'bcrt' },
    'litecoin-mainnet': { p2pkh: 48, p2sh: 50, bech32: 'ltc' },
    'litecoin-testnet': { p2pkh: 111, p2sh: 196, bech32: 'tltc' },
    'litecoin-regtest': { p2pkh: 111, p2sh: 196, bech32: 'rltc' },
    'dogecoin-mainnet': { p2pkh: 30, p2sh: 22, bech32: null },
    'dogecoin-testnet': { p2pkh: 113, p2sh: 196, bech32: null },
    'dogecoin-regtest': { p2pkh: 111, p2sh: 196, bech32: null },
});

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));
const hash160 = (bytes) => ripemd160(sha256(bytes));

/** The path's purpose and coin type, unhardened. */
export function pathParts(path) {
    const parts = String(path).split('/').slice(1).map((p) => parseInt(p, 10));
    return { purpose: parts[0], coinType: parts[1], numbers: parts };
}

/** Numeric address_n with hardened bits, as Trezor Connect echoes it. */
export function addressN(path) {
    return String(path).split('/').slice(1).map((p) => (p.endsWith("'") ? (parseInt(p, 10) | 0x80000000) >>> 0 : parseInt(p, 10)));
}

/** Encode a compressed public key as a device with these version bytes would, by path purpose. */
export function encodeAddress(pubkeyHex, purpose, params) {
    const h = hash160(fromHex(pubkeyHex));
    if (purpose === 44) return base58check.encode(Uint8Array.from([params.p2pkh, ...h]));
    if (purpose === 84) {
        if (!params.bech32) throw new Error('fake device: this coin has no segwit');
        return bech32.encode(params.bech32, [0, ...bech32.toWords(h)]);
    }
    if (purpose === 49) {
        const redeem = Uint8Array.from([0x00, 0x14, ...h]);
        return base58check.encode(Uint8Array.from([params.p2sh, ...hash160(redeem)]));
    }
    throw new Error(`fake device: no encoder for purpose ${purpose}`);
}

/**
 * The address type an address's encoding states on a chain, decided from
 * the encoding alone: a witness v0 20-byte program under the chain's HRP is
 * p2wpkh, a base58 address at the chain's P2PKH version is p2pkh, at its P2SH
 * version p2sh-p2wpkh (the only P2SH type the wallet derives). Anything else
 * is null.
 */
export function addressTypeOfEncoding(address, chainId) {
    const params = CHAIN_PARAMS[chainId];
    if (!params) return null;
    try {
        const { prefix, words } = bech32.decode(address);
        if (prefix !== params.bech32 || words[0] !== 0) return null;
        return bech32.fromWords(words.slice(1)).length === 20 ? 'p2wpkh' : null;
    } catch {
        // not bech32
    }
    try {
        const bytes = base58check.decode(address);
        if (bytes.length !== 21) return null;
        if (bytes[0] === params.p2pkh) return 'p2pkh';
        if (bytes[0] === params.p2sh) return 'p2sh-p2wpkh';
    } catch {
        // not base58check
    }
    return null;
}

/** The uncompressed (65-byte) form of a compressed public key, as Ledger answers. */
export function uncompressed(pubkeyHex) {
    return secp256k1.ProjectivePoint.fromHex(pubkeyHex).toHex(false);
}

/** GET_APP_AND_VERSION answer bytes for an app name and version. */
export function appInfoBytes(name, version = '2.2.1') {
    const enc = (s) => [...new TextEncoder().encode(s)];
    return Uint8Array.from([1, name.length, ...enc(name), version.length, ...enc(version), 1, 0, 0x90, 0x00]);
}

/**
 * A Ledger holding `mnemonic`, with one app open at a time. `openApp` can be
 * changed between calls. `Btc` is a stand-in for hw-app-btc's class: its
 * answers come from the OPEN app, never the client's currency, and every
 * app refuses a path outside its coin type with 0x6a82. With `followCurrency`
 * the user is modelled as opening the right app first: building a client for
 * a currency opens that currency's app.
 */
export function seededLedger(mnemonic = SEED_A, { openApp = 'Bitcoin', model = 'nanoX', followCurrency = false } = {}) {
    const root = hdKeyFromSeed(mnemonicToSeedSync(mnemonic));
    const device = { openApp, root };
    const transport = {
        deviceModel: { id: model },
        send: async () => appInfoBytes(device.openApp),
    };
    function Btc({ currency } = {}) {
        if (followCurrency) {
            const name = Object.keys(LEDGER_APPS).find((n) => LEDGER_APPS[n].currency === currency)
                ?? (currency === 'bitcoin_regtest' ? 'Bitcoin Test' : null);
            if (name) device.openApp = name;
        }
        return {
            async getWalletPublicKey(path, opts = {}) {
                const app = LEDGER_APPS[device.openApp];
                const { purpose, coinType } = pathParts(path);
                if (!app || coinType !== app.coinType) {
                    throw Object.assign(new Error('Ledger device: UNKNOWN_ERROR (0x6a82)'), { statusCode: 0x6a82 });
                }
                const key = derive(root, path);
                const formatPurpose = opts.format === 'bech32' ? 84 : opts.format === 'p2sh' ? 49 : 44;
                const address = pathParts(path).numbers.length >= 5
                    ? encodeAddress(key.publicKeyHex, formatPurpose || purpose, app)
                    : '';
                return { publicKey: uncompressed(key.publicKeyHex), bitcoinAddress: address, chainCode: toHex(key.chainCode ?? new Uint8Array(32)) };
            },
            async signMessage() {
                if (!LEDGER_APPS[device.openApp]) throw new Error('no app');
                return { v: 0, r: '11'.repeat(32), s: '22'.repeat(32) };
            },
            splitTransaction: () => ({ split: true }),
            createPaymentTransaction: async () => '',
        };
    }
    return { device, transport, Btc };
}

/** A Trezor Connect stand-in holding `mnemonic` that refuses a path whose coin type is not the coin's. */
export function seededTrezorConnect(mnemonic = SEED_A) {
    const root = hdKeyFromSeed(mnemonicToSeedSync(mnemonic));
    const guard = (params) => {
        const def = TREZOR_COINS[params.coin];
        if (!def) return { success: false, payload: { error: `Coin ${params.coin} not found` } };
        if (pathParts(params.path).coinType !== def.slip44) {
            return { success: false, payload: { error: 'Parameters "path" and "coin" do not match.' } };
        }
        return null;
    };
    return {
        getFeatures: async () => ({ success: true, payload: { device_id: `trezor-${mnemonic.split(' ')[0]}` } }),
        getAddress: async (params) => guard(params) ?? {
            success: true,
            payload: {
                path: addressN(params.path),
                address: encodeAddress(derive(root, params.path).publicKeyHex, pathParts(params.path).purpose, TREZOR_COINS[params.coin]),
            },
        },
        getPublicKey: async (params) => guard(params) ?? {
            success: true,
            payload: { path: addressN(params.path), publicKey: derive(root, params.path).publicKeyHex, chainCode: '', fingerprint: 0 },
        },
    };
}
