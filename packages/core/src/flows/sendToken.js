// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// sendToken: convenience wrapper for the SEND action (§Phase 1
// authoring surface; protocol docs: xchain-documentation/protocol/
// actions/SEND.md). Maps JS-friendly params to the protocol's
// uppercase field names and forwards to submitAction.
//
// PC-52: pass `legs` for a multi-destination / multi-tick SEND
// (protocol formats v1–v3). The flat to/tick/amount call shape stays
// the single-recipient case and still emits a byte-identical v0.
// flows/sendLegs.js owns the shaping and the two refusals (native coin,
// gated ticks) so every SEND-composing path makes the same call.

import { submitAction } from './submitAction.js';
import { isValidAddressForChain } from '../shared/utils/addressValidation.js';
import { nativePaymentOutput } from './nativePayment.js';
import { prepareGatedSend } from './gatedSendGuard.js';
import {
    assertMultiSendSupported,
    assertNoGatedLegs,
    buildSendParams,
    normalizeSendLegs,
    summarizeSendLegs,
} from './sendLegs.js';

/**
 * Fail closed on a destination that isn't a valid address for the chain this
 * action will be broadcast on. The UI validates too, but this is the flow every
 * caller shares, including the dApp bridge (`bridge.signAction`), which builds a
 * SEND straight from site-supplied params and never passes through the Send
 * form. A wrong-coin, wrong-network, or typo'd destination is an unspendable
 * output, so the tokens are unrecoverable: refuse to build the PSBT instead.
 *
 * Skipped when the chain isn't in the registry, which is submitAction's error
 * to raise, not ours.
 *
 * @param {string} fnName
 * @param {string} address
 * @param {import('../registry/index.js').ChainRegistry} chainRegistry
 * @param {string} chainId
 */
export function assertValidDestination(fnName, address, chainRegistry, chainId) {
    const descriptor = chainRegistry?.get?.(chainId);
    if (!descriptor?.coin || !descriptor?.networkKind) return;
    if (!isValidAddressForChain(address, descriptor.coin, descriptor.networkKind)) {
        throw new Error(
            `${fnName}: "${address}" is not a valid ${descriptor.coin} ${descriptor.networkKind} address`,
        );
    }
}

/**
 * @typedef {Object} SourceRef
 * @property {string} address
 * @property {string} publicKey                  hex, compressed (SDK expects this form)
 * @property {string | null} [derivationPath]    HD path; null/omitted for imported-WIF
 * @property {string} [addressId]                Address record id; required when derivationPath is null
 */

/**
 * @typedef {Object} SendTokenOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} [password]                     required for software wallets; omit when `signer` is supplied
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {SourceRef | import('../schemas/address.js').Address} from   source address (Address record or explicit triple)
 * @property {string} to                              DESTINATION
 * @property {string} tick                           TICK (or `^<id>` for TICK_ID)
 * @property {string | number} amount                 AMOUNT
 * @property {string} [memo]                          MEMO (protocol rejects `|` or `;`)
 * @property {import('./sendLegs.js').SendLeg[]} [legs]   PC-52 multi-recipient / multi-tick SEND (v1–v3). Supersedes to/tick/amount/memo, which then act as per-leg defaults. Two or more legs refuse native-coin and gated ticks (see flows/sendLegs.js).
 * @property {number} [fee]                           absolute sats
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {import('../sdk/submitWithSigner.js').PrebuiltPsbt} [prebuiltPsbt]   single-encode pipeline: sign this exact composed PSBT byte-identically (the one the ConfirmActionModal previewed + tamper-checked) instead of rebuilding.
 * @property {import('../signers/Signer.js').Signer} [signer]    pre-built signer (RemoteSigner for HW)
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {(entry: { signedTxHex: string, txid: string, chainId: string, signedAt: number, summary: string, error: string }) => void | Promise<void>} [onBroadcastFailure]   Cluster G FOLLOWUP 1; passes through to submitAction.
 */

