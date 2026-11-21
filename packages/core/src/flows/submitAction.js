// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// submitAction: convenience wrapper that chains unlockWallet +
// submitWithSigner + signer.lock() for the common "send this one
// action" path. Every UI surface that builds a single transaction (send
// form, sign-dApp-request screen, dispenser purchase, etc.) uses this.
//
// When `pendingTxMeta` is supplied, the flow also maintains a
// PendingTx record (§11.3.8) through the submission lifecycle: created
// at `composing`, advanced on each `submitWithSigner` phase, settled
// to `broadcast` / `indexed` on success or `failed` on error. The
// record is persisted via the provided Vault at every transition, so
// the tx-status timeline (§28.4) and RBF/cancel UX (§44.4) can read
// live state.
//
// For batched submissions under one unlock, use unlockWallet +
// submitWithSigner directly (re-unlocking is expensive with Argon2id).

import { unlockWallet } from './unlockWallet.js';
import { hardwareWalletRecord, refuseHardwareWallet } from './hardwareWallet.js';
import { submitWithSigner, BroadcastFailedError } from '../sdk/submitWithSigner.js';
import { createPendingTx } from '../schemas/pendingTx.js';
import {
    adsReservationOf,
    commitAdsStepWithBooking,
    forgetInFlightAdsReservation,
    isAdsCountedSend,
    newAdsReservationId,
    reconcileAdsReservation,
    releaseAdsReservation,
    reserveAdsPayout,
    resolveAdsPayout,
    returnAdsReservationToReview,
    withAdsAtEncode,
    withoutAdsPayout,
} from './ads.js';
import {
    ADS_DELIVERY_BOOKING_SCOPE, accrueOnlyVerdict, bookLandedCommit, donationRidesCommit,
} from './adsDelivery.js';
import {
    classifyBroadcastFailure,
    BROADCAST_FAILED_PERMANENT_NAME,
    BROADCAST_FAILED_TRANSIENT_NAME,
    BROADCAST_FAILED_TRANSIENT_UNSAVED_NAME,
} from './broadcastPermanence.js';
import { invalidateTokenInfoForAction } from '../shared/utils/tokenInfoCache.js';
import { resolveChangeAddress } from './changeAddress.js';
import { actionDisplayLabel } from '../shared/utils/actionDisplayLabel.js';
import { importedAddressIdsFor } from './_importedAddressIds.js';
import { assertNoOfferCancelInFlight, assertReferencedOfferActionable } from './marketExpiry.js';
import { withDefaultFeePerKb } from './feeEstimate.js';
import { assertSafeActionText } from '../shared/utils/actionTextSafety.js';

/**
 * §4.7: the single-tick debit a SEND moves, for the concurrent-window
 * pending-delta netting (§28.4 pendingTx v2 tick/amount fields). Only a
 * single-leg SEND has an unambiguous token debit; a multi-leg SEND, or any
 * non-SEND action, returns null (nets nothing) - the same conservatism
 * `reserveFromSimulation` applies to the reservation side.
 *
 * @param {{ action?: string, params?: object } | null | undefined} actionData
 * @returns {{ tick: string, amount: string } | null}
 */
export function sendDeltaFromAction(actionData) {
    if (!actionData || actionData.action !== 'SEND') return null;
    const p = actionData.params || {};
    const ticks = [].concat(p.TICK == null ? [] : p.TICK);
    const amounts = [].concat(p.AMOUNT == null ? [] : p.AMOUNT);
    if (ticks.length !== 1 || amounts.length !== 1) return null;
    const tick = String(ticks[0]).trim();
    const amount = String(amounts[0]).trim();
    if (!tick || amount === '') return null;
    return { tick, amount };
}

/**
 * Net native value that leaves the wallet in a built transaction. Inputs are
 * reduced only by outputs returning to an owned address, so change remains in
 * the wallet exactly once while payments and network fees leave immediately.
 *
 * @param {{ inputs?: Array<{value?: unknown}>, outputs?: Array<{value?: unknown, address?: string|null}> }} decomposed
 * @param {Iterable<string>} ownedAddresses
 * @returns {string|null}
 */
export function nativeDebitSatsFromPsbt(decomposed, ownedAddresses) {
    const inputs = Array.isArray(decomposed?.inputs) ? decomposed.inputs : null;
    const outputs = Array.isArray(decomposed?.outputs) ? decomposed.outputs : null;
    if (!inputs || !outputs || inputs.length === 0) return null;
    const exact = (value) => {
        const raw = typeof value === 'bigint' ? value.toString() : String(value ?? '').trim();
        return /^\d+$/.test(raw) ? BigInt(raw) : null;
    };
    const inputValues = inputs.map((input) => exact(input?.value));
    const outputValues = outputs.map((output) => exact(output?.value));
    if (inputValues.some((value) => value === null) || outputValues.some((value) => value === null)) {
        return null;
    }
    let owned;
    try {
        owned = new Set(Array.from(ownedAddresses || []).filter(Boolean));
    } catch {
        return null;
    }
    const totalIn = inputValues.reduce((sum, value) => sum + value, 0n);
    const ownedOut = outputs.reduce((sum, output, index) => (
        output?.address && owned.has(output.address) ? sum + outputValues[index] : sum
    ), 0n);
    const debit = totalIn - ownedOut;
    return debit >= 0n ? debit.toString() : null;
}

