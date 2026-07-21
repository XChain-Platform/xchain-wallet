// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useConfirmAction ( §5.1, §5.3.5).
//
// Drives the single-encode confirm pipeline. All SDK work is HOST-side
// (the React tree only reaches the host over `messaging`): the injected
// `compose` runs composeForConfirm + the tamper check in the background
// and resolves with an already-verified ComposedAction; `preflight` runs
// sdk.preflight in the background. The hook itself is a pure UI state
// machine: compose PRE-OPEN, open the modal, stream pre-flight, and on
// Approve re-check staleness before signing the byte-identical PSBT. One
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

export function useConfirmAction() {
    const instanceId = useRef(Symbol('confirm-action')).current;
    const abortRef = useRef(null);
    const resolveRef = useRef(null);
    const rejectRef = useRef(null);
    const optsRef = useRef(null);
    const composedRef = useRef(null);
    const reportStampRef = useRef(0);

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
     * @returns {Promise<any>}
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
                setComposed(built);
                setComposing(false);
                setPhase('preflighting'); // MODAL OPENS HERE

                // Pre-flight streams in HOST-side; Approve stays disabled until
                // it lands. Best-effort: any failure (or no preflight backend)
                // goes ready with a null report so the user can still proceed.
                if (typeof args.preflight !== 'function') { setPhase('ready'); return; }
                try {
                    const localDeltas = await gatherLocalDeltas(args);
                    const rpt = await args.preflight({
                        actionString: built.actionString,
                        source: args.source,
                        localDeltas,
                        mode: args.preflightOpts?.mode || 'report',
                    });
                    if (controller.signal.aborted) return; // superseded; never render
                    reportStampRef.current = Date.now();
                    setReport(rpt);
                    setPhase('ready');
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

        // §4.6 staleness re-check: if the report is stale, re-check (bypassing
        // the cache) + re-validate input liveness before signing.
        try {
            const stale = report && (Date.now() - reportStampRef.current > STALENESS_MS);
            if (stale && typeof args.preflight === 'function') {
                setPhase('rechecking');
                const fresh = await args.preflight({
                    actionString: built.actionString,
                    source: args.source,
                    localDeltas: await gatherLocalDeltas(args),
                    bypassCache: true,
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

        // §4.7 reservation at Approve (post sync-disable, before async signing).
        if (args.reservationLedger && args.reserve && args.reserve.tick) {
            const rid = built.actionString + ':' + String(instanceId).slice(0, 8) + ':' + Date.now();
            optsRef.current.reservationId = rid;
            try {
                await args.reservationLedger.reserve({
                    id: rid, chainId: args.chainId, tick: args.reserve.tick, amount: String(args.reserve.amount),
                });
            } catch { /* best-effort */ }
        }

        try {
            const value = await args.onApprove(credentials, built);
            setPhase('done');
            settleResolve(value);
            return value;
        } catch (err) {
            // Broadcast-permanence branching is handled by submitAction /
            // the queue; here we surface a terminal error state.
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
        setAcknowledged((prev) => {
            const next = new Set(prev);
            next.add(code);
            return next;
        });
    }, []);

    return {
        confirm, approve, reject, acknowledge,
        phase, composing, composed, report, error, acknowledged,
        // Approve is allowed when every non-overridable error is absent AND
        // every overridable error the report carries has been acknowledged.
        canApprove: computeCanApprove(report, acknowledged),
    };
}

async function gatherLocalDeltas(args) {
    const deltas = Array.isArray(args.preflightOpts?.localDeltas) ? args.preflightOpts.localDeltas.slice() : [];
    if (args.reservationLedger) {
        try {
            const reserved = await args.reservationLedger.localDeltas(args.chainId, null);
            for (const r of reserved) deltas.push(r);
        } catch { /* best-effort */ }
    }
    return deltas;
}

function verdictRank(v) { return v === 'fail' ? 2 : v === 'warn' ? 1 : 0; }

function computeCanApprove(report, acknowledged) {
    if (!report) return true; // no report (best-effort / timed out): allow
    for (const f of report.findings) {
        if (f.severity !== 'error') continue;
        if (f.overridable === false) return false;           // hard block
        if (!acknowledged.has(f.code)) return false;         // needs explicit ack
    }
    return true;
}
