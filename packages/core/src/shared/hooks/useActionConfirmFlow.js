// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useActionConfirmFlow (, the §5.6 slice-2 migration helper).
//
// MintForm/DestroyForm piloted the  single-encode confirm pipeline
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
    isConfirmModalSliceEnabled,
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
 * @param {object} args
 * @param {any} args.messaging                 the shell's messaging client (host boundary)
 * @param {string} args.walletId
 * @param {'send'|'actionForms'|'bespokeFlows'|'extensionApproval'} [args.slice]
 */
export function useActionConfirmFlow({ messaging, walletId, slice = 'actionForms' }) {
    const { settings } = useSettings();
    const confirmAction = useConfirmAction();
    const enabled = isConfirmModalSliceEnabled(settings, slice);
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
     * @returns {Promise<any>}   resolves with onApprove's return value; rejects with the
     *   documented reasons from useConfirmAction (`busy`, `user-rejected`).
     */
    const run = useCallback(({ chainId, from, actionData, encoderOpts, compose, onApprove }) => (
        confirmAction.confirm({
            chainId,
            source: from?.address,
            preflightOpts: {
                mode: resolvePreflightPrivacy(settings) === 'local' ? 'local' : 'report',
            },
            compose: compose || (() => messaging.composeForConfirm({
                walletId,
                chainId,
                from,
                actionData,
                ...(encoderOpts && Object.keys(encoderOpts).length > 0 ? { encoderOpts } : {}),
            })),
            preflight: (o) => messaging.preflight({ chainId, ...o }),
            onApprove: (_creds, composed) => onApprove({
                psbtHex: composed.psbt,
                encoding: composed.encoding,
                actionString: composed.actionString,
                version: composed.version,
            }, composed),
        })
    ), [confirmAction, messaging, settings, walletId]);

    return {
        /** slice flag: is the single-encode confirm pipeline on for this surface? */
        enabled,
        /** is the confirm page currently rendered in place of the form? */
        open,
        /** pre-open compose is in flight (drives the action button's spinner) */
        composing: confirmAction.composing,
        confirmAction,
        run,
    };
}
