// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Encrypted backup-file envelope — §19.4.
//
// Envelope layout (the on-disk `.xchain-wallet` file):
//
//   {
//     "magic": "XCHAIN-WALLET-BACKUP",
//     "formatVersion": 1,
//     "createdAt": "2026-04-22T12:00:00Z",
//     "walletName": "Daily Driver",
//     "encryption": {
//       "algorithm": "aes-256-gcm",
//       "kdf": { "algorithm": "argon2id", "salt": "...", "iterations": ..., "memory": ..., "parallelism": ... },
//       "iv":  "base64",
//       "tag": "base64"
//     },
//     "payload": "base64(ciphertext-only)"
//   }
//
// iv + tag + ciphertext are stored as three separate fields (not the
// Vault codec's packed `iv || ct || tag` blob) so other XChain-Wallet
// implementations / auditors can inspect the envelope without needing
// our exact concatenation order.
//
// The backup password is INDEPENDENT of the wallet-unlock password
// (§19.4). A fresh KDF params is calibrated / generated at export time;
// the export's KdfParams lands in the envelope so import can reproduce
// the same master key.

import { decrypt as aeadDecrypt, encrypt as aeadEncrypt } from './aead.js';
import { base64ToBytes, bytesToBase64, deriveMasterKey, makeFreshKdfParams } from './kdf.js';

export const BACKUP_MAGIC = 'XCHAIN-WALLET-BACKUP';
export const BACKUP_FORMAT_VERSION = 1;

const AEAD_TAG_LENGTH = 16;  // AES-256-GCM standard

export class BackupFormatError extends Error {
    constructor(reason) {
        super(`backup: ${reason}`);
        this.name = 'BackupFormatError';
    }
}

export class BackupPasswordError extends Error {
    constructor() {
        super('backup: wrong password or tampered file');
        this.name = 'BackupPasswordError';
    }
}

/**
 * @typedef {Object} BackupEnvelope
 * @property {typeof BACKUP_MAGIC} magic
 * @property {typeof BACKUP_FORMAT_VERSION} formatVersion
 * @property {string} createdAt
 * @property {string} walletName
 * @property {{ algorithm: 'aes-256-gcm', kdf: import('./kdf.js').KdfParams, iv: string, tag: string }} encryption
 * @property {string} payload      base64 ciphertext (no iv, no tag)
 */

/**
 * Encrypt an arbitrary payload object into the §19.4 envelope.
 *
 * @param {Object} opts
 * @param {string} opts.password
 * @param {unknown} opts.payload               serialized via JSON.stringify
 * @param {string} opts.walletName
 * @param {import('./kdf.js').KdfParams} [opts.kdfParams]  override; defaults to a fresh floor-tuned params
 * @returns {Promise<BackupEnvelope>}
 */
export async function encodeBackupEnvelope({ password, payload, walletName, kdfParams }) {
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('encodeBackupEnvelope: password is required');
    }
    if (typeof walletName !== 'string') {
        throw new Error('encodeBackupEnvelope: walletName must be a string');
    }
    const params = kdfParams ?? makeFreshKdfParams();
    const masterKey = deriveMasterKey(password, params);
    try {
        const plaintext = new TextEncoder().encode(JSON.stringify(payload));
        let packed;
        try {
            packed = await aeadEncrypt(masterKey, plaintext);
        } finally {
            plaintext.fill(0);
        }
        // aead.js returns iv || ct || tag. Split into separate fields
        // so the envelope matches the spec layout exactly.
        const iv = packed.subarray(0, 12);
        const ctPlusTag = packed.subarray(12);
        const ct = ctPlusTag.subarray(0, ctPlusTag.length - AEAD_TAG_LENGTH);
        const tag = ctPlusTag.subarray(ctPlusTag.length - AEAD_TAG_LENGTH);
        return {
            magic: BACKUP_MAGIC,
            formatVersion: BACKUP_FORMAT_VERSION,
            createdAt: new Date().toISOString(),
            walletName,
            encryption: {
                algorithm: 'aes-256-gcm',
                kdf: params,
                iv: bytesToBase64(iv),
                tag: bytesToBase64(tag),
            },
            payload: bytesToBase64(ct),
        };
    } finally {
        masterKey.fill(0);
    }
}

