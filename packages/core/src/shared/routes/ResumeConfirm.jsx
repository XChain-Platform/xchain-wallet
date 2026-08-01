// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ResumeConfirm ( §5.4). Finishes a confirm the popup closed on.
//
// It runs the SAME useConfirmAction state machine every other signing surface
// runs, with a `compose` that resolves the stored PSBT instead of building a
// new one - the trick slice 3 established for the PSBT and message variants.
// That is deliberate: the Approve gate (§4.2), the credential re-prompt, the
// broadcast-permanence terminals and the session clear all come along, so this
// screen adds a data source, not a second state machine.
//
// Three things it does that a form-owned confirm does not have to:
//
//   1. **Gates on input liveness before anything else** (`alwaysCheckInputs`).
//      A stored confirm is by construction the oldest PSBT in the wallet, and
//      approving one whose coins are gone is the double-broadcast trap
//      §5.3.4 forbids re-signing out of.
//   2. **Re-runs pre-flight rather than trusting the stored report.** The
//      stored one renders instantly so the user is not looking at a blank
//      panel, but it was taken against a chain state that has since moved.
//   3. **Runs the form's own follow-up** (`after`), because the form that
//      would have done it is not on screen.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, Button } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useConfirmAction, isConfirmOpenPhase } from '../hooks/useConfirmAction.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { isHwSource } from '../components/SignCredentials.jsx';

const chainRegistry = registryLib.defaultRegistry();

/**
 * @param {object} props
 * @param {any} props.session          the stored confirm session
 * @param {() => void} props.onDone    broadcast succeeded (or was queued)
 * @param {() => void} props.onCancel  user backed out; the session is cleared either way
 */
export function ResumeConfirm({ session, onDone, onCancel }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const confirmAction = useConfirmAction();
    const [password, setPassword] = useState('');
    // Live mirror of `password`, because `confirm()` captures onApprove ONCE
    // and the user types afterwards - a plain closure would dispatch the empty
    // string it was created with. Send.jsx carries the same ref for the same
    // reason; this screen reproduced the bug by not having one.
    const passwordRef = useRef('');
    const [error, setError] = useState(/** @type {string | null} */(null));
    const [result, setResult] = useState(/** @type {any} */(null));
    const startedRef = useRef(false);

    const composed = session?.composed || {};
    const chainId = composed.chainId || session?.request?.chainId || null;
    const walletId = session?.dispatch?.base?.walletId || null;
    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const signerReady = useSignerReady(walletId);
    // The source address record travels INSIDE the stored request body (every
    // submit route takes a `from` descriptor), so which lane this confirm
    // belongs to is knowable without the form. Reading it from anywhere else
    // would be guessing: offering the password lane for a device-held address
    // is a confirm that can only end in a failed unlock.
    const fromAddress = session?.dispatch?.base?.from || session?.request?.from || null;
    const hw = isHwSource(fromAddress);

    const start = useCallback(async () => {
        try {
            const { method, base } = flowsLib.resumeDispatch(session, { isHw: hw });
            const res = await confirmAction.confirm({
                chainId,
                source: base.from?.address || session?.request?.from?.address,
                // The stored bytes ARE the composed action: resolving them is
                // what keeps §5.3's preview-equals-signed guarantee across the
                // popup close, instead of re-composing a different PSBT.
                compose: () => Promise.resolve(composed),
                preflight: (o) => messaging.preflight({ chainId, ...o }),
                checkInputs: (psbtHex) => messaging.checkInputLiveness({ chainId, psbtHex }),
                // : a resumed confirm is by construction the oldest PSBT
                // in the wallet, so it is the likeliest of all to be carrying a
                // native-coin fee the oracle price has moved out from under.
                requoteNativeFee: ({ actionString, source }) => messaging.requoteNativeFee({
                    chainId, actionString, source,
                }),
                alwaysCheckInputs: true,
                reservationLedger: {
                    reserve: (e) => messaging.reserve(e),
                    release: (id) => messaging.releaseReservation({ id }),
                },
                // No `session`/`resume` here on purpose: a resumed confirm must
                // not store a second copy of itself, and clearing the original
                // is this screen's own job on every exit below. Navigating away
                // mid-resume deliberately leaves it stored - the user has not
                // finished with it, and it is still resumable.
                onApprove: (_creds, built) => {
                    const prebuiltPsbt = {
                        psbtHex: built.psbt,
                        encoding: built.encoding,
                        actionString: built.actionString,
                        version: built.version,
                        deferredFeeOutput: built.deferredFeeOutput || null,
                        deferredOutputs: built.deferredOutputs || [],
                    };
                    return messaging[method]({
                        ...base,
                        prebuiltPsbt,
                        ...(hw
                            ? { signerId: fromAddress?.signerId }
                            : { password: passwordRef.current }),
                    });
                },
            });

            // The form's own post-broadcast bookkeeping, which is not on screen
            // to do it itself. Best-effort in the same way the form's was: the
            // transaction is already broadcast, and failing the whole resume
            // over a record write would be a worse lie than a missing record.
            const txid = res?.txid || res?.broadcast?.txid || '';
            const after = flowsLib.resumeAfter(session, txid);
            if (after) {
                try { await messaging[after.method](after.body); } catch { /* non-fatal */ }
            }
            await messaging.clearConfirmSession({ id: session.id }).catch(() => {});
            // Terminal state stays ON SCREEN. Handing control straight back to
            // the shell here navigated to Home the instant the broadcast
            // returned, so the user was told nothing about a transaction they
            // had just authorized - and the e2e, looking for that confirmation,
            // could only report "never reached a terminal state" for a send
            // that had in fact gone through. `onDone` fires when the user
            // leaves, not when the wallet finishes.
            setResult(res);
        } catch (err) {
            if (err && (err.reason === 'user-rejected' || err.name === 'UserRejectedError')) {
                await messaging.clearConfirmSession({ id: session.id }).catch(() => {});
                onCancel?.();
                return;
            }
            setError(err?.message || 'Could not finish this transaction.');
        }
    }, [session, hw, chainId, composed, messaging, confirmAction, fromAddress, onCancel]);

    // One shot: this screen exists only to finish the stored confirm, so it
    // opens it on mount rather than making the user press a second button to
    // reach the one they were already looking at.
    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        start();
    }, [start]);

    if (isConfirmOpenPhase(confirmAction.phase)) {
        return (
            <ActionConfirmScreen
                confirmAction={confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId || ''}
                chainId={chainId}
                signerReady={signerReady}
                password={password}
                onPasswordChange={(v) => { passwordRef.current = v; setPassword(v); }}
                simulation={composed?.simulation || null}
                hwSource={hw ? fromAddress : null}
                hwSignerInfo={hw ? fromAddress : null}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    return (
        <Screen variant={variant} title={result ? 'Sent' : 'Unfinished transaction'}>
            {error ? <p role="alert">{error}</p> : null}
            {result ? (
                <p data-testid="resume-confirm-sent">
                    Sent.{result.txid || result.broadcast?.txid
                        ? ` Transaction ${result.txid || result.broadcast?.txid}`
                        : ''}
                </p>
            ) : null}
            <Button onClick={() => (result ? onDone?.(result) : onCancel?.())}>Back</Button>
        </Screen>
    );
}
