// sweepAsset — convenience wrapper for the SWEEP action (xchain-
// documentation/protocol/actions/SWEEP.md). Transfers all TICK
// balances, ownerships, and/or escrows from the source address to a
// destination. Protocol defaults per the docs: balances=1, ownerships=1,
// escrows=0 — we mirror those in JavaScript booleans.
//
// Only protocol format v0 is supported; if multi-parameter sweeps land
// in a future version, callers can drop to submitAction directly.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendAsset.js';

/**
 * @typedef {Object} SweepAssetOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendAsset.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {string} to                                DESTINATION
 * @property {boolean} [balances]                       default true
 * @property {boolean} [ownerships]                     default true
 * @property {boolean} [escrows]                        default false
 * @property {string} [memo]
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 */

/**
 * @param {SweepAssetOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function sweepAsset(opts) {
    if (!opts) throw new Error('sweepAsset: opts is required');
    if (!opts.to) throw new Error('sweepAsset: to is required');
    const source = normalizeSource(opts.from, 'sweepAsset');

    const balances = opts.balances ?? true;
    const ownerships = opts.ownerships ?? true;
    const escrows = opts.escrows ?? false;
    if (!balances && !ownerships && !escrows) {
        throw new Error(
            'sweepAsset: at least one of balances / ownerships / escrows must be true — SWEEP with all three disabled is a no-op',
        );
    }

    // Protocol encodes booleans as '1'/'0' strings in the action string;
    // the SDK validator/formatter takes these as strings directly.
    /** @type {Record<string, string>} */
    const params = {
        DESTINATION: opts.to,
        BALANCES: balances ? '1' : '0',
        OWNERSHIPS: ownerships ? '1' : '0',
        ESCROWS: escrows ? '1' : '0',
    };
    if (opts.memo !== undefined) params.MEMO = opts.memo;

    const flags = [];
    if (balances) flags.push('balances');
    if (ownerships) flags.push('ownerships');
    if (escrows) flags.push('escrows');
    const memoTail = opts.memo ? ` — "${opts.memo}"` : '';
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: opts.to,
        actionSummary: `Sweep ${flags.join(' + ')} to ${opts.to}${memoTail}`,
    };

    return submitAction({
        vault: opts.vault,
        walletId: opts.walletId,
        password: opts.password,
        bip39Passphrase: opts.bip39Passphrase,
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        actionData: { action: 'SWEEP', params },
        encoderOpts: {
            pubkey: source.publicKey,
            ...(opts.fee !== undefined && { fee: opts.fee }),
            ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
            ...(opts.rbf !== undefined && { rbf: opts.rbf }),
        },
        signingPaths: [{ inputIndex: 0, path: source.derivationPath }],
        pendingTxMeta,
        waitForTxid: opts.waitForTxid,
        waitOpts: opts.waitOpts,
        onProgress: opts.onProgress,
    });
}