/**
 * Decrypt a §19.4 envelope back to its payload object.
 *
 * @param {Object} opts
 * @param {string} opts.password
 * @param {BackupEnvelope} opts.envelope
 * @returns {Promise<unknown>}                 JSON-parsed payload
 */
export async function decodeBackupEnvelope({ password, envelope }) {
    assertEnvelopeShape(envelope);
    const { kdf, iv: ivB64, tag: tagB64 } = envelope.encryption;
    const iv = base64ToBytes(ivB64);
    const tag = base64ToBytes(tagB64);
    const ct = base64ToBytes(envelope.payload);
    if (iv.length !== 12) throw new BackupFormatError('iv must be 12 bytes');
    if (tag.length !== AEAD_TAG_LENGTH) {
        throw new BackupFormatError('tag must be 16 bytes');
    }
    const blob = new Uint8Array(iv.length + ct.length + tag.length);
    blob.set(iv, 0);
    blob.set(ct, iv.length);
    blob.set(tag, iv.length + ct.length);

    const masterKey = deriveMasterKey(password, kdf);
    let plaintext;
    try {
        try {
            plaintext = await aeadDecrypt(masterKey, blob);
        } catch {
            throw new BackupPasswordError();
        }
    } finally {
        masterKey.fill(0);
    }
    try {
        return JSON.parse(new TextDecoder().decode(plaintext));
    } catch (e) {
        throw new BackupFormatError(
            `decoded payload is not valid JSON (${e && e.message ? e.message : String(e)})`,
        );
    } finally {
        plaintext.fill(0);
    }
}

/**
 * Serialize an envelope to the on-disk JSON string form. Pretty-printed
 * so users who open the file in a text editor see something readable.
 *
 * @param {BackupEnvelope} envelope
 * @returns {string}
 */
export function stringifyBackupEnvelope(envelope) {
    return JSON.stringify(envelope, null, 2);
}

/**
 * Parse a file's contents into a validated envelope. Accepts either an
 * already-parsed object or a string.
 *
 * @param {string | object} input
 * @returns {BackupEnvelope}
 */
export function parseBackupEnvelope(input) {
    let obj;
    if (typeof input === 'string') {
        try {
            obj = JSON.parse(input);
        } catch (e) {
            throw new BackupFormatError(
                `file is not valid JSON (${e && e.message ? e.message : String(e)})`,
            );
        }
    } else if (input && typeof input === 'object') {
        obj = input;
    } else {
        throw new BackupFormatError('input must be a JSON string or object');
    }
    assertEnvelopeShape(obj);
    return /** @type {BackupEnvelope} */ (obj);
}

function assertEnvelopeShape(env) {
    if (!env || typeof env !== 'object') {
        throw new BackupFormatError('envelope must be an object');
    }
    if (env.magic !== BACKUP_MAGIC) {
        throw new BackupFormatError(`unexpected magic "${env.magic}"`);
    }
    if (env.formatVersion !== BACKUP_FORMAT_VERSION) {
        throw new BackupFormatError(
            `unsupported formatVersion ${env.formatVersion} (expected ${BACKUP_FORMAT_VERSION})`,
        );
    }
    if (!env.encryption || env.encryption.algorithm !== 'aes-256-gcm') {
        throw new BackupFormatError('encryption.algorithm must be "aes-256-gcm"');
    }
    const kdf = env.encryption.kdf;
    if (!kdf || kdf.algorithm !== 'argon2id') {
        throw new BackupFormatError('encryption.kdf.algorithm must be "argon2id"');
    }
    if (typeof kdf.salt !== 'string' || !kdf.salt) {
        throw new BackupFormatError('encryption.kdf.salt missing');
    }
    if (typeof kdf.iterations !== 'number' || typeof kdf.memory !== 'number' || typeof kdf.parallelism !== 'number') {
        throw new BackupFormatError('encryption.kdf params missing');
    }
    if (typeof env.encryption.iv !== 'string' || typeof env.encryption.tag !== 'string') {
        throw new BackupFormatError('encryption.iv / tag must be base64 strings');
    }
    if (typeof env.payload !== 'string') {
        throw new BackupFormatError('payload must be a base64 string');
    }
}
