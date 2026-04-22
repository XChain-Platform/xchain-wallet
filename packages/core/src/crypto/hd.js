// BIP32 HD derivation — §16. The heavy lifting is in @scure/bip32; this
// wrapper turns a seed + a derivation path into the fields the Signer
// interface expects (§17.1 getPublicKey return shape).

import { HDKey } from '@scure/bip32';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * @typedef {Object} DerivedKey
 * @property {Uint8Array} privateKey  32 bytes. Undefined for public-only parents.
 * @property {Uint8Array} publicKey   33 bytes, compressed
 * @property {Uint8Array} chainCode   32 bytes
 * @property {string} publicKeyHex    compressed pubkey in hex
 * @property {string} fingerprint     4-byte parent-fingerprint-at-this-node in hex
 * @property {string} path            the concrete path
 */

/**
 * @param {Uint8Array} seed        64-byte BIP39 seed
 * @returns {HDKey}
 */
export function hdKeyFromSeed(seed) {
    return HDKey.fromMasterSeed(seed);
}

/**
 * Derive a child node at `path` and return the key + metadata.
 *
 * @param {HDKey} root
 * @param {string} path            e.g. "m/84'/0'/0'/0/5"
 * @returns {DerivedKey}
 */
export function derive(root, path) {
    const child = root.derive(path);
    if (!child.publicKey) {
        throw new Error(`hd: derivation produced no public key for ${path}`);
    }
    return {
        privateKey: child.privateKey ?? undefined,
        publicKey: child.publicKey,
        chainCode: child.chainCode,
        publicKeyHex: bytesToHex(child.publicKey),
        fingerprint: fingerprintHex(child.fingerprint),
        path,
    };
}

function fingerprintHex(fp) {
    // @scure/bip32 exposes `fingerprint` as a Number32. Render as 4-byte hex.
    if (typeof fp === 'number') {
        return fp.toString(16).padStart(8, '0');
    }
    if (fp instanceof Uint8Array) return bytesToHex(fp);
    return String(fp);
}

/**
 * Zero a DerivedKey's sensitive material in place. Best-effort, same
 * caveat as §17.2 memory hygiene.
 *
 * @param {DerivedKey} dk
 */
export function zeroDerivedKey(dk) {
    if (dk.privateKey) dk.privateKey.fill(0);
    if (dk.chainCode) dk.chainCode.fill(0);
}

export { HDKey };
