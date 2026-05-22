// dispenserAction — convenience wrapper for the DISPENSER action
// (§40.7; protocol docs: xchain-documentation/protocol/actions/
// DISPENSER.md). Mirrors broadcastAction: takes vault + registries +
// chain + source address + DISPENSER params, forwards to submitAction.
//
// DISPENSER has three lanes:
//   v0 Create — open a new dispenser (GIVE_* + GET_* fields).
//   v1 Cancel — close an existing dispenser via DISPENSER_ACTION_INDEX.
//   v2 Edit   — refill / reschedule / update lists via DISPENSER_ACTION_INDEX.
//
// The SDK validator enforces version-specific field requirements (see
// xchain-sdk@1.8.1's _validateDispenser). This flow only guards the
// baseline shape so bad callers get a loud error before we hit the
// signer — SDK validation is the authoritative rule set.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} DispenserActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {Record<string, string>} params    DISPENSER field map (VERSION + create / cancel / edit fields)
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * @param {DispenserActionOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function dispenserAction(opts) {
    if (!opts) throw new Error('dispenserAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('dispenserAction: params is required');
    }
    const version = typeof opts.params.VERSION === 'string' ? opts.params.VERSION : '0';
    const isIndexOp = typeof opts.params.DISPENSER_ACTION_INDEX === 'string'
        && opts.params.DISPENSER_ACTION_INDEX.length > 0;

    if (!isIndexOp) {
        // Create mode — match the SDK validator's baseline: GIVE_TICK +
        // GIVE_AMOUNT + GET_AMOUNT + one of (GET_TICK, GET_COIN).
        if (typeof opts.params.GIVE_TICK !== 'string' || opts.params.GIVE_TICK.length === 0) {
            throw new Error('dispenserAction: params.GIVE_TICK is required for create');
        }
        if (typeof opts.params.GIVE_AMOUNT !== 'string' || opts.params.GIVE_AMOUNT.length === 0) {
            throw new Error('dispenserAction: params.GIVE_AMOUNT is required for create');
        }
        if (typeof opts.params.GET_AMOUNT !== 'string' || opts.params.GET_AMOUNT.length === 0) {
            throw new Error('dispenserAction: params.GET_AMOUNT is required for create');
        }
        const hasGetTick = typeof opts.params.GET_TICK === 'string' && opts.params.GET_TICK.length > 0;
        const hasGetCoin = typeof opts.params.GET_COIN === 'string' && opts.params.GET_COIN.length > 0;
        if (!hasGetTick && !hasGetCoin) {
            throw new Error('dispenserAction: params.GET_TICK (token-paid) or params.GET_COIN (coin-paid) is required for create');
        }
    } else if (version !== '1' && version !== '2') {
        // DISPENSER_ACTION_INDEX is only valid with v1 (cancel) / v2 (edit).
        throw new Error('dispenserAction: DISPENSER_ACTION_INDEX requires VERSION 1 or 2');
    }

    const source = normalizeSource(opts.from, 'dispenserAction');

    const giveTick = opts.params.GIVE_TICK;
    const giveAmount = opts.params.GIVE_AMOUNT;
    const giveEscrow = opts.params.GIVE_ESCROW;
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: opts.params.GET_ADDRESS || null,
        actionSummary: isIndexOp
            ? (version === '1'
                ? `Cancel dispenser #${opts.params.DISPENSER_ACTION_INDEX}`
                : `Edit dispenser #${opts.params.DISPENSER_ACTION_INDEX}`)
            : `Open dispenser: ${giveAmount} ${giveTick} per fill (escrow ${giveEscrow || '?'})`,
    };

    return submitAction({
        vault: opts.vault,
        walletId: opts.walletId,
        password: opts.password,
        bip39Passphrase: opts.bip39Passphrase,
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        actionData: { action: 'DISPENSER', params: opts.params },
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
