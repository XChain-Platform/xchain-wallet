// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useActionConfirmFlow (the §5.6 slice-2 migration helper).
//
// MintForm/DestroyForm piloted the single-encode confirm pipeline
// by hand. Repeating those ~60 lines across the remaining ~28 action
// forms would guarantee drift, so the invariant part lives here: read
// the slice flag, own the useConfirmAction state machine, and run the
// one compose -> preflight -> approve round trip with the host-side
// wiring every form needs (composeForConfirm + preflight over
// `messaging`, and a prebuilt-PSBT envelope handed to the form's own
// submit call so Approve signs the byte-identical PSBT the user saw).
//
// The per-form part stays in the form: which wire-format actionData to
// compose, and which messaging method to dispatch on Approve.

import { useCallback } from 'react';
import { useSettings } from './useSettings.js';
import { useConfirmAction, isConfirmOpenPhase } from './useConfirmAction.js';
import {
    resolvePreflightPrivacy,
} from '../../schemas/settings.js';

/**
 * True for the calm "user pressed Reject" exit, which every form
 * swallows instead of rendering an error banner.
 *
 * @param {any} err
 */
export function isUserRejection(err) {
    return !!err && (err.reason === 'user-rejected' || err.name === 'UserRejectedError');
}

/**
 * The Approve dispatcher for a form whose hardware and software
 * lanes are the SAME host flow with a different credential - a typed
 * password, or a paired device reached through the signer bridge
 * (`registerHwHandler` spreads the request straight through, so the `.hw`
 * route signs the prebuilt PSBT byte-identically).
 *
 * Every migrated form needs this branch, and 20 hand-written copies of it
 * is the drift this module exists to prevent: one that forgets `signerId`,
 * or leaks a password onto the HW lane, is a bug no reviewer would catch by
 * eye. Mirrors `useActionForm`'s `submitMethods`, the same convention the
 * legacy review stages already dispatch on.
 *
 * @param {object} args
 * @param {any} args.messaging
 * @param {boolean} args.isHw                   source address is a trezor/ledger
 * @param {string} [args.signerId]              the HW signer record id
 * @param {{ current: string }} args.passwordRef  live password ref (a ref, so
 *   Approve reads the latest keystrokes rather than a stale closure)
 * @param {string} args.software                messaging method for the software lane
 * @param {string} args.hardware                messaging method for the HW lane
 * @returns {(base: object) => Promise<any>}    call with the shared request body
 */
export function useConfirmSubmit({ messaging, isHw, signerId, passwordRef, software, hardware }) {
    return useCallback((base) => (isHw
        ? messaging[hardware]({ ...base, signerId })
        : messaging[software]({ ...base, password: passwordRef.current })
    ), [messaging, isHw, signerId, software, hardware, passwordRef]);
}

/**
 * @param {object} args
 * @param {any} args.messaging                 the shell's messaging client (host boundary)
 * @param {string} args.walletId
 * @param {'send'|'actionForms'|'bespokeFlows'|'extensionApproval'} [args.slice]
 */
