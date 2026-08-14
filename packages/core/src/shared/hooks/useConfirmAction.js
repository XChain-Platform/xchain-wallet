// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useConfirmAction (§5.1, §5.3.5).
//
// Drives the single-encode confirm pipeline. All SDK work is HOST-side
// (the React tree only reaches the host over `messaging`): the injected
// `compose` runs composeForConfirm + the tamper check in the background
// and resolves with an already-verified ComposedAction; `preflight` runs
// sdk.preflight in the background. The hook itself is a pure UI state
// machine: compose PRE-OPEN, open the modal, stream pre-flight, and on
// Approve re-check staleness (and,, the native-coin protocol fee this
// PSBT already pays) before signing the byte-identical PSBT. One
// modal per window, enforced by a module-level singleton (React context
// would miss independently-mounted trees). Each invocation owns one
// AbortController; Reject/close aborts everything and a superseded report
// never renders.
//
// The hook exposes reactive state for <ConfirmActionModal> plus approve()/
// reject() the modal buttons call. confirm() resolves with onApprove's own
// return value verbatim, or rejects with a documented reason (`busy`,
// `user-rejected`) so forms can skip error toasts on Reject.

import { useCallback, useEffect, useRef, useState } from 'react';
import { broadcastFailureKindFromError } from '../../flows/broadcastPermanence.js';
import { reserveFromSimulation } from '../../flows/reserveFromSimulation.js';
import { livenessMessage } from '../../flows/inputLiveness.js';
import { compareNativeFeeQuote, isNativeFeeRefusal, nativeFeeChangedError } from '../../flows/nativeFeeRequote.js';

// Module-level singleton: only ONE confirm modal may be live per window.
let activeInstanceId = null;

export class ConfirmActionBusyError extends Error {
    constructor() { super('A confirmation is already in progress in this window.'); this.name = 'ConfirmActionBusyError'; this.reason = 'busy'; }
}
export class UserRejectedError extends Error {
    constructor() { super('User rejected the action.'); this.name = 'UserRejectedError'; this.reason = 'user-rejected'; }
}

/** @typedef {'idle'|'composing'|'preflighting'|'ready'|'signing'|'rechecking'|'done'|'error'|'signed-not-broadcast'} ConfirmPhase */

const STALENESS_MS = 30000;

// Phases during which the confirm PAGE is on screen in place of the form.
// `composing` runs PRE-OPEN (the form's own button spins) and the terminal
// phases are settled by the confirm() promise, so neither belongs here.
const OPEN_PHASES = Object.freeze(['preflighting', 'ready', 'signing', 'rechecking']);

/**
 * Is the confirm page currently rendered in place of the invoking form?
 * Single source of the phase list for every surface that swaps itself out.
 *
 * @param {ConfirmPhase | string | null | undefined} phase
 */
export function isConfirmOpenPhase(phase) {
    return OPEN_PHASES.includes(/** @type {string} */ (phase));
}

