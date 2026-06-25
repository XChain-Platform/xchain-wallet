// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// messageAction: convenience wrapper for the MESSAGE action (§41.7.3;
// protocol docs: xchain-documentation/protocol/actions/MESSAGE.md).
// Handles ECIES encryption before signing: looks up the recipient's
// pubkey via the SDK explorer client, encrypts in-process, builds
// MESSAGE v2 (encrypted body), and routes through submitAction.
//
// When the recipient has no on-chain pubkey yet (no XChain tx from
// that address is indexed), ECIES encryption is impossible. The
// caller can fall back to MESSAGE v3 (plaintext) by passing
// `method: null` skips the pubkey lookup and builds the
// unencrypted format. The caller is responsible for presenting this
// as a warning in the UI per spec §41.7.3.
//
// MESSAGE format summary (from xchain-sdk formats.js):
//   v0: ECDH key-exchange request
//   v1: ECDH key-exchange response
//   v2: `VERSION|COIN|DESTINATION|ENCRYPTED_MESSAGE` (encrypted body)
//   v3: `VERSION|COIN|DESTINATION|PLAINTEXT_MESSAGE` (unencrypted)
//
// Supported sends: v2 ECIES (method 1), v2 ECDH session (method 2), and
// v3 plaintext (method null). ECDH derives a deterministic shared secret
// from our key + the recipient's address pubkey, so it needs our private key
// at compose time and therefore can't be sent from a hardware signer. The
// v0/v1 ECDH key-exchange handshake (publishing a pubkey) is separate and not
// handled here.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';
import { exportPrivateKey } from './exportPrivateKey.js';

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

export class PubkeyNotFoundError extends Error {
    /** @param {string} address */
    constructor(address) {
        super(`messageAction: no public key indexed for ${address}. The recipient must have sent at least one XChain transaction before you can send them an ECIES-encrypted message.`);
        this.name = 'PubkeyNotFoundError';
        this.address = address;
    }
}