export function useActionConfirmFlow({ messaging, walletId, slice = 'actionForms' }) {
    const { settings } = useSettings();
    const confirmAction = useConfirmAction();
    const open = isConfirmOpenPhase(confirmAction.phase);

    /**
     * Compose host-side, stream pre-flight into the confirm page, then sign
     * the prebuilt PSBT on Approve.
     *
     * @param {object} args
     * @param {string} args.chainId
     * @param {{ address: string, publicKey?: string, derivationPath?: string, addressId?: string, source?: string, signerId?: string }} args.from
     * @param {{ action: string, params: object }} [args.actionData]   WIRE-format params (what the encoder will see)
     * @param {object} [args.encoderOpts]      extra encoder options (feePerKb, ...)
     * @param {() => Promise<object>} [args.compose]   host compose override, for the
     *   actions whose wire params cannot be built client-side. MESSAGE is the
     *   case that needs it: its body is encrypted host-side, so the params only
     *   exist once the host has built them (see `action.message.composeForConfirm`).
     *   Must resolve with the same tamper-verified envelope
     *   `action.composeForConfirm` returns. Defaults to the generic route.
     * @param {(prebuiltPsbt: { psbtHex: string, encoding: string, actionString: string, version: any }, composed: object) => Promise<any>} args.onApprove
     * @param {{ software: string, hardware?: string, base: object, after?: object, returnTo?: object, label?: string }} [args.resume]
     * §5.4 opt-in. Supply it only when this form's Approve can be
     *   completed away from the form: `software`/`hardware` name the same
     *   messaging methods `useConfirmSubmit` dispatches, `base` is the request
     *   body minus `prebuiltPsbt`/credentials, and `after` carries any
     *   post-broadcast bookkeeping the form would otherwise have done itself.
     * @returns {Promise<any>}   resolves with onApprove's return value; rejects with the
     *   documented reasons from useConfirmAction (`busy`, `user-rejected`).
     */
    const run = useCallback(({ chainId, from, actionData, encoderOpts, compose, onApprove, resume }) => (
        confirmAction.confirm({
            chainId,
            source: from?.address,
            preflightOpts: {
                mode: resolvePreflightPrivacy(settings) === 'local' ? 'local' : 'report',
            },
            // §4.6: every migrated form gets the input-liveness half of the
            // Approve-time re-check, not just the pre-flight half.
            checkInputs: (psbtHex) => messaging.checkInputLiveness({ chainId, psbtHex }),
            // And the native-fee half. A fee-bearing action on LTC/DOGE
            // pays its protocol fee as a real output sized at compose, so every
            // migrated form needs the same "is that amount still acceptable"
            // re-check before it signs. Quoted from the composed action string,
            // which is what the confirm envelope carries on every surface.
            requoteNativeFee: ({ actionString, source }) => messaging.requoteNativeFee({
                chainId, actionString, source,
            }),
            // Persistence is opt-in per form, via `resume`. The
            // store is wired for all of them so opting in is one argument, but
            // a form that has not said how its Approve completes without it
            // stores nothing - see the `resume` contract in useConfirmAction.
            ...(resume ? {
                resume,
                resumeRequest: { chainId, from, actionData, encoderOpts },
                session: {
                    put: (payload) => messaging.putConfirmSession(payload),
                    clear: (id) => messaging.clearConfirmSession({ id }),
                },
            } : {}),
            compose: compose || (() => messaging.composeForConfirm({
                walletId,
                chainId,
                from,
                actionData,
                ...(encoderOpts && Object.keys(encoderOpts).length > 0 ? { encoderOpts } : {}),
            })),
            preflight: (o) => messaging.preflight({ chainId, ...o }),
            // §4.7: the host-shared reservation ledger, passed for
            // EVERY migrated form. What to reserve is derived from the compose
            // envelope's projected balances (useConfirmAction), so a form does
            // not have to declare it; one background host serves all popup
            // windows, so this is what stops two windows from both spending the
            // same token balance.
            reservationLedger: {
                reserve: (e) => messaging.reserve(e),
                release: (id) => messaging.releaseReservation({ id }),
            },
            onApprove: (_creds, composed) => onApprove({
                psbtHex: composed.psbt,
                encoding: composed.encoding,
                actionString: composed.actionString,
                version: composed.version,
                // On the two-phase lane the protocol fee was left OFF
                // the previewed PSBT because it belongs on the reveal. Carry
                // it so the submit path attaches it there.
                deferredFeeOutput: composed.deferredFeeOutput || null,
                // ...and the rest of the deferred set, which the fee alone omitted.
                deferredOutputs: composed.deferredOutputs || [],
            }, composed),
        })
    ), [confirmAction, messaging, settings, walletId]);

    return {
        /** slice flag: is the single-encode confirm pipeline on for this surface? */
        /** is the confirm page currently rendered in place of the form? */
        open,
        /** pre-open compose is in flight (drives the action button's spinner) */
        composing: confirmAction.composing,
        confirmAction,
        run,
    };
}