/** Names handed over by a queued ownership ORDER or DISPENSER. */
function queuedSoldNames(actionData) {
    if (actionData?.action !== 'ORDER' && actionData?.action !== 'DISPENSER') return [];
    const params = actionData?.params;
    if (!params || Number(params.GIVE_OWNERSHIP || 0) !== 1) return [];
    const tick = typeof params.GIVE_TICK === 'string' ? params.GIVE_TICK.trim() : '';
    return tick ? [tick] : [];
}

/**
 * @typedef {Object} PendingTxMeta
 * @property {string} fromAddress
 * @property {string} toAddress
 * @property {string} actionSummary   §21.1 plain-English summary
 * @property {Array<{tick: string, amount: string}>} [balanceDebits]
 */

/**
 * @typedef {Object} SubmitActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} [password]                    required for software-wallet signing; skipped when `signer` is supplied
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {{ action: string, params: object }} actionData
 * @property {import('../sdk/submitWithSigner.js').SubmitEncoderOpts} encoderOpts
 * @property {import('../sdk/submitWithSigner.js').PrebuiltPsbt} [prebuiltPsbt] single-encode pipeline: sign this exact PSBT (composeForConfirm's output, already previewed + tamper-checked) byte-identically instead of rebuilding it.
 * @property {Array<{ inputIndex: number, path: string, sighashType?: number }>} signingPaths
 * @property {import('../signers/Signer.js').Signer} [signer]   pre-built signer (RemoteSigner for HW). When supplied, the flow skips unlockWallet entirely (no password KDF) and does not call `.lock()` at the end (signer lifecycle is the caller's responsibility).
 * @property {PendingTxMeta} [pendingTxMeta]     when set, the flow persists + updates a PendingTx record
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {(transactions: { signed: object, revealSigned: object | null, psbtHex?: string, finalPsbtHex?: string }) => void | Promise<void>} [beforeBroadcast] awaited after signing and before any broadcast
 * @property {boolean} [verifyBuiltTx]   hold the encoder's PSBT to the confirm pipeline's tamper checks before signing (submitWithSigner)
 * @property {boolean} [scopedPayment]   locked auto pay: build with no rotated change address; it follows the automatic donation rule like every other send
 * @property {boolean} [adsPayout]       default true. False when the screen that approved this send cannot name a donation (the dApp approval window): the send still accrues, but never carries the queued donation
 * @property {(entry: { signedTxHex: string, txid: string, chainId: string, signedAt: number, summary: string, error: string, pendingTxId: string | null, adsCommit: { chainId: string, donationIncluded: boolean, donatedFiat?: string | null, currency?: string | null } | null, commitLanded?: true, commitTxid?: string | null, revealTxHex?: string, revealTxid?: string | null }) => boolean | void | Promise<boolean | void>} [onBroadcastFailure]   Cluster G FOLLOWUP 1: fires when the broadcast leg fails after a successful sign. A two-phase commit's entry carries its signed reveal (`revealTxHex`), which the queue sends right after the commit. The bridge background host resolves false when the entry did not reach §49.5's durable queued-broadcast surface; legacy void callbacks are treated as accepted handoffs.
 */

/**
 * @typedef {Object} SubmitActionResult
 * @property {string} txid
 * @property {string} actionString
 * @property {string} action
 * @property {number | string} [version]
 * @property {string} encoding
 * @property {{ signedPsbtHex: string, txHex: string, txid: string }} signed
 * @property {unknown} indexed
 * @property {string | null} pendingTxId        present when pendingTxMeta was supplied
 */

/**
 * @param {SubmitActionOpts} opts
 * @returns {Promise<SubmitActionResult>}
 */
