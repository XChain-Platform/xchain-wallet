// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createElement, useCallback, useEffect } from 'react';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { useConfirmModal } from './useConfirmModal.js';

/**
 * Guard an in-app exit and a browser window close while a form has meaningful
 * input or a transaction may exist only in the current renderer.
 *
 * @param {object} options
 * @param {boolean} options.dirty
 * @param {boolean} [options.submitting]
 * @param {boolean} [options.signedUnbroadcast]
 * @param {number} [options.unsentRows] rows of a part-way multi-row run that have not been
 *   broadcast; leaving stops the run, so the exit asks first (the form keeps them as a draft).
 * @param {() => void} options.onLeave
 * @param {() => void} [options.onDiscard] runs only when the user confirms
 *   "Discard and leave", before onLeave, so a form can drop its saved draft.
 *   A clean exit skips it: a stored draft the user never restored stays.
 */
export function useFormLeaveGuard({ dirty, submitting = false, signedUnbroadcast = false, unsentRows = 0, onLeave, onDiscard }) {
    const confirmDialog = useConfirmModal();
    const shouldWarn = dirty || submitting || signedUnbroadcast || unsentRows > 0;

    useEffect(() => {
        if (!shouldWarn) return undefined;
        const handleBeforeUnload = (event) => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [shouldWarn]);

    const guardedOnBack = useCallback(async () => {
        if (!shouldWarn) {
            onLeave();
            return;
        }

        let request;
        let discarding = false;
        if (signedUnbroadcast) {
            request = {
                title: 'Leave signed transaction?',
                message: 'This signed transaction is held only in this window and may be lost if you leave. Broadcast it or copy the signed bytes first.',
                confirmLabel: 'Leave anyway',
                danger: true,
            };
        } else if (submitting) {
            request = {
                title: 'Leave while processing?',
                message: 'The transaction may already be signed and waiting to broadcast. Stay until its result is shown.',
                confirmLabel: 'Leave anyway',
                danger: true,
            };
        } else if (unsentRows > 0) {
            request = {
                title: 'Leave with unsent rows?',
                message: unsentRows === 1
                    ? '1 row has not been sent. Leave anyway?'
                    : `${unsentRows} rows have not been sent. Leave anyway?`,
                confirmLabel: 'Leave anyway',
                danger: true,
            };
        } else {
            discarding = true;
            request = {
                title: 'Discard changes?',
                message: 'Your unsaved changes will be lost.',
                confirmLabel: 'Discard and leave',
                danger: true,
            };
        }

        if (!(await confirmDialog.confirm(request))) return;
        if (discarding) onDiscard?.();
        onLeave();
    }, [confirmDialog, onLeave, onDiscard, shouldWarn, signedUnbroadcast, submitting, unsentRows]);

    const confirmation = confirmDialog.request
        ? createElement(ConfirmModal, {
            ...confirmDialog.request,
            onConfirm: confirmDialog.onConfirm,
            onCancel: confirmDialog.onCancel,
        })
        : null;

    return { guardedOnBack, confirmation };
}
