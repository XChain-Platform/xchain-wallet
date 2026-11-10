// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { secp256k1 } from '@noble/curves/secp256k1';
import { ripemd160 } from '@noble/hashes/legacy';
import { sha256 } from '@noble/hashes/sha2';
import { base58check, bech32 } from '@scure/base';
import { decodeWif } from '../../crypto/wif.js';

const bsc = base58check(sha256);

// The single-key types importSingleWif can derive through the SDK. Taproot is
// absent because the SDK derives no single-key p2tr address.
export const WIF_IMPORT_ADDRESS_TYPES = Object.freeze(['p2pkh', 'p2sh-p2wpkh', 'p2wpkh']);

// These are the consensus address encodings used by the same three chain
// families as the bundled registry. Keeping import and preview on this one
// table makes the address shown before import the address that is stored.
const ADDRESS_NETWORKS = Object.freeze({
    bitcoin: Object.freeze({
        mainnet: Object.freeze({ pubKeyHash: 0x00, scriptHash: 0x05, bech32: 'bc' }),
        testnet: Object.freeze({ pubKeyHash: 0x6f, scriptHash: 0xc4, bech32: 'tb' }),
        regtest: Object.freeze({ pubKeyHash: 0x6f, scriptHash: 0xc4, bech32: 'bcrt' }),
    }),
    litecoin: Object.freeze({
        mainnet: Object.freeze({ pubKeyHash: 0x30, scriptHash: 0x32, bech32: 'ltc' }),
        testnet: Object.freeze({ pubKeyHash: 0x6f, scriptHash: 0xc4, bech32: 'tltc' }),
        regtest: Object.freeze({ pubKeyHash: 0x6f, scriptHash: 0xc4, bech32: 'rltc' }),
    }),
    dogecoin: Object.freeze({
        mainnet: Object.freeze({ pubKeyHash: 0x1e, scriptHash: 0x16, bech32: null }),
        testnet: Object.freeze({ pubKeyHash: 0x71, scriptHash: 0xc4, bech32: null }),
        regtest: Object.freeze({ pubKeyHash: 0x6f, scriptHash: 0xc4, bech32: null }),
    }),
});

function concatBytes(...parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        joined.set(part, offset);
        offset += part.length;
    }
    return joined;
}

function hash160(bytes) {
    return ripemd160(sha256(bytes));
}

function base58Address(version, payload) {
    return bsc.encode(concatBytes(Uint8Array.of(version), payload));
}

/**
 * Decode only the WIF version byte. Invalid or incomplete values return null.
 *
 * @param {string} wif
 * @returns {number | null}
 */
export function wifImportVersionByte(wif) {
    let decoded;
    try {
        decoded = decodeWif(String(wif || '').trim());
        return decoded.versionByte;
    } catch {
        return null;
    } finally {
        decoded?.privateKey.fill(0);
    }
}

/**
 * The type importSingleWif chooses when the caller does not override it.
 *
 * @param {{ defaultAddressType: string }} descriptor
 * @param {string} wif
 * @returns {string}
 */
export function defaultWifImportAddressType(descriptor, wif) {
    let decoded;
    try {
        decoded = decodeWif(String(wif || '').trim());
        return decoded.compressed ? descriptor.defaultAddressType : 'p2pkh';
    } catch {
        return descriptor.defaultAddressType;
    } finally {
        decoded?.privateKey.fill(0);
    }
}

/**
 * Derive an imported-key address from already validated key information.
 *
 * @param {{ coin: string, networkKind: string }} descriptor
 * @param {string} addressType
 * @param {{ publicKeyHex: string, compressed?: boolean }} keyInfo
 * @returns {string}
 */
export function deriveImportedKeyAddress(descriptor, addressType, keyInfo) {
    const network = ADDRESS_NETWORKS[descriptor?.coin]?.[descriptor?.networkKind];
    if (!network) throw new Error('Unsupported private-key network');
    const publicKey = Uint8Array.from(
        keyInfo.publicKeyHex.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) || [],
    );
    if (publicKey.length !== 33 && publicKey.length !== 65) {
        throw new Error('Invalid imported public key');
    }
    if (keyInfo.compressed === false && addressType !== 'p2pkh') {
        throw new Error('Uncompressed keys only support legacy addresses');
    }
    const publicKeyHash = hash160(publicKey);
    if (addressType === 'p2pkh') return base58Address(network.pubKeyHash, publicKeyHash);
    if (!network.bech32) throw new Error('SegWit is not supported on this network');
    if (addressType === 'p2wpkh') {
        return bech32.encode(network.bech32, [0, ...bech32.toWords(publicKeyHash)]);
    }
    if (addressType === 'p2sh-p2wpkh') {
        const redeemScript = concatBytes(Uint8Array.of(0x00, 0x14), publicKeyHash);
        return base58Address(network.scriptHash, hash160(redeemScript));
    }
    throw new Error(`Unsupported private key type "${addressType}"`);
}

/**
 * Stateless live preview for the onboarding private-key form.
 *
 * @param {{ wif: string, descriptor: object, addressType?: string }} opts
 * @returns {string | null}
 */
export function wifImportPreview({ wif, descriptor, addressType }) {
    let decoded;
    try {
        decoded = decodeWif(String(wif || '').trim());
        if (!descriptor || decoded.versionByte !== descriptor.wifVersionByte) return null;
        const type = addressType || (decoded.compressed ? descriptor.defaultAddressType : 'p2pkh');
        if (!descriptor.addressTypes.includes(type) || !WIF_IMPORT_ADDRESS_TYPES.includes(type)) return null;
        const publicKey = secp256k1.getPublicKey(decoded.privateKey, decoded.compressed);
        return deriveImportedKeyAddress(descriptor, type, {
            publicKeyHex: Array.from(publicKey, (byte) => byte.toString(16).padStart(2, '0')).join(''),
            compressed: decoded.compressed,
        });
    } catch {
        return null;
    } finally {
        decoded?.privateKey.fill(0);
    }
}