export function useConfirmAction() {
    const instanceId = useRef(Symbol('confirm-action')).current;
    const abortRef = useRef(null);
    const resolveRef = useRef(null);
    const rejectRef = useRef(null);
    const optsRef = useRef(null);
    const composedRef = useRef(null);
    const reportStampRef = useRef(0);
    // When the PSBT on screen was BUILT. Distinct from the report stamp
    // because §4.6's two re-checks have different clocks: the pre-flight
    // verdict ages against its own fetch, while the held PSBT's inputs age
    // from the moment the encoder selected them - and a confirm that never
    // got a report at all (pre-flight off, offline, timed out) still holds a
    // PSBT whose coins someone else can spend.
    const composedStampRef = useRef(0);
    const sessionIdRef = useRef(null);

    const [phase, setPhase] = useState(/** @type {ConfirmPhase} */('idle'));
    const [composing, setComposing] = useState(false);
    const [composed, setComposed] = useState(null);
    const [report, setReport] = useState(null);
    const [error, setError] = useState(null);
    const [acknowledged, setAcknowledged] = useState(() => new Set());

    // Release the singleton (and abort in-flight work) when the owning
    // component unmounts while still holding it - a form navigated away
    // mid-confirm must not wedge every future modal as `busy`.
    useEffect(() => () => {
        if (activeInstanceId === instanceId) {
            activeInstanceId = null;
            if (abortRef.current) { try { abortRef.current.abort(); } catch { /* noop */ } }
        }
    }, [instanceId]);

    const teardown = useCallback(() => {
        activeInstanceId = null;
        if (abortRef.current) { try { abortRef.current.abort(); } catch { /* noop */ } }
        // Release any reservation this instance registered.
        const o = optsRef.current;
        if (o && o.reservationLedger && o.reservationId) {
            Promise.resolve(o.reservationLedger.release(o.reservationId)).catch(() => {});
        }
        // Drop the stored confirm on EVERY terminal state, which
        // is what this single teardown covers - approve, reject, error, and
        // the unmount of a form navigated away from mid-confirm. Mandatory
        // rather than tidy-up: a session that outlives its confirm offers the
        // user a re-approve of a transaction that may already be signed and
        // broadcast, the §5.3.4 double-broadcast trap.
        //
        // A popup CLOSE deliberately does NOT reach here - React runs no
        // cleanup when the page is destroyed - which is precisely how the
        // session survives the one event it exists for.
        if (o && o.session && sessionIdRef.current) {
            const id = sessionIdRef.current;
            sessionIdRef.current = null;
            Promise.resolve(o.session.clear(id)).catch(() => {});
        }
    }, []);

    const settleResolve = useCallback((value) => {
        const r = resolveRef.current;
        resolveRef.current = null; rejectRef.current = null;
        teardown();
        if (r) r(value);
    }, [teardown]);

    const settleReject = useCallback((err) => {
        const r = rejectRef.current;
        resolveRef.current = null; rejectRef.current = null;
        teardown();
        if (r) r(err);
    }, [teardown]);

    /**
     * All SDK access is HOST-side (the React tree only talks to the host over
     * `messaging`): `compose` runs composeForConfirm AND the tamper check in
     * the background and resolves with an already-verified ComposedAction (a
     * tamper failure rejects here, so it lands in the compose-failure path and
     * the modal never opens); `preflight` runs sdk.preflight in the background.
     *
     * @param {Object} args
     * @param {() => Promise<import('../../flows/composeForConfirm.js').ComposedAction>} args.compose   host compose + tamper (messaging.composeForConfirm)
     * @param {(credentials: object, composed: object) => Promise<any>} args.onApprove
     * @param {string} args.chainId
     * @param {(reqOpts: { actionString: string, source?: string, localDeltas?: Array<{tick:string,amount:string}>, bypassCache?: boolean, mode?: string }) => Promise<object>} [args.preflight]   host preflight (messaging.preflight); omit to skip pre-flight
     * @param {string} [args.source]
     * @param {object} [args.preflightOpts]         { mode?, localDeltas? } forwarded to preflight
     * @param {object} [args.reservationLedger]     §4.7 ledger (reserve/release/localDeltas)
     * @param {{ tick?: string, amount?: string }} [args.reserve]  the amount to reserve at Approve
     * @param {(psbtHex: string) => Promise<{verdict: string, spent: Array<object>}>} [args.checkInputs]  §4.6 input-liveness probe (messaging.checkInputLiveness)
     * @param {(req: { actionString: string, source?: string }) => Promise<object>} [args.requoteNativeFee]
     * Approve-time native-fee re-quote (messaging.requoteNativeFee).
     *   Called only when the composed action actually attaches a native-coin
     *   fee output; a composed amount outside the fresh band interrupts
     *   instead of signing.
     * @param {boolean} [args.alwaysCheckInputs]    force the liveness probe regardless of PSBT age (the resume path)
     * @param {{ put: (payload: object) => Promise<any>, clear: (id: string) => Promise<any> }} [args.session] §5.4 confirm-session store
     * @param {{ software: string, hardware?: string, base: object, after?: object, returnTo?: object, label?: string }} [args.resume]
     *   How to finish this confirm WITHOUT its originating form. Supplying it is
     *   what opts the surface into persistence: `software`/`hardware` are
     *   allow-listed messaging method names, `base` the request body they take,
     *   `after` an optional follow-up call (a form's own post-broadcast
     *   bookkeeping, e.g. AirdropForm's pending record) and `returnTo` where to
     *   drop the user afterwards. A form that does not supply one stores
     *   nothing and keeps today's re-entry cost.
     * @param {object} [args.resumeRequest]         the compose request, stored alongside for display/rehydration
     * @returns {Promise<any>}   resolves with onApprove's own return value; EXCEPT on a
     *   TRANSIENT post-sign broadcast failure (§5.3.4), where it resolves with
     *   `{ queued: true, broadcast: 'queued', error }` - the tx is signed and handed to the
     *   broadcast queue, so callers must render "Signed. Not broadcast yet." (the
     *   queue is drained by the user from QueuedBroadcastBanner, never automatically), not
     *   an error. A PERMANENT broadcast failure rejects (re-compose required).
     */
    const confirm = useCallback((args) => {
        if (activeInstanceId !== null) return Promise.reject(new ConfirmActionBusyError());
        activeInstanceId = instanceId;

        const controller = new AbortController();
        abortRef.current = controller;
        optsRef.current = { ...args, reservationId: null };
        setError(null);
        setReport(null);
        setComposed(null);
        setAcknowledged(new Set());

        return new Promise((resolve, reject) => {
            resolveRef.current = resolve;
            rejectRef.current = reject;

            (async () => {
                // PRE-OPEN compose (may take seconds; the form disables submit
                // on `composing`). Failures reject unwrapped, modal never opens.
                setComposing(true);
                setPhase('composing');
                let built;
                try {
                    built = await args.compose();
                } catch (err) {
                    setComposing(false);
                    setPhase('idle');
                    settleReject(err);
                    return;
                }
                if (controller.signal.aborted) { settleReject(new UserRejectedError()); return; }

                // compose() already ran the tamper check HOST-side; reaching
                // here means the built PSBT is verified. A tamper (or any
                // compose failure) rejected above, before this point.
                composedRef.current = built;
                composedStampRef.current = Date.now();
                setComposed(built);
                setComposing(false);
                setPhase('preflighting'); // MODAL OPENS HERE

                // Persist the composed confirm the moment it is on
                // screen, before pre-flight, because the hazard it protects
                // against (the popup closing on focus loss) is likeliest while
                // the user waits for exactly that. Persisted only when the
                // caller supplied a `resume` descriptor: a stored confirm has
                // to be approvable WITHOUT its originating form, and a form
                // that has not said how is one this must not offer to finish.
                if (args.session && args.resume) {
                    sessionIdRef.current = makeSessionId();
                    persistSession(args, sessionIdRef.current, built, null);
                }

                // Pre-flight streams in HOST-side; Approve stays disabled until
                // it lands. Best-effort: any failure (or no preflight backend)
                // goes ready with a null report so the user can still proceed.
                if (typeof args.preflight !== 'function') { setPhase('ready'); return; }
                // A bare native-coin payment has no XChain action, so
                // there is nothing to pre-flight. Asking anyway is not merely
                // wasteful - the indexer would be handed a SEND for a tick it
                // has no ledger for and would rightly call it invalid, which is
                // how a perfectly good payment came to be reported as one that
                // "Will likely fail".
                if (built.bareNativePayment) { setPhase('ready'); return; }
                try {
                    const localDeltas = await gatherLocalDeltas(args);
                    const rpt = await args.preflight({
                        actionString: built.actionString,
                        source: args.source,
                        localDeltas,
                        // The dry run must be asked about the transaction that
                        // was actually built. Without this it answers for the
                        // chain's DEFAULT lane, so an opt-in native fee on
                        // Bitcoin is judged against an XCHAIN balance the payer
                        // deliberately is not using.
                        feeMode: built.payFeeInNativeCoin ? 'native' : undefined,
                        mode: args.preflightOpts?.mode || 'report',
                    });
                    if (controller.signal.aborted) return; // superseded; never render
                    reportStampRef.current = Date.now();
                    setReport(rpt);
                    setPhase('ready');
                    // Re-persist with the verdict so a resumed confirm renders
                    // the findings the user was reading instead of a blank
                    // panel while it re-queries.
                    if (sessionIdRef.current) persistSession(args, sessionIdRef.current, built, rpt);
                } catch {
                    if (controller.signal.aborted) return;
                    setReport(null);
                    setPhase('ready');
                }
            })().catch((err) => {
                // Defensive: every real rejection already routes through
                // settleReject; this only prevents a stray escape from
                // surfacing as an unhandled rejection.
                if (rejectRef.current) settleReject(err);
            });
        });
    }, [instanceId, settleReject]);

    // Approve handler the modal wires to the primary button. Disables
    // synchronously (the caller sets a local disabled flag in the same tick).
    const approve = useCallback(async (credentials) => {
        const args = optsRef.current;
        const built = composedRef.current;
        if (!args || !built) return;

        setPhase('signing');

        // §4.6 input liveness. Runs off the PSBT's OWN age, not the report's,
        // so a confirm that never got a report (pre-flight off, offline, timed
        // out) is still checked - and `alwaysCheckInputs` forces it for a
        // resumed confirm (§5.4), which is by construction the oldest PSBT in
        // the wallet. Spent inputs interrupt: §5.3.4 forbids re-signing this
        // PSBT, so the only way forward is a re-compose.
        const psbtAged = Date.now() - composedStampRef.current > STALENESS_MS;
        if (typeof args.checkInputs === 'function' && (psbtAged || args.alwaysCheckInputs)) {
            setPhase('rechecking');
            let liveness = null;
            try {
                liveness = await args.checkInputs(built.psbt);
            } catch { /* unreachable explorer must not block a good tx (§4.2) */ }
            if (liveness && liveness.verdict === 'spent') {
                const err = new Error(livenessMessage(liveness));
                err.code = 'INPUTS_SPENT';
                setError(err);
                setPhase('ready');
                return { interrupted: true, reason: 'inputs-spent', liveness };
            }
            setPhase('signing');
        }

        // §4.6 staleness re-check: if the report is stale, re-check (bypassing
        // the cache) before signing.
        try {
            const stale = report && (Date.now() - reportStampRef.current > STALENESS_MS);
            if (stale && typeof args.preflight === 'function') {
                setPhase('rechecking');
                const fresh = await args.preflight({
                    actionString: built.actionString,
                    source: args.source,
                    localDeltas: await gatherLocalDeltas(args),
                    bypassCache: true,
                    // Same mode as the first check, for the same reason: a
                    // re-check that asked a different question could only
                    // produce a verdict change nobody could explain.
                    feeMode: built.payFeeInNativeCoin ? 'native' : undefined,
                    mode: args.preflightOpts?.mode || 'report',
                });
                setReport(fresh);
                reportStampRef.current = Date.now();
                // Verdict DEGRADED -> interrupt instead of signing.
                if (verdictRank(fresh?.verdict) > verdictRank(report?.verdict)) {
                    setPhase('ready');
                    return { interrupted: true, reason: 'findings-changed' };
                }
                setPhase('signing');
            }
        } catch { /* re-check best-effort: proceed under the old report */ }

        // §4.6, the third Approve-time re-check: is the native-coin
        // protocol fee this PSBT already pays still the amount the chain will
        // accept? The output was sized at COMPOSE, and the amount consensus
        // requires moves INVERSELY with the coin's USD price, so an adverse
        // move of a little over 5 % (FEE_TOLERANCE_MIN) is enough to make it
        // short - and a short native fee is not a retry, it is a real on-chain
        // payment kept by FEE_DESTINATION while the action indexes invalid.
        //
        // Ungated by staleness, unlike the two re-checks above: those protect
        // against something that becomes MORE likely with age (a spent coin, a
        // changed verdict), while an oracle round can land one block after the
        // compose, and the thing at stake here is money already committed to
        // the transaction rather than an attempt that can simply be repeated.
        //
        // Refuses rather than re-composing: the user approved specific bytes,
        // and swapping in a differently-priced transaction under a screen they
        // have already read is the one thing an authorization surface must not
        // do. The message tells them to start the action again.
        if (typeof args.requoteNativeFee === 'function' && Number(built.quote?.requiredFeeSats) > 0) {
            setPhase('rechecking');
            let fresh = null;
            try {
                fresh = await args.requoteNativeFee({
                    actionString: built.actionString,
                    source: args.source,
                });
            } catch {
                // Unreachable explorer / missing route: judged `unavailable`
                // below, which proceeds. A dead network must not hard-block a
                // transaction that is probably still correctly priced (§4.2).
                fresh = null;
            }
            const requote = compareNativeFeeQuote({ composed: built.quote, fresh });
            if (isNativeFeeRefusal(requote)) {
                const err = nativeFeeChangedError(requote);
                setError(err);
                setPhase('ready');
                return { interrupted: true, reason: 'fee-changed', requote };
            }
            setPhase('signing');
        }

        // §4.7 reservation at Approve (post sync-disable, before async signing).
        // Guarded on reservationId: a credential re-prompt (§5.3.4) calls
        // approve() again for the SAME composed PSBT, and re-reserving would
        // both double-count the amount and orphan the first id (teardown only
        // releases the last one).
        // When the caller did not name what it spends, derive it from
        // the projected balances the compose envelope already carries. That
        // gives every form migrated via useActionConfirmFlow the same
        // two-window protection Send has, without 24 forms each declaring a
        // reserve descriptor by hand.
        const reserve = args.reserve && args.reserve.tick
            ? args.reserve
            : reserveFromSimulation(built.simulation);
        if (args.reservationLedger && reserve && reserve.tick && !optsRef.current.reservationId) {
            const rid = built.actionString + ':' + String(instanceId).slice(0, 8) + ':' + Date.now();
            optsRef.current.reservationId = rid;
            try {
                await args.reservationLedger.reserve({
                    id: rid, chainId: args.chainId, tick: reserve.tick, amount: String(reserve.amount),
                });
            } catch { /* best-effort */ }
        }

        try {
            setError(null);   // clear a previous attempt's credential error
            const value = await args.onApprove(credentials, built);
            setPhase('done');
            settleResolve(value);
            return value;
        } catch (err) {
            // §5.3.4 signing-phase credential failure: re-prompt on the SAME
            // PSBT instead of tearing the modal down. The confirm() promise
            // stays PENDING so the caller's flow is uninterrupted and the user
            // can just retype and Approve again (no re-compose, no re-sign of
            // a different PSBT).
            if (isCredentialFailure(err)) {
                setError(err);
                setPhase('ready');
                return { interrupted: true, reason: 'bad-credentials' };
            }

            // §5.3.4 post-sign broadcast failure, split on PERMANENCE.
            // submitAction has already done the durable half host-side
            // (PendingTx queued vs failed, queue handoff); the modal only has
            // to end in the right terminal state.
            const kind = broadcastFailureKindFromError(err);
            if (kind === 'transient') {
                // The tx IS signed and sitting in the broadcast queue - not a
                // failure from the user's point of view. Terminal "Signed - not
                // broadcast yet", and RESOLVE so callers don't render an error.
                setPhase('signed-not-broadcast');
                setError(null);
                const queuedResult = { queued: true, broadcast: 'queued', error: { name: err?.name, message: err?.message } };
                settleResolve(queuedResult);
                return queuedResult;
            }
            if (kind === 'permanent') {
                // Can never confirm as-is (inputs spent / confirmed conflict).
                // PendingTx is already `failed`; re-signing is forbidden, so the
                // caller must re-compose. Terminal error.
                setPhase('error');
                setError(err);
                settleReject(err);
                return undefined;
            }

            // Everything else is terminal.
            setPhase('error');
            setError(err);
            settleReject(err);
            return undefined;
        }
    }, [report, instanceId, settleResolve, settleReject]);

    const reject = useCallback(() => {
        settleReject(new UserRejectedError());
        setPhase('idle');
    }, [settleReject]);

    const acknowledge = useCallback((code) => {
        setAcknowledged((prev) => toggleAcknowledged(prev, code));
    }, []);

    return {
        confirm, approve, reject, acknowledge,
        phase, composing, composed, report, error, acknowledged,
        // Approve is allowed when every non-overridable error is absent AND
        // every overridable error the report carries has been acknowledged.
        canApprove: canApproveWithReport(report, acknowledged),
    };
}

