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
import { submitWithSigner, BroadcastFailedError } from '../sdk/submitWithSigner.js';
import { createPendingTx } from '../schemas/pendingTx.js';
import { commitAdsStep, applyAdsPlanToEncoderOpts } from './ads.js';
import {
    classifyBroadcastFailure,
    BROADCAST_FAILED_PERMANENT_NAME,
    BROADCAST_FAILED_TRANSIENT_NAME,
} from './broadcastPermanence.js';
import { invalidateTokenInfoForAction } from '../shared/utils/tokenInfoCache.js';
import { resolveChangeAddress } from './changeAddress.js';

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
 * @typedef {Object} PendingTxMeta
 * @property {string} fromAddress
 * @property {string} toAddress
 * @property {string} actionSummary   §21.1 plain-English summary
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
 * @property {(entry: { signedTxHex: string, txid: string, chainId: string, signedAt: number, summary: string, error: string }) => void | Promise<void>} [onBroadcastFailure]   Cluster G FOLLOWUP 1: fires when the broadcast leg fails after a successful sign. Caller (typically the bridge background host) hands the entry off to §49.5's queued-broadcast surface so the signed tx isn't lost on a network blip.
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
    onBroadcastFailure,
}) {
    if (!injectedSigner && (typeof password !== 'string' || password.length === 0)) {
        throw new Error('submitAction: either `password` or `signer` is required');
    }
    const descriptor = chainRegistry.get(chainId);
    if (!descriptor) throw new Error(`submitAction: unknown chain "${chainId}"`);

    // §36.3 ADS: resolve the donation plan ONCE up front against the
    // current settings snapshot. If `canSubmit`, inject a customOutput
    // into encoderOpts so the encoder builds the donation into the
    // same transaction. After a successful broadcast we call
    // `commitAdsStep` with the resolved `donationIncluded` so the
    // accumulator resets / lifetimeDonatedSats advances correctly.
    //
    // If ADS is enabled but not `canSubmit` (e.g. placeholder donation
    // address still in the descriptor), we still advance the counter
    // with `donationIncluded=false` so the user's lifetimeTxCount
    // reflect the actual tx that was broadcast, regardless of whether
    // the donation fired.
    const adsSettingsSnapshot = await vault.settings.get();
    const { encoderOpts: effectiveEncoderOpts, adsPlan, adsEnabledForChain } =
        applyAdsPlanToEncoderOpts(adsSettingsSnapshot, chainId, chainRegistry, encoderOpts);

    // If the caller supplied pendingTxMeta, set up lifecycle persistence.
    // The tracker mutates a mutable record and writes through to the vault
    // on every transition; it also observes onProgress phase events.
    let pending = null;
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
            ...(sendDelta ? { tick: sendDelta.tick, amount: sendDelta.amount } : {}),
        });
        await vault.pendingTxs.put(pending);
    }

    const writePending = async (patch) => {
        if (!pending) return;
        pending = { ...pending, ...patch };
        await vault.pendingTxs.put(pending);
    };

    // Chain the caller's onProgress with our lifecycle-tracking callback
    // so both fire for every phase.
    const composedOnProgress = async (phase, data) => {
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
            await writePending({ status: 'broadcasting', txid: data.txid });
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
        && effectiveEncoderOpts?.change
        && effectiveEncoderOpts.change === effectiveEncoderOpts.sourceAddress) {
        changeRotation = await resolveChangeAddress({
            vault,
            walletId,
            signer,
            chainRegistry,
            chainId,
            sourceAddress: effectiveEncoderOpts.sourceAddress,
            settings: adsSettingsSnapshot,
        });
    }
    const encoderOptsForSubmit = changeRotation?.rotated
        ? { ...effectiveEncoderOpts, change: changeRotation.address }
        : effectiveEncoderOpts;

    let result;
    try {
        try {
            result = await submitWithSigner({
                sdkRegistry,
                chainRegistry,
                chainId,
                actionData,
                // When a prebuilt PSBT is supplied, submitWithSigner
                // skips createAction + encoder.createTx and signs it byte-
                // identically, so the ADS donation already folded into that
                // PSBT at compose time is what broadcasts. The re-fold into
                // effectiveEncoderOpts above is inert on this path (createTx
                // never runs); the adsPlan it produced still drives the post-
                // broadcast commitAdsStep below.
                encoderOpts: encoderOptsForSubmit,
                prebuiltPsbt,
                signer,
                signingPaths,
                waitForTxid,
                waitOpts,
                onProgress: composedOnProgress,
            });
        } catch (err) {
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
                // fresh re-compose. A TRANSIENT failure keeps the existing
                // queued-rebroadcast path (the SAME signed tx can still land).
                const permanence = classifyBroadcastFailure(err);
                // Stamp the permanence into the error NAME so it survives the
                // messaging boundary (that envelope carries only name+message).
                // `instanceof BroadcastFailedError` still holds - only the name
                // changes - and it is read above, before this point.
                err.name = permanence === 'permanent'
                    ? BROADCAST_FAILED_PERMANENT_NAME
                    : BROADCAST_FAILED_TRANSIENT_NAME;
                if (permanence === 'permanent') {
                    if (pending) {
                        await writePending({
                            status: 'failed',
                            txid: err.txid,
                            txHex: err.signedTxHex,
                            error: err && err.message ? String(err.message) : String(err),
                        });
                    }
                    // Do NOT invoke onBroadcastFailure: there is nothing to
                    // queue. The caller sees the thrown error and re-composes.
                } else {
                    if (pending) {
                        await writePending({
                            status: 'queued',
                            txid: err.txid,
                            txHex: err.signedTxHex,
                            error: err && err.message ? String(err.message) : String(err),
                        });
                    }
                    if (typeof onBroadcastFailure === 'function') {
                        try {
                            await onBroadcastFailure({
                                signedTxHex: err.signedTxHex,
                                txid: err.txid,
                                chainId: err.chainId,
                                signedAt: err.signedAt,
                                summary: pendingTxMeta?.actionSummary
                                    || `${actionData.action} on ${chainId}`,
                                error: err.message,
                                // Carry the ADS-commit intent so the queue's
                                // eventual-success handler advances the
                                // accumulator (a queued tx is what donates,
                                // not the failed immediate attempt). §5.3.4.
                                adsCommit: adsEnabledForChain
                                    ? { chainId, donationIncluded: adsPlan.canSubmit }
                                    : null,
                            });
                        } catch (_inner) {
                            // Swallow callback errors; the broadcast
                            // failure is the load-bearing signal.
                        }
                    }
                }
            } else if (pending) {
                await writePending({
                    status: 'failed',
                    error: err && err.message ? String(err.message) : String(err),
                });
            }
            throw err;
        }
    } finally {
        if (!injectedSigner && typeof signer.lock === 'function') {
            signer.lock();
        }
    }

    // The broadcast landed, so any cached metadata for the ticks this
    // action names now describes the token as it was BEFORE the action. Drop
    // those records here rather than at each call site: every issuer action
    // (ISSUE, and so ownership transfer, description and mint settings; MINT;
    // LOCK; DESTROY; CALLBACK) funnels through this one flow. Left cached, the
    // Manage Token page keeps naming the previous owner and hides every issuer
    // action from the new one, recoverable only by a full page reload.
    invalidateTokenInfoForAction(chainId, actionData);

    // §36.3: advance the ADS accumulator after a successful submit.
    // Only fire when ADS is actually enabled for this chain; otherwise
    // `stepAdsAccumulator` is identity but the extra vault write is
    // wasted. `donationIncluded` mirrors `adsPlan.canSubmit` so the
    // two code paths (injected + not-injected) advance the counters
    // correctly.
    if (adsEnabledForChain) {
        try {
            await commitAdsStep({
                vault,
                chainId,
                donationIncluded: adsPlan.canSubmit,
            });
        } catch (e) {
            // ADS accounting is non-critical; don't let a write failure
            // here obscure the successful broadcast from the caller.
            // The next tx will try again. Surface via onProgress for
            // observability.
            if (onProgress) {
                try {
                    onProgress('ads-commit-failed', {
                        chainId,
                        error: e && e.message ? String(e.message) : String(e),
                    });
                } catch { /* swallow */ }
            }
        }
    }

    // Settle: ensure the final txid and status reach the record even if
    // no wait callback was supplied. Without waitForTxid, status ends at
    // 'broadcast'; with it, it ends at 'indexed'.
    if (pending) {
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
    }

    return {
        ...result,
        pendingTxId: pending?.id ?? null,
        // The address the change actually paid, so a caller can say so
        // (and so a test can assert the rotation rather than infer it).
        changeAddress: encoderOptsForSubmit?.change ?? null,
        changeRotated: changeRotation?.rotated === true,
    };
}
