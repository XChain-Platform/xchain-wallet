// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useId, useRef } from 'react';
import { Button } from '@xchain-wallet/core/ui';
import styles from './NoticeModal.module.css';
import { useBackHandler } from '../../ui/backStack.js';
import { useFocusTrap, useInertBackground } from '../utils/focusTrap.js';

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
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onCancel
 */
export function ConfirmModal({
    title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, onConfirm, onCancel,
}) {
    const rootRef = useRef(null);
    const panelRef = useRef(null);
    const titleId = useId();
    const messageId = useId();
    useFocusTrap(panelRef, { active: true });
    useInertBackground(rootRef, { active: true });
    useBackHandler(onCancel);
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onCancel]);

    return (
        <div
            ref={rootRef}
            className={styles.overlay}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={message ? messageId : undefined}
            onClick={onCancel}
            tabIndex={-1}
        >
            <div ref={panelRef} className={styles.panel} onClick={(e) => e.stopPropagation()} role="presentation" tabIndex={-1}>
                <p id={titleId} className={styles.title}>{title}</p>
                {message ? <p id={messageId} className={styles.message}>{message}</p> : null}
                <div style={{ display: 'flex', gap: 'var(--xc-space-2)' }}>
                    <Button variant="secondary" block onClick={onCancel}>
                        {cancelLabel}
                    </Button>
                    <Button variant={danger ? 'danger' : 'primary'} block onClick={onConfirm}>
                        {confirmLabel}
                    </Button>
                </div>
            </div>
        </div>
    );
}