// Only the caller's explicit pending deltas are gathered here. In-flight
// approval reservations are netted HOST-side (action.preflight reads the
// shared ledger), so netting them again here would double-count.
function gatherLocalDeltas(args) {
    return Array.isArray(args.preflightOpts?.localDeltas) ? args.preflightOpts.localDeltas.slice() : [];
}

function verdictRank(v) { return v === 'fail' ? 2 : v === 'warn' ? 1 : 0; }

function makeSessionId() {
    return `cs:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Write the confirm session (§5.4). Best-effort by design: the store is
 * a convenience over a re-entry, so a storage hiccup must never interrupt a
 * confirm the user is standing in front of.
 */
function persistSession(args, id, built, report) {
    if (!args.session || !args.resume) return;
    Promise.resolve(args.session.put({
        id,
        request: args.resumeRequest || null,
        composed: built,
        report: report || null,
        // Stored as messaging METHOD NAMES plus a request body, never a
        // closure: a stored confirm has to be approvable without its
        // originating form, and the resume surface allow-lists the names it
        // will call (that builder-name precedent).
        dispatch: args.resume,
        createdAt: Date.now(),
    })).catch(() => {});
}

/**
 * A signing-phase CREDENTIAL failure (§5.3.4) - bad password / declined HW -
 * as opposed to a compose, pre-flight, or broadcast failure. These re-prompt
 * on the same PSBT; everything else is terminal.
 *
 * The error crosses the messaging boundary as a plain object, so match on the
 * fields that survive: `name` (what the software-unlock path throws) plus a
 * code/message fallback.
 */
export function isCredentialFailure(err) {
    if (!err) return false;
    if (err.name === 'InvalidPasswordError') return true;
    const code = err.code || err.reason;
    if (code === 'INVALID_PASSWORD' || code === 'BAD_CREDENTIALS') return true;
    return /incorrect password|invalid password|bad password/i.test(String(err.message || ''));
}

/**
 * The §4.2 Approve gate, as a pure function: a locally-provable
 * (`overridable: false`) error hard-blocks, a network-sourced one blocks until
 * the user explicitly acknowledges that specific finding, and no report at all
 * (best-effort, timed out, or pre-flight skipped) allows.
 *
 * Exported because the extension's approval window is a SEPARATE React root
 * that renders <PreflightPanel> without running this hook's state machine
 * (§5.6 slice 4). Two implementations of "may the user sign this" is
 * exactly the drift that would let one surface honour an override rule the
 * other ignores, so both read this one.
 *
 * @param {import('xchain-sdk').PreflightReport | null} report
 * @param {Set<string>} acknowledged
 * @returns {boolean}
 */
export function canApproveWithReport(report, acknowledged) {
    if (!report) return true; // no report (best-effort / timed out): allow
    for (const f of report.findings) {
        if (f.severity !== 'error') continue;
        if (f.overridable === false) return false;           // hard block
        if (!acknowledged.has(f.code)) return false;         // needs explicit ack
    }
    return true;
}

/**
 * Adds or REMOVES `code` from the acknowledged set (§4.2 override).
 *
 * It removes because <PreflightPanel> renders each override as a CHECKBOX, and
 * an add-only handler makes that checkbox a one-way latch: a stray click on
 * "Sign anyway" - next to a finding that says the network expects this
 * transaction to fail - could never be taken back for the life of the modal.
 * Irreversible accidental consent is the one thing a deliberate-authorization
 * screen must not have. Un-acknowledging only ever re-blocks Approve, so this
 * cannot loosen any gate.
 *
 * Shared with the extension's approval window for the same reason
 * `canApproveWithReport` is: that window keeps its own acknowledgment state in
 * a separate React root, and it carried an identical add-only copy of this.
 *
 * @param {Set<string>} prev
 * @param {string} code
 * @returns {Set<string>}
 */
export function toggleAcknowledged(prev, code) {
    const next = new Set(prev);
    if (!next.delete(code)) next.add(code);
    return next;
}