export async function submitAction({
    vault,
    walletId,
    password,
    bip39Passphrase,
    chainRegistry,
    sdkRegistry,
    chainId,
    actionData,
    encoderOpts,
    prebuiltPsbt,
    signingPaths,
    signer: injectedSigner,
    pendingTxMeta,
    waitForTxid,
    waitOpts,
    onProgress,
    beforeBroadcast,
    onBroadcastFailure,
    verifyBuiltTx = false,
    scopedPayment = false,
    adsPayout = true,
}) {
    assertSafeActionText(actionData);
    if (!injectedSigner && (typeof password !== 'string' || password.length === 0)) {
        // A hardware wallet signs only on its device; no password helps.
        refuseHardwareWallet(await hardwareWalletRecord(vault, walletId), 'signing without it connected');
        throw new Error('submitAction: either `password` or `signer` is required');
    }
    const descriptor = chainRegistry.get(chainId);
    if (!descriptor) throw new Error(`submitAction: unknown chain "${chainId}"`);

    await assertReferencedOfferActionable({ sdkRegistry, chainId, actionData });
    await assertNoOfferCancelInFlight({ vault, chainRegistry, chainId, actionData });

    // §36 automatic donations. Every mainnet send this flow broadcasts adds the
    // per-transaction amount to the wallet-wide queue (commitAdsStep, after the
    // broadcast); a testnet or regtest send adds nothing and never pays. When
    // the queue is due, a live build carries the whole queue as one donation
    // output if the encoder can build it; withAdsAtEncode folds it at the
    // encoder boundary, after the fee preflights, so the output order matches
    // the confirm route's, and rebuilds without it when the build fails.
    // Locked Auto pay follows the same rule. A send approved on a screen that
    // cannot name the donation (adsPayout false, the dApp approval window) only
    // accrues, so nothing rides it unseen. A resolve that throws only means no
    // donation this time: it never fails the send.
    let storedSettings = await vault.settings.get();
    // A claim left by a send whose owner is gone is judged first, so it
    // neither holds the payout back for good nor gets paid twice.
    if (adsReservationOf(storedSettings)) {
        try {
            storedSettings = (await reconcileAdsReservation({ vault })) ?? storedSettings;
        } catch {
            // The read above stands; a held claim only means no payout this time.
        }
    }
    const adsCounts = isAdsCountedSend({ settings: storedSettings, descriptor });
    let adsPlan = null;
    if (!prebuiltPsbt && adsPayout !== false) {
        try {
            adsPlan = await resolveAdsPayout({
                settings: storedSettings,
                chainId,
                chainRegistry,
                sdk: sdkRegistry.get(chainId),
            });
        } catch {
            adsPlan = null;
        }
    }
    // Set once the build is armed, just before signing (see the claim below).
    let adsAtEncode = null;
    let effectiveEncoderOpts = withDefaultFeePerKb({ chainId, chainRegistry, encoderOpts });
    let effectiveSdkRegistry = sdkRegistry;
    // The claim this send holds on the due queue while it is pending: cleared
    // when it is released, and booked with the broadcast otherwise.
    let adsReservationId = null;
    let adsClaimId = null;
    // The review claim the approved bytes were composed under (prebuilt path):
    // the claim this send takes over, and hands back when it stops before any
    // broadcast, since the confirm screen may approve the same bytes again.
    const adsReviewId = typeof prebuiltPsbt?.adsDonation?.reservationId === 'string'
        && prebuiltPsbt.adsDonation.reservationId
        ? prebuiltPsbt.adsDonation.reservationId
        : null;

    // Which verdict the accounting books, read when it is booked. On the
    // prebuilt path the donation was decided and folded at COMPOSE time, and one
    // background host serves every popup window, so the bytes the user approved
    // are the only description of what broadcasts; an envelope with no verdict
    // only accrues. On a live build it is whether the build kept the output.
    // `mainnet` says whether this send accrues; `reservationId` names the claim
    // the broadcast settles.
    const adsVerdict = () => {
        const booking = { mainnet: adsCounts, reservationId: adsReservationId };
        if (prebuiltPsbt) {
            const carried = prebuiltPsbt.adsDonation;
            return carried?.included === true
                ? { donationIncluded: true, donatedFiat: carried.fiat ?? null, currency: carried.currency ?? null, ...booking }
                : { donationIncluded: false, donatedFiat: null, currency: null, ...booking };
        }
        return adsAtEncode?.state.included
            ? { donationIncluded: true, donatedFiat: adsPlan.donationFiat, currency: adsPlan.currency, ...booking }
            : { donationIncluded: false, donatedFiat: null, currency: null, ...booking };
    };
    // The verdict a durable copy of these bytes carries. Its key is the record id,
    // which stays fixed while a two-phase record's txid moves to the reveal.
    const checkpointAdsCommit = () => ({ chainId, ...adsVerdict(), bookingKey: pending?.id ?? null });
    // Let the claim go: these bytes will never broadcast, or no longer carry
    // the donation, so the next send may carry the payout. Never fails the send.
    // `toReview` hands a taken-over claim back to its confirm screen instead
    // (the bytes were never sent and may be approved again); that screen's
    // Reject releases it, and an abandoned one lapses.
    const releaseAdsClaim = async ({ toReview = false } = {}) => {
        if (!adsReservationId) return;
        const reservationId = adsReservationId;
        adsReservationId = null;
        try {
            if (toReview && adsReviewId) {
                await returnAdsReservationToReview({ vault, reservationId, reviewId: adsReviewId });
            } else {
                await releaseAdsReservation({ vault, reservationId });
            }
        } catch {
            // A refused write leaves the claim held. Keep naming it, so the
            // booking after a broadcast clears it unpaid (these bytes carry no
            // donation); a send that never broadcasts leaves it to
            // reconcileAdsReservation, which reads its record as failed.
            adsReservationId = reservationId;
        }
    };

    // If the caller supplied pendingTxMeta, set up lifecycle persistence.
    // The tracker mutates a mutable record and writes through to the vault
    // on every transition; it also observes onProgress phase events.
    let pending = null;
    let pendingReadable = false;
    if (pendingTxMeta) {
        // §4.7: record the single-tick debit this tx moves so a
        // concurrent approval window's pre-flight can net it (via the shared
        // pendingTx store) once the reservation releases at broadcast. Mirrors
        // reserveFromSimulation's conservatism - only a single-leg SEND has an
        // unambiguous token debit; a multi-leg SEND or a non-SEND records none.
        const sendDelta = sendDeltaFromAction(actionData);
        pending = createPendingTx({
            chain: descriptor.coin,
            network: descriptor.networkKind,
            fromAddress: pendingTxMeta.fromAddress,
            toAddress: pendingTxMeta.toAddress,
            action: actionData.action,
            actionSummary: pendingTxMeta.actionSummary,
            psbtHex: '',
            params: actionData.params,
            ...(sendDelta ? { tick: sendDelta.tick, amount: sendDelta.amount } : {}),
            balanceDebits: Array.isArray(pendingTxMeta.balanceDebits)
                ? pendingTxMeta.balanceDebits
                : (sendDelta ? [sendDelta] : []),
        });
        await vault.pendingTxs.put(pending);
        // A store that reads back what it was given is one where a later miss
        // means the record was deleted, not that the store keeps nothing.
        if (typeof vault.pendingTxs.get === 'function') {
            try {
                pendingReadable = Boolean(await vault.pendingTxs.get(pending.id));
            } catch {
                pendingReadable = false;
            }
        }
    }

    // Set when the record this flow created is gone from the vault mid-send.
    let pendingRemoved = false;
    const writePending = async (patch) => {
        if (!pending || pendingRemoved) return;
        let next = { ...pending, ...patch };
        // The mempool and confirmation watchers write this same record while the
        // broadcast call is still returning. This copy is older than theirs, so a
        // blind write would turn a confirmed send back into a broadcast one (and
        // keep subtracting its spend), and erase the network sighting.
        const canRead = typeof vault.pendingTxs.get === 'function';
        const stored = canRead ? await vault.pendingTxs.get(pending.id) : null;
        // This flow put the record before any write reaches here, so a read that
        // finds nothing means another surface deleted it, as removing the wallet
        // does. Writing it back would leave a pending send on an address no
        // wallet holds, so every later write of this send is skipped.
        if (canRead && pendingReadable && (stored === null || stored === undefined)) {
            pendingRemoved = true;
            return;
        }
        if (stored) {
            if (stored.mempoolSeenAt && !next.mempoolSeenAt) next.mempoolSeenAt = stored.mempoolSeenAt;
            if (stored.status === 'indexed' && next.status !== 'indexed') {
                next = {
                    ...next,
                    status: 'indexed',
                    confirmedAt: stored.confirmedAt ?? next.confirmedAt,
                    ...(stored.chainConfirmed === true ? {
                        chainConfirmed: true,
                        confirmedBlockIndex: stored.confirmedBlockIndex ?? null,
                    } : {}),
                };
            }
        }
        pending = next;
        await vault.pendingTxs.put(pending);
    };

    // Set once phase 1 is on the network: submitWithSigner emits these phases only after it lands.
    let phase1Landed = false;
    // `waiting` is emitted only after the final broadcast leg lands.
    let broadcastComplete = false;
    // Set the moment the signer is about to be handed bytes; a failure before it signed nothing.
    let signingStarted = false;
    // The landed commit's txid, kept apart from the record's txid, which a queued reveal overwrites.
    let commitTxid = null;
    // A two-phase commit that landed (the progress it emitted, and the signed
    // encoding), booked as its own transaction once.
    let commitLegPhase = null;
    let signedEncoding = null;
    let commitLegBooked = false;
    let commitLegSettled = false;

    // Chain the caller's onProgress with our lifecycle-tracking callback
    // so both fire for every phase.
    const composedOnProgress = async (phase, data) => {
        // Record the landing before any await: most progress calls are not awaited.
        if (phase === 'signing') signingStarted = true;
        if (phase === 'signing' && typeof data?.encoding === 'string') signedEncoding = data.encoding;
        if (phase === 'envelope_revealing' || phase === 'p2sh_spending') commitLegPhase = phase;
        if (phase === 'waiting') broadcastComplete = true;
        if (phase === 'envelope_revealing' || phase === 'p2sh_spending' || phase === 'waiting') {
            phase1Landed = true;
        }
        const landedTxid = data?.commitTxid ?? data?.phase1Txid;
        if (typeof landedTxid === 'string' && landedTxid) commitTxid = landedTxid;
        if (onProgress) {
            try {
                onProgress(phase, data);
            } catch {
                // Caller's onProgress throwing should not derail lifecycle tracking.
            }
        }
        if (!pending) return;
        if (phase === 'encoding' && typeof data?.actionString === 'string') {
            // No-op; psbt arrives in the signing phase.
        } else if (phase === 'signing' && typeof data?.encoding === 'string') {
            await writePending({ status: 'awaiting-signature' });
        } else if (phase === 'broadcasting' && typeof data?.txid === 'string') {
            await writePending({
                status: 'broadcasting',
                txid: data.txid,
                ...(typeof data?.txHex === 'string' && data.txHex ? { txHex: data.txHex } : {}),
                // The signed reveal of a two-phase action, so a restart that
                // resumes this record sends the commit and then the reveal.
                ...(typeof data?.revealTxHex === 'string' && data.revealTxHex
                    ? { revealTxHex: data.revealTxHex, revealTxid: data.revealTxid ?? null }
                    : {}),
                // The verdict these bytes were composed under, so a restart that
                // resumes them books the send rather than only settling its claim.
                adsCommit: checkpointAdsCommit(),
            });
        } else if (phase === 'envelope_revealed' && typeof data?.txid === 'string') {
            // The reveal is the action's identity; the row moves off the commit txid.
            await writePending({ txid: data.txid });
        } else if (phase === 'p2sh_spending' && typeof data?.phase1Txid === 'string') {
            // phase-2 still pending; stay in broadcasting.
        } else if (phase === 'waiting' && typeof data?.txid === 'string') {
            await writePending({
                status: 'broadcast',
                broadcastAt: new Date().toISOString(),
                txid: data.txid,
            });
        } else if (phase === 'confirmed' && typeof data?.txid === 'string') {
            await writePending({
                status: 'indexed',
                confirmedAt: new Date().toISOString(),
            });
        }
    };

    let postBroadcastBooked = false;

    // When the caller supplies a pre-built signer (e.g., a RemoteSigner
    // forwarding to a renderer-hosted HW signer), skip unlockWallet
    // entirely (no password KDF, no software-seed decryption). The
    // caller owns the signer's lifecycle in that case, so we also
    // skip the trailing `.lock()`.
    const signer = injectedSigner
        ? injectedSigner
        : await unlockWallet({
            vault,
            walletId,
            password,
            bip39Passphrase,
            chainRegistry,
            sdkRegistry,
        });

    // change-address rotation. The signer is the first thing in this
    // flow that can derive a key, so this is the earliest point a fresh
    // internal address exists; it is also still before any encoding, so the
    // PSBT is built against the rotated address rather than patched after.
    //
    // Skipped on the prebuilt path: those bytes were composed (and rotated,
    // see the host's action.composeForConfirm) at confirm time and must be
    // signed byte-identically. Rotating again here would allocate an index
    // nothing spends to and change nothing on the wire.
    //
    // Only the self-change default is rotated - `change === sourceAddress`.
    // A caller that deliberately points change somewhere else (createList's
    // note: "a change address is not always the spender") is stating where
    // the value must land, and a privacy preference does not get to move it.
    let changeRotation = null;
    if (!prebuiltPsbt
        && !scopedPayment
        && encoderOpts?.change
        && encoderOpts.change === encoderOpts.sourceAddress) {
        changeRotation = await resolveChangeAddress({
            vault,
            walletId,
            signer,
            chainRegistry,
            chainId,
            sourceAddress: encoderOpts.sourceAddress,
            settings: storedSettings,
        });
    }

    // §36: claim the due queue for this send before anything is signed, so no
    // other send carries the payout while this one is pending (signing, an undo
    // hold, a retry or broadcast queue). The claim is the send's PendingTx id
    // when it has one, which lets a later reconcile judge it by that record. A
    // live build that loses the claim builds without the donation; bytes
    // composed with it cannot change, so they still go out (a send is never
    // refused for donations) and book their carried amount without a claim.
    // Bytes composed for a confirm screen were claimed at compose time under a
    // review id; the send takes that claim over (`takeOver`), so a second
    // review composed meanwhile already planned without the donation.
    const carriedDonation = prebuiltPsbt?.adsDonation?.included === true ? prebuiltPsbt.adsDonation : null;
    const claimFiat = prebuiltPsbt ? carriedDonation?.fiat : (adsPlan?.canSubmit ? adsPlan.donationFiat : null);
    // Only a mainnet chain's bytes can pay the queue, so only they claim it.
    if (typeof claimFiat === 'string' && claimFiat && descriptor.networkKind === 'mainnet') {
        const claimId = pending?.id ?? newAdsReservationId();
        let claimed = false;
        try {
            claimed = await reserveAdsPayout({
                vault,
                id: claimId,
                fiat: claimFiat,
                currency: prebuiltPsbt ? carriedDonation.currency : adsPlan.currency,
                chainId,
                pendingTxId: pending?.id ?? null,
                takeOver: adsReviewId,
            });
        } catch {
            claimed = false;
        }
        if (claimed) {
            adsReservationId = claimId;
            adsClaimId = claimId;
        } else if (!prebuiltPsbt) {
            adsPlan = withoutAdsPayout(adsPlan, 'reserved');
        }
    }
    adsAtEncode = adsPlan?.canSubmit ? withAdsAtEncode(sdkRegistry, adsPlan, chainId) : null;
    // A shared array, because a chunk-lane reveal and the built-transaction
    // check read the same options after createTx returns.
    effectiveEncoderOpts = adsAtEncode
        ? {
            ...effectiveEncoderOpts,
            customOutputs: Array.isArray(effectiveEncoderOpts?.customOutputs)
                ? effectiveEncoderOpts.customOutputs.slice()
                : [],
        }
        : effectiveEncoderOpts;
    effectiveSdkRegistry = adsAtEncode ? adsAtEncode.registry : sdkRegistry;
    const encoderOptsForSubmit = changeRotation?.rotated
        ? { ...effectiveEncoderOpts, change: changeRotation.address }
        : effectiveEncoderOpts;

    const composedBeforeBroadcast = async (transactions) => {
        // The built bytes are final here: a live build that could not afford
        // the donation dropped it, so its claim goes back before the send waits
        // on anything (an undo hold, the network).
        if (adsReservationId && !prebuiltPsbt && !adsAtEncode?.state.included) await releaseAdsClaim();
        const carriedAds = adsVerdict();
        if (pending && carriedAds.donationIncluded
            && typeof carriedAds.donatedFiat === 'string'
            && typeof carriedAds.currency === 'string') {
            await writePending({
                adsBooking: {
                    id: pending.id,
                    fiat: carriedAds.donatedFiat,
                    currency: carriedAds.currency,
                    paid: true,
                    booked: false,
                },
            });
        }
        // A hardware signer's commit PSBT gives the debit when signedPsbtHex is empty.
        const debitPsbtHex = transactions?.signed?.signedPsbtHex || transactions?.psbtHex;
        if (pending && debitPsbtHex) {
            const owned = new Set([
                pendingTxMeta?.fromAddress,
                encoderOptsForSubmit?.change,
            ].filter(Boolean));
            try {
                const [accounts, addresses, importedIds] = await Promise.all([
                    vault.accounts?.findBy?.('walletId', walletId) ?? [],
                    vault.addresses?.list?.() ?? [],
                    importedAddressIdsFor(vault, walletId),
                ]);
                const accountIds = new Set(accounts.map((account) => account.id));
                for (const address of addresses) {
                    if (address.chain !== descriptor.coin || address.network !== descriptor.networkKind) continue;
                    if (accountIds.has(address.accountId) || importedIds.has(address.id)) {
                        owned.add(address.address);
                    }
                }
            } catch {
                // Source and explicit change still provide a safe minimum when ownership lookup is unavailable.
            }
            let nativeDebitSats = null;
            let replacementPlan = null;
            try {
                const sdk = sdkRegistry.get(chainId);
                const debitPlan = sdk.wallet.decomposePsbt(debitPsbtHex);
                nativeDebitSats = nativeDebitSatsFromPsbt(debitPlan, owned);
                const finalPsbtHex = transactions?.finalPsbtHex
                    || transactions?.revealSigned?.signedPsbtHex
                    || transactions?.signed?.signedPsbtHex
                    || transactions?.psbtHex;
                if (typeof finalPsbtHex === 'string' && finalPsbtHex) {
                    const finalPlan = finalPsbtHex === debitPsbtHex
                        ? debitPlan
                        : sdk.wallet.decomposePsbt(finalPsbtHex);
                    const inputs = Array.isArray(finalPlan?.inputs) ? finalPlan.inputs : [];
                    const sequencesKnown = inputs.length > 0
                        && inputs.every((input) => Number.isInteger(input?.sequence));
                    replacementPlan = {
                        psbtHex: finalPsbtHex,
                        ...(sequencesKnown
                            ? { rbf: inputs.some((input) => input.sequence < 0xfffffffe) }
                            : {}),
                    };
                }
            } catch {
                nativeDebitSats = null;
                replacementPlan = null;
            }
            const patch = {
                ...(nativeDebitSats !== null ? { nativeDebitSats } : {}),
                ...(replacementPlan ?? {}),
            };
            if (Object.keys(patch).length > 0) await writePending(patch);
        }
        if (typeof beforeBroadcast === 'function') await beforeBroadcast(transactions);
    };

    let result;
    try {
        try {
            result = await submitWithSigner({
                sdkRegistry: effectiveSdkRegistry,
                chainRegistry,
                chainId,
                actionData,
                // When a prebuilt PSBT is supplied, submitWithSigner
                // skips createAction + encoder.createTx and signs it byte-
                // identically, so the ADS donation already folded into that
                // PSBT at compose time is what broadcasts. The re-fold into
                // effectiveEncoderOpts above is inert on this path (createTx
                // never runs), and so is the plan's verdict: the post-broadcast
                // commitAdsStep books the compose-time one the envelope carries.
                encoderOpts: encoderOptsForSubmit,
                prebuiltPsbt,
                signer,
                signingPaths,
                waitForTxid,
                waitOpts,
                onProgress: composedOnProgress,
                beforeBroadcast: composedBeforeBroadcast,
                verifyBuiltTx,
            });
        } catch (err) {
            // Record the outcome on the PendingTx without letting the vault
            // write BECOME the outcome. Two things depend on this block
            // finishing: the classified broadcast error the caller switches on
            // (re-compose vs queued retry), and the independent second
            // durability half the host keeps through `onBroadcastFailure`. An
            // un-guarded write let a rejecting `pendingTxs.put` exit the catch,
            // which substituted a storage error for the classified one AND
            // skipped the enqueue, losing the signed bytes with healthy queue
            // storage. The failure rides on the error for diagnostics; `name`,
            // `message` and type are untouched because the messaging envelope
            // carries only those.
            // The record id rides on the error so a host whose vault refused the
            // stamp below can finish the record once the vault opens again.
            if (err && typeof err === 'object') {
                if (pending) err.pendingTxId = pending.id;
                // Nothing was signed, so the confirm screen can hand its held
                // inputs back; the flag crosses the transport beside `code`.
                if (!signingStarted) err.refusedBeforeSigning = true;
                if (phase1Landed) {
                    err.commitLanded = true;
                    err.commitTxid = commitTxid;
                }
            }
            // Set when a durable half (the PendingTx or the host queue) kept the bytes.
            let adsHandedOff = false;
            const stampPending = async (patch) => {
                if (!pending) return false;
                try {
                    await writePending(patch);
                    // A write skipped because the wallet was removed saved nothing.
                    return !pendingRemoved;
                } catch (writeErr) {
                    if (err && typeof err === 'object') {
                        err.pendingTxWriteError = writeErr && writeErr.message
                            ? String(writeErr.message)
                            : String(writeErr);
                    }
                    return false;
                }
            };
            // Cluster G FOLLOWUP 1: broadcast leg failed after a clean
            // sign. Stamp the PendingTx as `queued` (with the signed
            // txHex) so the §49.5 queue can drain it later, then fire
            // the optional onBroadcastFailure callback so the host can
            // also push to its in-process queue surface.
            if (err instanceof BroadcastFailedError) {
                // Split the post-sign broadcast failure on
                // PERMANENCE. A PERMANENT rejection (inputs spent/missing, or
                // a confirmed conflict) can never confirm as-is: mark the
                // PendingTx `failed` (never queued) so the modal offers a
                // fresh re-compose, unless phase 1 already landed (kept
                // `broadcast` below). A TRANSIENT failure keeps the existing
                // queued-rebroadcast path (the SAME signed tx can still land).
                const permanence = classifyBroadcastFailure(err);
                // Stamp the permanence into the error NAME so it survives the
                // messaging boundary (that envelope carries only name+message).
                // `instanceof BroadcastFailedError` still holds - only the name
                // changes - and it is read above, before this point.
                err.name = permanence === 'permanent'
                    ? BROADCAST_FAILED_PERMANENT_NAME
                    : BROADCAST_FAILED_TRANSIENT_NAME;
                if (permanence === 'permanent' && phase1Landed) {
                    // The commit is on the network and only the reveal or phase-2 spend was refused.
                    // Same rule as the non-broadcast branch below: keep it 'broadcast' so the commit's
                    // spend stays netted, and keep the commit's txid rather than the refused one.
                    await stampPending({
                        status: 'broadcast',
                        broadcastAt: pending?.broadcastAt ?? new Date().toISOString(),
                        error: err && err.message ? String(err.message) : String(err),
                    });
                    await bookCommitLeg();
                    // An envelope's landed commit paid the payout, so its claim is never
                    // let go; one a refused write left held is settled by reconciliation.
                    if (commitLegPhase && commitLegCarries()) adsReservationId = null;
                } else if (permanence === 'permanent') {
                    await stampPending({
                        status: 'failed',
                        txid: err.txid,
                        txHex: err.signedTxHex,
                        error: err && err.message ? String(err.message) : String(err),
                    });
                    // Do NOT invoke onBroadcastFailure: there is nothing to
                    // queue. The caller sees the thrown error and re-composes.
                } else {
                    // Mark a queued reveal or phase-2 whose commit landed, so a later
                    // permanent retry verdict keeps it 'broadcast' as the branch above does.
                    const commitMark = phase1Landed ? { commitLanded: true, commitTxid } : {};
                    // A refused commit queues with its signed reveal, so the drain
                    // sends both and never the commit alone.
                    const revealMark = !phase1Landed && err.revealTxHex
                        ? { revealTxHex: err.revealTxHex, revealTxid: err.revealTxid ?? null }
                        : {};
                    // A landed commit is booked now; once it settled the payout,
                    // the queued reveal only accrues.
                    const queuedAdsCommit = await bookCommitLeg()
                        ? accrueOnlyVerdict(checkpointAdsCommit())
                        : checkpointAdsCommit();
                    const pendingSaved = await stampPending({
                        status: 'queued',
                        txid: err.txid,
                        txHex: err.signedTxHex,
                        error: err && err.message ? String(err.message) : String(err),
                        adsCommit: queuedAdsCommit,
                        ...commitMark,
                        ...revealMark,
                    });
                    let queueSaved = false;
                    // A removed wallet's bytes would sit in a queue no surface can list or discard.
                    if (!pendingRemoved && typeof onBroadcastFailure === 'function') {
                        try {
                            queueSaved = await onBroadcastFailure({
                                ...commitMark,
                                ...revealMark,
                                signedTxHex: err.signedTxHex,
                                txid: err.txid,
                                chainId: err.chainId,
                                signedAt: err.signedAt,
                                summary: pendingTxMeta?.actionSummary
                                    || actionDisplayLabel(actionData.action),
                                error: err.message,
                                // Name the PendingTx stamped 'queued' above so
                                // the queue's broadcast and discard handlers
                                // can settle the durable half; without the id
                                // the record stays 'queued' after the bytes land.
                                pendingTxId: pending?.id ?? null,
                                soldNames: queuedSoldNames(actionData),
                                // Carry the donation verdict of these signed
                                // bytes so the queue's eventual-success handler
                                // books it (a queued tx is what donates, not
                                // the failed immediate attempt). §5.3.4.
                                adsCommit: queuedAdsCommit,
                            }) !== false;
                        } catch (_inner) {
                            // Swallow callback errors; the broadcast
                            // failure is the load-bearing signal.
                        }
                    }
                    if (!pendingSaved && !queueSaved) {
                        err.name = BROADCAST_FAILED_TRANSIENT_UNSAVED_NAME;
                    }
                    // A saved half will send these bytes later, so their claim
                    // stays held until that broadcast settles it or a discard
                    // or permanent refusal releases it.
                    adsHandedOff = pendingSaved || queueSaved;
                }
            } else if (pending) {
                // Never retire a transaction the network holds as 'failed': that stops it
                // netting its spend and invites a re-compose. Keep it 'broadcast' with the error.
                const error = err && err.message ? String(err.message) : String(err);
                await stampPending(phase1Landed
                    ? { status: 'broadcast', broadcastAt: pending.broadcastAt ?? new Date().toISOString(), error }
                    : { status: 'failed', error });
            }
            // Bytes nothing will send again (a refusal, a cancelled sign, a
            // permanent rejection, a transient one neither half kept) never pay
            // the donation, so the next send may carry it. A failure before any
            // broadcast (a wrong password, a hardware retry, a refusal) hands a
            // taken-over claim back to its confirm screen instead, which may
            // approve the same bytes again.
            if (broadcastComplete && !(err instanceof BroadcastFailedError)) {
                await afterBroadcastLanded();
            } else if (!adsHandedOff) {
                await releaseAdsClaim({ toReview: !(err instanceof BroadcastFailedError) && !phase1Landed });
            }
            throw err;
        }
    } finally {
        if (!injectedSigner && typeof signer.lock === 'function') {
            signer.lock();
        }
        forgetInFlightAdsReservation(adsClaimId);
    }

    // The broadcast landed: drop cached token metadata for the ticks this
    // action names (it describes the token BEFORE the action), and book the
    // send in the donation queue (§36), never before the broadcast. ADS
    // accounting is non-critical, so a write failure only surfaces through
    // onProgress and never obscures the successful broadcast.
    async function afterBroadcastLanded() {
        if (postBroadcastBooked) return;
        postBroadcastBooked = true;
        try { invalidateTokenInfoForAction(chainId, actionData); } catch { /* cache invalidation is best effort */ }
        // Every landed transaction accrues: a two-phase send books its commit
        // first, and its final leg then pays only a payout the commit did not.
        const settledOnCommit = await bookCommitLeg();
        try {
            // A counted send with a record books under the key its checkpoint
            // carries, so a restart that resumes the same bytes books nothing more.
            const keyed = Boolean(pending) && adsCounts;
            const { booking } = await commitAdsStepWithBooking({
                vault,
                ...(settledOnCommit ? accrueOnlyVerdict(adsVerdict()) : adsVerdict()),
                ...(keyed ? { bookingScope: ADS_DELIVERY_BOOKING_SCOPE, bookingKey: pending.id } : {}),
            });
            if (pending && booking) {
                await writePending({
                    adsBooking: { id: pending.id, ...booking, paid: true, booked: true },
                });
            }
        } catch (e) {
            reportAdsCommitFailure(e);
        }
    }

    function reportAdsCommitFailure(e) {
        if (!onProgress) return;
        try {
            onProgress('ads-commit-failed', { chainId, error: e && e.message ? String(e.message) : String(e) });
        } catch { /* swallow */ }
    }

    function commitLegCarries() {
        return donationRidesCommit({ encoding: signedEncoding, landedPhase: commitLegPhase });
    }

    // A landed two-phase commit is a transaction of its own, booked once under
    // its own key. It settles the payout only when it carried it; resolves true
    // then, so the final leg only accrues.
    async function bookCommitLeg() {
        if (!commitLegPhase || commitLegBooked) return commitLegSettled;
        commitLegBooked = true;
        try {
            const { carries, booking } = await bookLandedCommit({
                vault, verdict: adsVerdict(), encoding: signedEncoding, landedPhase: commitLegPhase, pendingTxId: pending?.id ?? null,
            });
            if (!carries) return false;
            commitLegSettled = true;
            adsReservationId = null;
            if (pending && booking) {
                await writePending({ adsBooking: { id: pending.id, ...booking, paid: true, booked: true } });
            }
        } catch (e) {
            reportAdsCommitFailure(e);
        }
        return commitLegSettled;
    }

    // Cache invalidation and ADS booking are run once after the final leg lands,
    // including when only the optional indexer wait fails afterward.
    await afterBroadcastLanded();

    // Settle: ensure the final txid and status reach the record even if
    // no wait callback was supplied. Without waitForTxid, status ends at
    // 'broadcast'; with it, it ends at 'indexed'.
    //
    // The transaction is already on the network here, so a refused write (a full
    // disk, a storage backend that went away) must not turn the send into a
    // failure: the caller would tell the user it failed and invite a second
    // send. The record the 'broadcasting' phase wrote already carries the txid
    // for the watchers; the refusal rides on the result for diagnostics.
    let settleWriteError = null;
    if (pending) {
        try {
            if (!waitForTxid) {
                await writePending({
                    status: 'broadcast',
                    broadcastAt: new Date().toISOString(),
                    txid: result.txid,
                    txHex: result.signed.txHex ?? null,
                });
            } else if (pending.status !== 'indexed') {
                // Defensive: the lifecycle callback should have advanced to
                // 'indexed' via the 'confirmed' phase. If for some reason the
                // progress event was missed, patch the terminal state here.
                await writePending({
                    status: 'indexed',
                    confirmedAt: pending.confirmedAt ?? new Date().toISOString(),
                    txid: result.txid,
                    txHex: result.signed.txHex ?? null,
                });
            } else {
                // Already 'indexed'; just make sure txHex is stored.
                await writePending({ txHex: result.signed.txHex ?? null });
            }
        } catch (writeErr) {
            settleWriteError = writeErr && writeErr.message ? String(writeErr.message) : String(writeErr);
        }
    }

    return {
        ...result,
        pendingTxId: pending?.id ?? null,
        ...(settleWriteError ? { pendingTxWriteError: settleWriteError } : {}),
        // The address the change actually paid, so a caller can say so
        // (and so a test can assert the rotation rather than infer it).
        changeAddress: encoderOptsForSubmit?.change ?? null,
        changeRotated: changeRotation?.rotated === true,
    };
}
