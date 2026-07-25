// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// gatedPublishAction (PC-25): publish a token-gated encrypted file as
// ONE atomic transaction, per Token_Gated_Content.md:
//
//   BATCH|0|FILE|0|NAME|TYPE|TITLE|MEMO|GATE_TICKER|1|KEY_HASH
//          ;MESSAGE|2|COIN|<issuer-address>|<ECIES(0x01 || K)>
//
// with the AES-256-GCM ciphertext ([iv 12][tag 16][ct]) riding the
// transaction's rawData. The self-addressed MESSAGE records K on-chain
// (encrypted to the issuer's own pubkey) in the same transaction, so
// there is no window where the ciphertext exists without the key.
//
// Crypto is delegated to the SDK: sdk.gatedFile (key gen / AES / the
// 0x01-versioned handoff payload) and sdk.messaging.eciesEncryptBytes
// (ECIES envelope). ECIES needs only the recipient PUBKEY plus a fresh
// ephemeral key, and here the recipient is the issuer, whose pubkey is
// in the source address record: no private key is touched at compose
// time, which is what makes this flow HW- and watcher-safe (§5).
//
// Key custody: K is persisted to the vault's gatedKeys collection
// BEFORE compose/broadcast. Ordering matters twice over: (a) a broadcast
// that succeeds after a failed put would leave K recoverable only via
// the ECIES scan, which HW/watch-only signers cannot run; (b) a put
// that succeeds before a failed broadcast leaves a harmless, reusable
// pack-key row (same KEY_HASH on retry). Pack extension reuses the
// stored K by keyHash; the protocol has no pack concept beyond the
// shared (GATE_TICKER, KEY_HASH).

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';
import { buildActionPsbt } from './buildActionPsbt.js';
import { createGatedKey, gatedKeyId } from '../schemas/gatedKey.js';

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * Hard ceiling on plaintext size for this lane. The encoder rejects
 * compiled pushes past 8192 bytes; ciphertext adds 28 bytes, and the
 * BATCH string carries the ~230-char ECIES handoff. PC-28 owns the
 * encoding-aware general limits; until then this stays conservative
 * (matches AttachContentForm's 7000-byte artwork cap minus overhead).
 */
export const MAX_GATED_PLAINTEXT_BYTES = 6500;

/**
 * @typedef {Object} GatedPublishOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} [password]
 * @property {object} [signer]
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {object} from            source address record (address, publicKey, derivationPath, ...)
 * @property {string} gateTicker      tick this wallet owns; indexer rejects non-owner publishes
 * @property {string} name            file name (FILE.NAME)
 * @property {string} type            MIME type (FILE.TYPE)
 * @property {string} [title]
 * @property {string} [memo]
 * @property {string} plainData       plaintext file bytes as a Latin-1 binary string
 *                                    (same transport contract as fileAction.rawData)
 * @property {string} [existingKeyHash]  reuse the stored pack key with this hash
 *                                    instead of generating a fresh K
 * @property {number} [feePerKb]
 * @property {boolean} [trackPendingTx]
 */

/**
 * Shared front half: validate, resolve/generate K, encrypt, persist K,
 * and build the BATCH actionData + encoderOpts. Both the signing path
 * and the watcher (encode-only) path run through here so their
 * compositions cannot drift.
 *
 * @param {GatedPublishOpts} opts
 * @param {string} caller
 */
async function prepareGatedPublish(opts, caller) {
    if (!opts) throw new Error(`${caller}: opts is required`);
    if (typeof opts.gateTicker !== 'string' || opts.gateTicker.trim().length === 0) {
        throw new Error(`${caller}: gateTicker is required`);
    }
    if (typeof opts.name !== 'string' || opts.name.length === 0) {
        throw new Error(`${caller}: name is required`);
    }
    if (typeof opts.type !== 'string' || opts.type.length === 0) {
        throw new Error(`${caller}: type (MIME) is required`);
    }
    if (typeof opts.plainData !== 'string' || opts.plainData.length === 0) {
        throw new Error(`${caller}: plainData (file bytes) is required`);
    }
    if (opts.plainData.length > MAX_GATED_PLAINTEXT_BYTES) {
        throw new Error(
            `${caller}: file is ${opts.plainData.length} bytes; this lane supports up to ${MAX_GATED_PLAINTEXT_BYTES}`,
        );
    }
    const gate = opts.gateTicker.trim().toUpperCase();
    for (const [field, value] of [['gateTicker', gate], ['name', opts.name], ['type', opts.type], ['title', opts.title], ['memo', opts.memo]]) {
        if (typeof value === 'string' && /[|;]/.test(value)) {
            throw new Error(`${caller}: ${field} cannot contain | or ; characters`);
        }
    }
    if (!opts.vault) throw new Error(`${caller}: vault is required`);
    if (!opts.sdkRegistry) throw new Error(`${caller}: sdkRegistry is required`);
    if (!opts.chainId) throw new Error(`${caller}: chainId is required`);

    // normalizeSource enforces from.address + from.publicKey (the handoff
    // is ECIES-encrypted to that pubkey) and rejects watch-only sources.
    const source = normalizeSource(opts.from, caller);

    const sdk = opts.sdkRegistry.get(opts.chainId);
    const descriptor = opts.chainRegistry?.get?.(opts.chainId);
    const coin = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : null;
    if (!coin) throw new Error(`${caller}: cannot resolve protocol coin ticker for ${opts.chainId}`);

    // --- Resolve the pack key -------------------------------------------
    let key;      // Buffer(32)
    let keyHash;  // hex
    if (opts.existingKeyHash) {
        const id = gatedKeyId({
            walletId: opts.walletId,
            chainId: opts.chainId,
            gateTicker: gate,
            keyHash: opts.existingKeyHash,
        });
        const record = await opts.vault.gatedKeys.get(id);
        if (!record) {
            throw new Error(
                `${caller}: no stored key for pack ${opts.existingKeyHash} on ${gate}; `
                + 'publish to an existing pack requires the pack key in this wallet\'s vault',
            );
        }
        key = Buffer.from(record.keyHex, 'hex');
        keyHash = record.keyHash;
        // The vault row binds keyHash to keyHex at write time; re-verify
        // anyway so a corrupted row can never encrypt content to a hash
        // it does not match (that would publish an unlockable file).
        if (!sdk.gatedFile.verifyKey(key, keyHash)) {
            throw new Error(`${caller}: stored key for ${keyHash} fails its hash check; refusing to publish`);
        }
    } else {
        const generated = sdk.gatedFile.generateKey();
        key = generated.key;
        keyHash = generated.keyHash;
    }

    // --- Encrypt ----------------------------------------------------------
    const plaintext = Buffer.from(opts.plainData, 'binary');
    const ciphertext = sdk.gatedFile.encryptWithKey(plaintext, key); // [iv][tag][ct]
    const handoffPayload = sdk.gatedFile.serializeKeyPayload([key]); // 0x01 || K
    const handoff = sdk.messaging.eciesEncryptBytes(handoffPayload, source.publicKey);

    // --- Persist K before anything can be broadcast ----------------------
    await opts.vault.gatedKeys.put(createGatedKey({
        walletId: opts.walletId,
        chainId: opts.chainId,
        gateTicker: gate,
        keyHash,
        keyHex: key.toString('hex'),
        source: 'published',
    }));

    // --- Compose the atomic BATCH ----------------------------------------
    const fileCmd = [
        'FILE', '0',
        opts.name.trim(),
        opts.type.trim(),
        typeof opts.title === 'string' ? opts.title.trim() : '',
        typeof opts.memo === 'string' ? opts.memo : '',
        gate,
        '1', // ENCRYPTION_METHOD: AES-256-GCM (the only accepted value, indexer file.js)
        keyHash,
    ].join('|');
    const messageCmd = ['MESSAGE', '2', coin, source.address, handoff.ciphertext].join('|');

    const actionData = {
        action: 'BATCH',
        params: { VERSION: '0', COMMAND: `${fileCmd};${messageCmd}` },
    };
    const encoderOpts = {
        pubkey: source.publicKey,
        rawData: ciphertext.toString('binary'),
        ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
    };

    return { source, actionData, encoderOpts, keyHash, ciphertextLength: ciphertext.length };
}

/**
 * Sign-and-broadcast path (software + HW signers; submitAction routes
 * on opts.signer the same way fileAction does).
 *
 * @param {GatedPublishOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult & { keyHash: string }>}
 */
export async function gatedPublishAction(opts) {
    const { source, actionData, encoderOpts, keyHash, ciphertextLength } =
        await prepareGatedPublish(opts, 'gatedPublishAction');

    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `Publish gated file ${opts.name.trim()} (${ciphertextLength} bytes, gate ${opts.gateTicker.trim().toUpperCase()})`,
    };

    const result = await submitAction({
        vault: opts.vault,
        walletId: opts.walletId,
        password: opts.password,
        signer: opts.signer,
        bip39Passphrase: opts.bip39Passphrase,
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        actionData,
        encoderOpts,
        signingPaths: [source.derivationPath
            ? { inputIndex: 0, path: source.derivationPath }
            : { inputIndex: 0, addressId: source.addressId }],
        pendingTxMeta,
        waitForTxid: opts.waitForTxid,
        waitOpts: opts.waitOpts,
        onProgress: opts.onProgress,
    });
    return { ...result, keyHash };
}

/**
 * Watcher-mode encode-only path: same composition, returns an unsigned
 * PSBT request instead of signing. K still lands in THIS wallet's
 * vault (the watcher is the wallet that owns the pack going forward;
 * the paired signer only signs).
 *
 * @param {GatedPublishOpts} opts
 * @returns {Promise<object & { keyHash: string }>}
 */
export async function buildGatedPublishPsbtRequest(opts) {
    const { actionData, encoderOpts, keyHash } =
        await prepareGatedPublish(opts, 'buildGatedPublishPsbtRequest');
    const psbt = await buildActionPsbt({
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        from: opts.from,
        actionData,
        encoderOpts,
    });
    return { ...psbt, keyHash };
}
