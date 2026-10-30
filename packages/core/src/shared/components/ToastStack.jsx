// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Button } from '../../ui/Button.jsx';
import styles from './ToastStack.module.css';
import { t } from '../../i18n/index.js';

/**
 * The visible toast cards inside `<ToastHost>`'s viewport: the overflow count
 * and up to three cards. ToastHost loads this module on demand so the card
 * styles stay out of the startup CSS; the viewport and its live region stay
 * in ToastHost because they exist from the first frame.
 *
 * @param {object} props
 * @param {Array<{ id: string, message: string, variant?: string, actionLabel?: string, onAction?: () => unknown }>} props.toasts
 * @param {number} props.hiddenCount
 * @param {(toast: object) => void} props.onAction
 * @param {(id: string) => void} props.onDismiss
 */
export function ToastStack({ toasts, hiddenCount, onAction, onDismiss }) {
    return (
        <>
            {hiddenCount > 0 ? (
                <div className={styles.overflowBadge} aria-hidden="true">
                    {t('components.toastHost.more', { hiddenCount })}
                </div>
            ) : null}
            {toasts.map((toast) => (
                <ToastItem
                    key={toast.id}
                    toast={toast}
                    onAction={() => onAction(toast)}
                    onDismiss={() => onDismiss(toast.id)}
                />
            ))}
        </>
    );
}

function ToastItem({ toast, onAction, onDismiss }) {
    const presentation = TOAST_PRESENTATION[toast.variant || 'default'] || TOAST_PRESENTATION.default;
    return (
        <div
            className={`${styles.toast} ${styles[`variant_${presentation.tone}`]}`}
            data-variant={presentation.tone}
            onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                onDismiss();
            }}
        >
            <span className={styles.icon} aria-hidden="true">{presentation.icon}</span>
            <span className={styles.message}>{toast.message}</span>
            <div className={styles.controls}>
                {toast.actionLabel && toast.onAction ? (
                    <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={onAction}
                    >
                        {toast.actionLabel}
                    </button>
                ) : null}
                <Button
                    size="sm"
                    variant="secondary"
                    className={styles.dismissBtn}
                    icon={<span aria-hidden="true">×</span>}
                    onClick={onDismiss}
                    aria-label={t('components.toastHost.dismissNotification')}
                />
            </div>
        </div>
    );
}

const TOAST_PRESENTATION = {
    default: { tone: 'info', icon: 'ℹ' },
    info: { tone: 'info', icon: 'ℹ' },
    warning: { tone: 'warning', icon: '⚠' },
    success: { tone: 'success', icon: '✓' },
    error: { tone: 'error', icon: '✕' },
};