/**
 * @typedef {Object} MessageActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId               destination/COIN chain (recipient's network)
 * @property {string} [broadcastChainId]    chain that funds + broadcasts the tx; defaults to chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {string} destination     recipient address
 * @property {string} message         plaintext message body
 * @property {1 | null} [method]      1=ECIES (default), null=plaintext fallback
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * @param {MessageActionOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function messageAction(opts) {
    if (!opts) throw new Error('messageAction: opts is required');
    if (typeof opts.destination !== 'string' || opts.destination.length === 0) {
        throw new Error('messageAction: destination is required');
    }
    if (typeof opts.message !== 'string' || opts.message.length === 0) {
        throw new Error('messageAction: message is required');
    }

    // The MESSAGE wire format separates the destination's network (COIN) from
    // the chain the transaction is broadcast on. Per protocol/actions/MESSAGE.md:
    // "messages can be broadcast on any chain regardless of the destination's
    // chain (e.g. send a message to a BTC address via the DOGE network for
    // cheaper/faster transactions)". So `chainId` is the destination/COIN chain
    // (it sets COIN and is where the recipient's pubkey is resolved), while
    // `broadcastChainId` (defaulting to it) funds the tx and pays the fee.
    const descriptor = opts.chainRegistry.get(opts.chainId);
    if (!descriptor) throw new Error(`messageAction: unknown chain "${opts.chainId}"`);
    const coin = PROTOCOL_COIN_TICKER[descriptor.coin];
    if (!coin) throw new Error(`messageAction: no protocol coin ticker for "${descriptor.coin}"`);
    const broadcastChainId = opts.broadcastChainId || opts.chainId;
    if (!opts.chainRegistry.get(broadcastChainId)) {
        throw new Error(`messageAction: unknown broadcast chain "${broadcastChainId}"`);
    }

    // `from` is an address on the broadcast chain (it provides the funding
    // UTXOs and signs). `sdk` targets the destination chain: it resolves the
    // recipient's pubkey and provides the (chain-agnostic) encryption helpers.
    const source = normalizeSource(opts.from, 'messageAction');
    const sdk = opts.sdkRegistry.get(opts.chainId);
    // method: null = plaintext (v3), 1 = ECIES (v2), 2 = ECDH session (v2).
    const method = opts.method === null ? null : (opts.method === 2 ? 2 : 1);

    // Resolve our own WIF for the source address. ECDH needs our private key to
    // derive the shared secret at compose time (ECIES needs only the
    // recipient's public key). Mirrors the inbox's resolution: an injected
    // software signer, otherwise a password-based export. Hardware signers
    // never expose the key, so ECDH can't be sent from them.
    async function resolveSourceWif() {
        if (opts.signer) {
            if (typeof opts.signer.exportWifForPath !== 'function') {
                throw new Error(
                    'ECDH (shared-key) messages cannot be sent from a hardware wallet, which never exposes the private key needed to derive the shared secret. Use standard (ECIES) encryption instead.',
                );
            }
            return source.derivationPath
                ? opts.signer.exportWifForPath({ chainId: broadcastChainId, path: source.derivationPath })
                : opts.signer.exportWifForAddressId(source.addressId);
        }
        const addressId = (opts.from && (opts.from.id || opts.from.addressId)) || source.addressId;
        if (!addressId) {
            throw new Error('messageAction: ECDH send needs an addressId to derive the key.');
        }
        const exported = await exportPrivateKey({
            vault: opts.vault,
            walletId: opts.walletId,
            password: opts.password,
            bip39Passphrase: opts.bip39Passphrase,
            chainRegistry: opts.chainRegistry,
            sdkRegistry: opts.sdkRegistry,
            addressId,
        });
        return exported.wif;
    }

    /** @type {Record<string, string>} */
    let params;
    if (method === null) {
        params = {
            VERSION: '3',
            COIN: coin,
            DESTINATION: opts.destination,
            PLAINTEXT_MESSAGE: opts.message,
        };
    } else if (method === 2) {
        // ECDH: derive the deterministic shared secret from our key + the
        // recipient's address pubkey, then AES-GCM session-encrypt. Same v2
        // wire shape as ECIES (no method/key on the wire).
        const pubkey = await sdk.getPublicKey(opts.destination);
        if (!pubkey) throw new PubkeyNotFoundError(opts.destination);
        const wif = await resolveSourceWif();
        const { sharedSecret } = sdk.messaging.deriveSharedSecret(wif, pubkey);
        const encrypted = sdk.messaging.sessionEncrypt(opts.message, sharedSecret);
        params = {
            VERSION: '2',
            COIN: coin,
            DESTINATION: opts.destination,
            ENCRYPTED_MESSAGE: encrypted.ciphertext,
        };
    } else {
        const pubkey = await sdk.getPublicKey(opts.destination);
        if (!pubkey) throw new PubkeyNotFoundError(opts.destination);
        const encrypted = sdk.messaging.eciesEncrypt(opts.message, pubkey);
        params = {
            VERSION: '2',
            COIN: coin,
            DESTINATION: opts.destination,
            ENCRYPTED_MESSAGE: encrypted.ciphertext,
        };
    }

    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: opts.destination,
        actionSummary: method === null
            ? `Send plaintext message to ${opts.destination}`
            : `Send encrypted message to ${opts.destination}`,
    };

    return submitAction({
        vault: opts.vault,
        walletId: opts.walletId,
        password: opts.password,
        signer: opts.signer,
        bip39Passphrase: opts.bip39Passphrase,
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: broadcastChainId,
        actionData: { action: 'MESSAGE', params },
        encoderOpts: {
            pubkey: source.publicKey,
            ...(opts.fee !== undefined && { fee: opts.fee }),
            ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
            ...(opts.rbf !== undefined && { rbf: opts.rbf }),
        },
        signingPaths: [source.derivationPath
            ? { inputIndex: 0, path: source.derivationPath }
            : { inputIndex: 0, addressId: source.addressId }],
        pendingTxMeta,
        waitForTxid: opts.waitForTxid,
        waitOpts: opts.waitOpts,
        onProgress: opts.onProgress,
    });
}

