// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1';

const MAINNET_VERSIONS = { private: 0x0488ade4, public: 0x0488b21e };
const TESTNET_VERSIONS = { private: 0x04358394, public: 0x043587cf };

const NETWORKS = [
    { kind: 'mainnet', versions: MAINNET_VERSIONS },
    { kind: 'testnet', versions: TESTNET_VERSIONS },
];

/**
 * True when a string encodes a real compressed secp256k1 public key.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isCompressedPublicKey(value) {
    if (typeof value !== 'string' || !/^(02|03)[0-9a-fA-F]{64}$/.test(value)) return false;
    try {
        secp256k1.ProjectivePoint.fromHex(value);
        return true;
    } catch {
        return false;
    }
}

/**
 * Checks an account xpub against the selected network and the public key at
 * its full derivation path. Returns a user-facing error or null.
 *
 * @param {string} xpub
 * @param {'mainnet' | 'testnet' | 'regtest'} networkKind
 * @param {string} derivationPath
 * @param {string} pubkey
 * @returns {string | null}
 */
export function validateCosignerXpub(xpub, networkKind, derivationPath, pubkey) {
    const parsed = parseExtendedKey(xpub);
    if (!parsed) return 'xpub is not a valid extended public key.';
    if (parsed.node.privateKey) return 'Use an extended public key, not a private key.';

    const expectedNetwork = networkKind === 'mainnet' ? 'mainnet' : 'testnet';
    if (parsed.kind !== expectedNetwork) {
        return expectedNetwork === 'mainnet'
            ? 'xpub is for a test network, not Bitcoin mainnet.'
            : 'xpub is for Bitcoin mainnet, not this test network.';
    }

    const parts = parseDerivationPath(derivationPath);
    if (!parts || parsed.node.depth > parts.length) {
        return 'Derivation path does not match the xpub depth.';
    }
    if (parsed.node.depth > 0
        && pathIndex(parts[parsed.node.depth - 1]) !== parsed.node.index) {
        return 'Derivation path does not match the xpub child index.';
    }
    const suffix = parts.slice(parsed.node.depth);
    if (suffix.some((part) => part.endsWith("'"))) {
        return 'Derivation path asks this public xpub to derive a hardened child.';
    }
    try {
        const child = parsed.node.derive(suffix.length > 0 ? `m/${suffix.join('/')}` : 'm');
        const derived = bytesToHex(child.publicKey);
        if (derived !== pubkey.toLowerCase()) {
            return 'Public key does not match the xpub and derivation path.';
        }
    } catch {
        return 'Derivation path cannot be derived from this xpub.';
    }
    return null;
}

/**
 * Re-serializes a valid public extended key for the selected Bitcoin network.
 * Unknown strings pass through so the share card can still show host errors.
 *
 * @param {string | null | undefined} xpub
 * @param {'mainnet' | 'testnet' | 'regtest' | undefined} networkKind
 * @returns {string | null | undefined}
 */
export function xpubForNetwork(xpub, networkKind) {
    if (!xpub) return xpub;
    const parsed = parseExtendedKey(xpub);
    if (!parsed) return xpub;
    if (parsed.node.privateKey) return null;
    if (!networkKind) return xpub;
    const target = networkKind === 'mainnet' ? MAINNET_VERSIONS : TESTNET_VERSIONS;
    if (parsed.node.versions.public === target.public) return xpub;
    return new HDKey({
        versions: target,
        depth: parsed.node.depth,
        index: parsed.node.index,
        parentFingerprint: parsed.node.parentFingerprint,
        chainCode: parsed.node.chainCode,
        publicKey: parsed.node.publicKey,
    }).publicExtendedKey;
}

function parseExtendedKey(value) {
    if (typeof value !== 'string' || value.length === 0) return null;
    for (const network of NETWORKS) {
        try {
            return {
                kind: network.kind,
                node: HDKey.fromExtendedKey(value, network.versions),
            };
        } catch {
            // Try the other standard Bitcoin extended-key version.
        }
    }
    return null;
}

function parseDerivationPath(path) {
    if (typeof path !== 'string' || !/^m(?:\/\d+'?)*$/.test(path)) return null;
    return path === 'm' ? [] : path.slice(2).split('/');
}

function pathIndex(part) {
    const hardened = part.endsWith("'");
    const index = Number(hardened ? part.slice(0, -1) : part);
    return hardened ? index + 0x80000000 : index;
}

function bytesToHex(bytes) {
    if (!(bytes instanceof Uint8Array)) return '';
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