/**
 * @param {SendTokenOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function sendToken(opts) {
    if (!opts) throw new Error('sendToken: opts is required');
    const { legs, isMulti } = normalizeSendLegs(opts, 'sendToken');
    const descriptor = opts.chainRegistry?.get?.(opts.chainId);
    assertMultiSendSupported({ legs, descriptor });
    for (const leg of legs) {
        assertValidDestination('sendToken', leg.to, opts.chainRegistry, opts.chainId);
    }
    const source = normalizeSource(opts.from, 'sendToken');
    // Refused rather than half-composed: a gated tick needs one key handoff per
    // recipient, which only the single-recipient path builds. No-op for one leg.
    if (isMulti && !opts.prebuiltPsbt) {
        await assertNoGatedLegs({
            sdkRegistry: opts.sdkRegistry,
            chainRegistry: opts.chainRegistry,
            chainId: opts.chainId,
            legs,
        });
    }

    const params = buildSendParams(legs);

    // PC-26: a tick with active gated content must send as
    // BATCH(SEND, MESSAGE-with-key) or the indexer rejects it. The guard
    // rewrites actionData when it applies and throws typed errors when the
    // send cannot be composed validly (no keys / recipient has no pubkey).
    // Skipped on the prebuilt path: the  confirm pipeline already ran
    // it at compose time and these bytes must not be rebuilt. Multi-leg sends
    // never reach it (assertNoGatedLegs refused any gated tick above).
    let actionData = { action: 'SEND', params };
    let gatedPlan = null;
    if (!opts.prebuiltPsbt && !isMulti) {
        gatedPlan = await prepareGatedSend({
            sdkRegistry: opts.sdkRegistry,
            chainRegistry: opts.chainRegistry,
            vault: opts.vault,
            walletId: opts.walletId,
            chainId: opts.chainId,
            source,
            to: legs[0].to,
            tick: legs[0].tick,
            amount: legs[0].amount,
            memo: legs[0].memo,
        });
        if (gatedPlan) actionData = gatedPlan.actionData;
    }

    const gatedTail = gatedPlan ? ' + gated unlock key handoff' : '';
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: legs[0].to,
        actionSummary: `${summarizeSendLegs(legs)}${gatedTail}`,
    };

    // D-9: a native-coin send must pay the recipient a real output; the SEND
    // OP_RETURN alone moves no value. Append the destination payment to
    // customOutputs (submitAction's ADS fold appends the donation after, so this
    // survives). Token sends return null and are unchanged. This is the atomic
    // (non-prebuilt) path; the confirm-modal path handles it in composeForConfirm.
    // Single leg only: a native tick can never be multi-leg (refused above), so
    // there is exactly one destination to pay here.
    const nativeOut = nativePaymentOutput({
        tick: legs[0].tick,
        amount: legs[0].amount,
        destination: legs[0].to,
        descriptor,
    });

    return submitAction({
        vault: opts.vault,
        walletId: opts.walletId,
        password: opts.password,
        bip39Passphrase: opts.bip39Passphrase,
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        actionData,
        encoderOpts: {
            pubkey: source.publicKey,
            // D-7 (atomic/HW path parity): the spender address is both the change
            // sink and the funding source, so it goes in twice on purpose.
            // `change` supplies the change output; `sourceAddress` is what makes
            // the SDK pre-select UTXOs by address. Both are required - the SDK
            // states outright that `change` is "deliberately NOT a fallback" for
            // `sourceAddress` (xchain-sdk/src/encoder.js createTx), because a
            // change address is not always the spender. Passing only `change` left
            // the encoder resolving UTXOs from the raw `pubkey`, which is the
            // opaque "has no matching Script" failure this comment used to claim
            // was handled.
            change: source.address,
            sourceAddress: source.address,
            ...(nativeOut ? { customOutputs: [nativeOut] } : {}),
            ...(opts.fee !== undefined && { fee: opts.fee }),
            ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
            ...(opts.rbf !== undefined && { rbf: opts.rbf }),
        },
        prebuiltPsbt: opts.prebuiltPsbt,
        signingPaths: [source.derivationPath
            ? { inputIndex: 0, path: source.derivationPath }
            : { inputIndex: 0, addressId: source.addressId }],
        signer: opts.signer,
        pendingTxMeta,
        waitForTxid: opts.waitForTxid,
        waitOpts: opts.waitOpts,
        onProgress: opts.onProgress,
        onBroadcastFailure: opts.onBroadcastFailure,
    });
}

/**
 * Normalize the `from` argument to a SourceRef. Accepts either an
 * Address schema record (including imported-WIF addresses from a
 * wif-only wallet or HD+imported) or a plain object with the same
 * fields. Shared by sendToken and sweepToken.
 *
 * HD source: needs `address`, `publicKey`, `derivationPath`.
 * Imported-WIF source: needs `address`, `publicKey`, plus `addressId`
 * (the Address record id; the signer resolves the WIF from
 * `Wallet.importedKeys[addressId]`). Watch-only addresses are rejected.
 *
 * @param {unknown} from
 * @param {string} fnName
 * @returns {SourceRef}
 */
export function normalizeSource(from, fnName = 'flow') {
    if (!from || typeof from !== 'object') {
        throw new Error(`${fnName}: from is required`);
    }
    const source = /** @type {SourceRef & { source?: string, id?: string }} */ (from);
    const { address, publicKey, derivationPath } = source;
    if (typeof address !== 'string' || address.length === 0) {
        throw new Error(`${fnName}: from.address must be a non-empty string`);
    }
    if (typeof publicKey !== 'string' || publicKey.length === 0) {
        throw new Error(`${fnName}: from.publicKey must be a non-empty string`);
    }
    if (source.source === 'watch-only') {
        throw new Error(
            `${fnName}: from.source = "watch-only"; this address has no signer`,
        );
    }
    // HW sources ('trezor' / 'ledger') are valid here. The caller is
    // expected to supply a pre-built RemoteSigner via submitAction's
    // `signer` param so the action flow routes signing over the
    // renderer↔background bridge instead of the password-unlock path.
    if (typeof derivationPath === 'string' && derivationPath.length > 0) {
        return { address, publicKey, derivationPath };
    }
    // Imported-WIF path. `addressId` is required and taken from the
    // Address record's `id` field (which is what the Address schema
    // puts there), or from an explicit `addressId` on a plain triple.
    const addressId = typeof source.addressId === 'string' && source.addressId.length > 0
        ? source.addressId
        : (typeof source.id === 'string' && source.id.length > 0 ? source.id : null);
    if (!addressId) {
        throw new Error(
            `${fnName}: from.derivationPath is null; imported-WIF source must include an addressId (Address record's id)`,
        );
    }
    return { address, publicKey, derivationPath: null, addressId };
}
