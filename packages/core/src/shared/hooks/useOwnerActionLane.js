// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The signing lane for an OWNER action on something that already exists: a
// dispenser's close, refill or edit, an order's or swap's cancel or edit.
// Same shape as the create forms: a full wallet composes once host-side, shows
// the shared confirm page with its network dry run and From row, and signs
// those exact bytes on Approve (software or device). Watcher mode never signs,
// so the form stays its review and it builds an unsigned transaction instead.

import { useCallback, useMemo, useRef, useState } from 'react';
import { isHwSource } from '../components/SignCredentials.jsx';
import { useActionConfirmFlow, useConfirmSubmit } from './useActionConfirmFlow.js';
import { useWalletMode } from './useWalletMode.js';

/**
 * @param {object} args
 * @param {any} args.messaging
 * @param {string} args.walletId
 * @param {string} args.chainId
 * @param {any} args.owner          the owner's address record (null until resolved)
 * @param {string} args.software    messaging method that signs with a password
 * @param {string} args.hardware    messaging method that signs on a device
 */
export function useOwnerActionLane({ messaging, walletId, chainId, owner, software, hardware }) {
    const { isWatcherMode } = useWalletMode();
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const hw = isHwSource(owner);
    const [password, setPassword] = useState('');
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    // Approve reads the ref, so it signs with the latest keystrokes.
    const passwordRef = useRef('');
    passwordRef.current = password;
    const submitConfirmed = useConfirmSubmit({
        messaging, isHw: hw, signerId: owner?.signerId, passwordRef, software, hardware,
    });

    // The host flows take the record in this shape; `addressId` is what
    // signs a key imported without a derivation path.
    const from = useMemo(() => (owner ? {
        address: owner.address,
        publicKey: owner.publicKey,
        derivationPath: owner.derivationPath,
        addressId: owner.id,
        source: owner.source,
        signerId: owner.signerId,
    } : null), [owner]);

    /**
     * Run one owner action to its result. Rejects with the confirm hook's
     * `user-rejected` reason when the user presses Reject, which callers
     * treat as a quiet return to the form.
     *
     * @param {object} args
     * @param {{ action: string, params: object }} args.actionData   WIRE params, composed and previewed
     * @param {object} [args.encoderOpts]   fee options, sent to compose and to the signing flow
     * @param {object} [args.submitExtra]   the signing flow's own fields (orderActionIndex, params)
     */
    const run = useCallback(async ({ actionData, encoderOpts = {}, submitExtra = {} }) => {
        if (isWatcherMode) {
            return messaging.buildActionPsbtRequest({ chainId, from, actionData, encoderOpts });
        }
        try {
            return await actionConfirm.run({
                chainId,
                from,
                actionData,
                encoderOpts,
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId, chainId, from, ...encoderOpts, ...submitExtra, prebuiltPsbt,
                }),
            });
        } finally {
            // The typed password never outlives the confirm page, on any exit.
            setPassword('');
        }
    }, [isWatcherMode, messaging, chainId, from, actionConfirm, submitConfirmed, walletId]);

    // The props every ActionConfirmScreen on these surfaces shares; each
    // caller adds its own chain label, variant and action-specific notes.
    const confirmProps = {
        confirmAction: actionConfirm.confirmAction,
        password,
        onPasswordChange: setPassword,
        hwSource: hw ? owner : null,
        hwStatus,
        onHwStatusChange,
        chainId,
        getSignerStatus: messaging.getSignerStatus,
    };

    return {
        isWatcherMode,
        hw,
        from,
        open: actionConfirm.open,
        composing: actionConfirm.composing,
        run,
        confirmProps,
    };
}
