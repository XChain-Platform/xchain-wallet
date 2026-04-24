// messageAction — convenience wrapper for the MESSAGE action (§41.7.3;
// protocol docs: xchain-documentation/protocol/actions/MESSAGE.md).
// Handles ECIES encryption before signing: looks up the recipient's
// pubkey via the SDK explorer client, encrypts in-process, builds
// MESSAGE v2 (encrypted body), and routes through submitAction.
//
// When the recipient has no on-chain pubkey yet (no XChain tx from
// that address is indexed), ECIES encryption is impossible. The
// caller can fall back to MESSAGE v3 (plaintext) by passing
// `method: null` — that skips the pubkey lookup and builds the
// unencrypted format. The caller is responsible for presenting this
// as a warning in the UI per spec §41.7.3.
//
// MESSAGE format summary (from xchain-sdk formats.js):
//   v0: ECDH key-exchange request
//   v1: ECDH key-exchange response
//   v2: `VERSION|COIN|DESTINATION|ENCRYPTED_MESSAGE` — encrypted body
//   v3: `VERSION|COIN|DESTINATION|PLAINTEXT_MESSAGE` — unencrypted
//
// Phase 3 Step 13 uses v2 (ECIES) or v3 (plaintext fallback); v0 and
// v1 are ECDH session-setup and out of Phase 3 scope.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendAsset.js';

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

export class PubkeyNotFoundError extends Error {
    /** @param {string} address */
    constructor(address) {
        super(`messageAction: no public key indexed for ${address} — recipient must have sent at least one XChain transaction before you can send them an ECIES-encrypted message.`);
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
 * @property {string} chainId
 * @property {import('./sendAsset.js').SourceRef | import('../schemas/address.js').Address} from
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

    const descriptor = opts.chainRegistry.get(opts.chainId);
    if (!descriptor) throw new Error(`messageAction: unknown chain "${opts.chainId}"`);
    const coin = PROTOCOL_COIN_TICKER[descriptor.coin];
    if (!coin) throw new Error(`messageAction: no protocol coin ticker for "${descriptor.coin}"`);

    const source = normalizeSource(opts.from, 'messageAction');
    const sdk = opts.sdkRegistry.get(opts.chainId);
    const method = opts.method === null ? null : 1;

    /** @type {Record<string, string>} */
    let params;
    if (method === null) {
        params = {
            VERSION: '3',
            COIN: coin,
            DESTINATION: opts.destination,
            PLAINTEXT_MESSAGE: opts.message,
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
 * Pubkey query flow — wraps `sdk.getPublicKey`. Used by compose
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
