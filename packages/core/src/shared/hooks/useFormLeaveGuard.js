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
 * @param {() => void} options.onLeave
 */
export function useFormLeaveGuard({ dirty, submitting = false, signedUnbroadcast = false, onLeave }) {
    const confirmDialog = useConfirmModal();
    const shouldWarn = dirty || submitting || signedUnbroadcast;

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
        } else {
            request = {
                title: 'Discard changes?',
                message: 'Leave this form and discard your unsaved changes?',
                confirmLabel: 'Discard and leave',
                danger: true,
            };
        }

        if (await confirmDialog.confirm(request)) onLeave();
    }, [confirmDialog, onLeave, shouldWarn, signedUnbroadcast, submitting]);

    const confirmation = confirmDialog.request
        ? createElement(ConfirmModal, {
            ...confirmDialog.request,
            onConfirm: confirmDialog.onConfirm,
            onCancel: confirmDialog.onCancel,
        })
        : null;

    return { guardedOnBack, confirmation };
}
