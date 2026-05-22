// coinpayAction — convenience wrapper for the COINPAY action (§41.4;
// protocol docs: xchain-documentation/protocol/actions/COINPAY.md).
// Mirrors orderAction: takes vault + registries + chain + source +
// obligation details, forwards to submitAction.
//
// COINPAY is the buyer-side settlement for matched orders that trade a
// token against a native coin (BTC/LTC/DOGE). The match creates a
// coinpay_obligation on the buyer's address; the buyer broadcasts a
// COINPAY transaction carrying both the action data (OP_RETURN
// referencing the ORDER_MATCH action index) and a native-coin output
// paying the seller the amount owed.
//
// The obligation details (payer, payee, coin_amount, order_match
// action index, expiration) come from
// `sdk.getCoinpayObligations(address, 'address')` — the wallet hydrates
// them into the form and passes them through here. Anyone can
// broadcast the COINPAY on the buyer's behalf (the protocol doesn't
// require it to come from the buyer's address), but in practice we
// always sign from the obligation's `payer_address` because that's
// the address the user has keys for.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} CoinpayActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {string} orderMatchActionIndex   ACTION_INDEX of the ORDER_MATCH being paid
 * @property {string} payeeAddress            Address that receives the native-coin output
 * @property {string | number} coinAmount     Native-coin amount in base units (satoshis / litoshis / ...); >= obligation's coin_amount
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * @param {CoinpayActionOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function coinpayAction(opts) {
    if (!opts) throw new Error('coinpayAction: opts is required');
    const actionIndex = opts.orderMatchActionIndex;
    if (typeof actionIndex !== 'string' || actionIndex.length === 0) {
        throw new Error('coinpayAction: orderMatchActionIndex is required');
    }
    if (typeof opts.payeeAddress !== 'string' || opts.payeeAddress.length === 0) {
        throw new Error('coinpayAction: payeeAddress is required');
    }
    const coinAmount = Number(opts.coinAmount);
    if (!Number.isFinite(coinAmount) || coinAmount <= 0) {
        throw new Error('coinpayAction: coinAmount must be a positive number (base units)');
    }
    if (!Number.isInteger(coinAmount)) {
        throw new Error('coinpayAction: coinAmount must be an integer (base units)');
    }

    const source = normalizeSource(opts.from, 'coinpayAction');

    const params = {
        VERSION: '0',
        ORDER_MATCH_ACTION_INDEX: String(actionIndex),
    };

    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: opts.payeeAddress,
        actionSummary:
            `Pay COINPAY: ${coinAmount} (base units) for ORDER_MATCH #${actionIndex}`,
    };

    return submitAction({
        vault: opts.vault,
        walletId: opts.walletId,
        password: opts.password,
        bip39Passphrase: opts.bip39Passphrase,
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        actionData: { action: 'COINPAY', params },
        encoderOpts: {
            pubkey: source.publicKey,
            customOutputs: [
                { address: opts.payeeAddress, value: coinAmount },
            ],
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