/**
 * Publish an ECDH key-exchange handshake (MESSAGE format 0 = request, 1 =
 * response). It broadcasts our address pubkey (the ECDH "session key") in
 * ENCRYPTION_KEY so the counterparty can derive the shared secret and send us
 * encrypted messages, even before our address has spent (which would otherwise
 * reveal the pubkey). No message body and no encryption: just key publication,
 * so it works from hardware signers too.
 *
 * @param {object} opts  same plumbing as messageAction (vault/walletId/
 *   password/signer/bip39Passphrase/chainRegistry/sdkRegistry/chainId/from/
 *   fee/feePerKb/rbf/waitForTxid/trackPendingTx/onProgress), plus:
 * @param {string} opts.destination   counterparty address
 * @param {0 | 1} [opts.version]      0 = request (default), 1 = response
 * @returns {Promise<import('./submitAction.js').SubmitResult>}
 */
export async function handshakeAction(opts) {
    if (!opts) throw new Error('handshakeAction: opts is required');
    if (typeof opts.destination !== 'string' || opts.destination.length === 0) {
        throw new Error('handshakeAction: destination is required');
    }
    const version = opts.version === 1 ? 1 : 0;

    const descriptor = opts.chainRegistry.get(opts.chainId);
    if (!descriptor) throw new Error(`handshakeAction: unknown chain "${opts.chainId}"`);
    const coin = PROTOCOL_COIN_TICKER[descriptor.coin];
    if (!coin) throw new Error(`handshakeAction: no protocol coin ticker for "${descriptor.coin}"`);

    const source = normalizeSource(opts.from, 'handshakeAction');
    const params = {
        // VERSION selects format 0 vs 1 (identical field shapes; the encoder's
        // FormatSelector picks the version from this explicit value).
        VERSION: String(version),
        COIN: coin,
        DESTINATION: opts.destination,
        ENCRYPTION_METHOD: '2',
        ENCRYPTION_KEY: source.publicKey,
    };

    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: opts.destination,
        actionSummary: version === 0
            ? `Request an encrypted session with ${opts.destination}`
            : `Respond to an encrypted-session request from ${opts.destination}`,
    };

    return submitAction({
        vault: opts.vault,
        walletId: opts.walletId,
        password: opts.password,
        signer: opts.signer,
        bip39Passphrase: opts.bip39Passphrase,
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        actionData: { action: 'MESSAGE', params },
        encoderOpts: {
            pubkey: source.publicKey,
            ...(opts.fee !== undefined && { fee: opts.fee }),
            ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
            ...(opts.rbf !== undefined && { rbf: opts.rbf }),
        },
        signingPaths: [source.derivationPath
            ? { inputIndex: 0, path: source.derivationPath }
            : { inputIndex: 0, addressId: source.addressId }],
        pendingTxMeta,
        waitForTxid: opts.waitForTxid,
        waitOpts: opts.waitOpts,
        onProgress: opts.onProgress,
    });
}

/**
 * Pubkey query flow. Wraps `sdk.getPublicKey`. Used by compose
 * surfaces to preview whether a recipient address has an on-chain
 * pubkey before the user commits to the send.
 *
 * @param {{ sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry, chainId: string, address: string }} params
 * @returns {Promise<string | null>}
 */
export async function getRecipientPubkey({ sdkRegistry, chainId, address }) {
    if (!sdkRegistry) throw new Error('getRecipientPubkey: sdkRegistry is required');
    if (!chainId) throw new Error('getRecipientPubkey: chainId is required');
    if (typeof address !== 'string' || address.length === 0) {
        throw new Error('getRecipientPubkey: address is required');
    }
    const sdk = sdkRegistry.get(chainId);
    return sdk.getPublicKey(address);
}
