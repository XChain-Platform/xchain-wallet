// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// sweepToken: convenience wrapper for the SWEEP action (xchain-
// documentation/protocol/actions/SWEEP.md). Sweeps token balances and/or
// ownerships from the source address to a destination, and optionally
// closes open ORDERs / SWAPs / DISPENSERs and routes their escrowed
// balance/ownership to the destination. Protocol defaults per the docs:
// balances=1, ownerships=1, orders=0, swaps=0, dispensers=0; we mirror
// those in JavaScript booleans.
//
// Only protocol format v0 is supported; callers needing finer control
// can drop to submitAction directly.

import { submitAction } from './submitAction.js';
import { assertValidDestination, normalizeSource } from './sendToken.js';
import { disableAutopayForAddress } from './autopayConsent.js';

/**
 * @typedef {Object} SweepTokenOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {string} to                                DESTINATION
 * @property {boolean} [balances]                       default true; sweeps TICK balances
 * @property {boolean} [ownerships]                      default true; sweeps TICK ownerships
 * @property {boolean} [orders]                          default false; cancels open ORDERs and routes escrow to destination
 * @property {boolean} [swaps]                           default false; cancels open SWAPs and routes escrow to destination
 * @property {boolean} [dispensers]                      default false; closes open DISPENSERs and routes escrow to destination
 * @property {string} [memo]
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {import('../sdk/submitWithSigner.js').PrebuiltPsbt} [prebuiltPsbt]   single-encode pipeline: sign this exact composed PSBT byte-identically (the one the confirm page previewed + tamper-checked) instead of rebuilding.
 * @property {{ releaseByAddress?: (chainId: string, address: string) => Promise<number> }} [reservationLedger]  PC-34 force-close interplay: when ORDERS=1 broadcasts, release this address's auto-pay holds (host passes its shared  ledger).
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 */

/**
 * @param {SweepTokenOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function sweepToken(opts) {
    if (!opts) throw new Error('sweepToken: opts is required');
    if (!opts.to) throw new Error('sweepToken: to is required');
    // A SWEEP moves every balance and ownership at once, so a bad destination
    // costs the whole address rather than one send's worth.
    assertValidDestination('sweepToken', opts.to, opts.chainRegistry, opts.chainId);
    const source = normalizeSource(opts.from, 'sweepToken');

    const balances = opts.balances ?? true;
    const ownerships = opts.ownerships ?? true;
    const orders = opts.orders ?? false;
    const swaps = opts.swaps ?? false;
    const dispensers = opts.dispensers ?? false;
    if (!balances && !ownerships && !orders && !swaps && !dispensers) {
        throw new Error(
            'sweepToken: at least one of balances / ownerships / orders / swaps / dispensers must be true (SWEEP with every flag disabled is a no-op)',
        );
    }

    // Protocol encodes booleans as '1'/'0' strings in the action string;
    // the SDK validator/formatter takes these as strings directly. Field
    // order follows SWEEP v0:
    // DESTINATION|BALANCES|OWNERSHIPS|ORDERS|SWAPS|DISPENSERS|MEMO.
    /** @type {Record<string, string>} */
    const params = {
        DESTINATION: opts.to,
        BALANCES: balances ? '1' : '0',
        OWNERSHIPS: ownerships ? '1' : '0',
        ORDERS: orders ? '1' : '0',
        SWAPS: swaps ? '1' : '0',
        DISPENSERS: dispensers ? '1' : '0',
    };
    if (opts.memo !== undefined) params.MEMO = opts.memo;

    const flags = [];
    if (balances) flags.push('balances');
    if (ownerships) flags.push('ownerships');
    if (orders) flags.push('orders');
    if (swaps) flags.push('swaps');
    if (dispensers) flags.push('dispensers');
    const memoTail = opts.memo ? ` (memo: "${opts.memo}")` : '';
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: opts.to,
        actionSummary: `Sweep ${flags.join(' + ')} to ${opts.to}${memoTail}`,
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
        actionData: { action: 'SWEEP', params },
        prebuiltPsbt: opts.prebuiltPsbt,
        encoderOpts: {
            pubkey: source.publicKey,
            ...(opts.fee !== undefined && { fee: opts.fee }),
            ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
            ...(opts.rbf !== undefined && { rbf: opts.rbf }),
            // PC-51: opt-in native-coin protocol fee (quotable action); submitAction's
            // preflight refuses at sign time (NativeFeeForfeitError) if unpriceable.
            ...(opts.payFeeInNativeCoin !== undefined && { payFeeInNativeCoin: opts.payFeeInNativeCoin }),
        },
        signingPaths: [source.derivationPath
            ? { inputIndex: 0, path: source.derivationPath }
            : { inputIndex: 0, addressId: source.addressId }],
        pendingTxMeta,
        waitForTxid: opts.waitForTxid,
        waitOpts: opts.waitOpts,
        onProgress: opts.onProgress,
    });

    // PC-34 force-close interplay: ORDERS=1 cancels every open ORDER
    // from the source on this chain, so its auto-pay consents flip to
    // notify-only and any address-tagged reservation holds release.
    // Best-effort AFTER a confirmed broadcast: a cleanup failure must
    // never fail (or roll back) a sweep the chain already accepted -
    // the surviving consents only ever cause a manual-pay notification
    // (the engine's caps re-verify against the match either way).
    const broadcastTxid = result?.txid || result?.broadcast?.txid || null;
    if (orders && broadcastTxid) {
        const cleanup = { autopayDisabled: 0, holdsReleased: 0, error: null };
        try {
            const disabled = await disableAutopayForAddress({
                vault: opts.vault,
                walletId: opts.walletId,
                chainId: opts.chainId,
                sourceAddress: source.address,
            });
            cleanup.autopayDisabled = disabled.length;
            if (opts.reservationLedger?.releaseByAddress) {
                cleanup.holdsReleased = await opts.reservationLedger
                    .releaseByAddress(opts.chainId, source.address) || 0;
            }
        } catch (e) {
            cleanup.error = e?.message || String(e);
        }
        return { ...result, forceClose: cleanup };
    }
    return result;
}
