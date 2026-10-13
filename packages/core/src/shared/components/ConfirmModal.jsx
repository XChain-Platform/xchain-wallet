// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useId, useRef } from 'react';
import { Button } from '@xchain-wallet/core/ui';
import styles from './NoticeModal.module.css';
import { useBackHandler } from '../../ui/backStack.js';
import { useFocusTrap, useInertBackground } from '../utils/focusTrap.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';

/**
 * Small centered confirm/cancel dialog: the in-app replacement for the native
 * `window.confirm()` (which blocks the renderer thread and looks nothing like
 * the rest of the wallet). Sibling of NoticeModal (OK-only); this one has two
 * exits. Escape and the backdrop both Cancel. Cancel is auto-focused so a
 * destructive action is never one stray Enter away. Pair with `useConfirmModal`
 * for `await confirm(...)` ergonomics at the call site.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.message]
 * @param {string} [props.confirmLabel]  defaults to "Confirm"
 * @param {string} [props.cancelLabel]   defaults to "Cancel"
 * @param {boolean} [props.danger]       style the confirm button as destructive
 * @param {boolean} [props.busy]         keep the dialog open and disable dismissal while confirming
 * @param {string | null} [props.error]  confirmation failure shown inside the dialog
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onCancel
 */
export function ConfirmModal({
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
    busy = false,
    error = null,
    onConfirm,
    onCancel,
}) {
    const cancel = useCallback(() => { if (!busy) onCancel(); }, [busy, onCancel]);
    const confirmingRef = useRef(false);
    const confirm = useCallback((event) => {
        event?.preventDefault();
        // Hold the first activation while the parent closes the dialog or exposes its busy state.
        if (busy || confirmingRef.current) return;
        confirmingRef.current = true;
        const release = () => { confirmingRef.current = false; };
        try {
            const result = onConfirm();
            if (result && typeof result.then === 'function') {
                Promise.resolve(result).then(release, release);
            } else {
                setTimeout(release, 0);
            }
        } catch (error) {
            release();
            throw error;
        }
    }, [busy, onConfirm]);
    const rootRef = useRef(null);
    const panelRef = useRef(null);
    const titleId = useId();
    const messageId = useId();
    useFocusTrap(panelRef, { active: true });
    useInertBackground(rootRef, { active: true });
    // The system Back gesture closes this before it leaves the screen.
    useBackHandler(cancel);
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') cancel(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [cancel]);

    return (
        <div
            ref={rootRef}
            className={styles.overlay}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={message ? messageId : undefined}
            aria-busy={busy ? 'true' : 'false'}
            onClick={cancel}
            tabIndex={-1}
        >
            <div ref={panelRef} className={styles.panel} onClick={(e) => e.stopPropagation()} role="presentation" tabIndex={-1}>
                <p id={titleId} className={styles.title}>{title}</p>
                {message ? <p id={messageId} className={styles.message}>{message}</p> : null}
                {error ? (
                    <p role="alert" className={styles.error}>
                        {userFacingMessage(error, 'Could not complete this request. Try again.')}
                    </p>
                ) : null}
                <div style={{ display: 'flex', gap: 'var(--xc-space-2)' }}>
                    <Button variant="secondary" block onClick={cancel} disabled={busy} autoFocus>
                        {cancelLabel}
                    </Button>
                    <Button
                        variant={danger ? 'danger' : 'primary'}
                        block
                        onClick={confirm}
                        loading={busy}
                        disabled={busy}
                    >
                        {confirmLabel}
                    </Button>
                </div>
            </div>
        </div>
    );
}
