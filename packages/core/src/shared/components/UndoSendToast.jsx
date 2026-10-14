// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import styles from './UndoSendToast.module.css';

/**
 * Props-only countdown toast for a held send. Owns no timer, state or
 * effect: the parent passes the controller status and the whole seconds
 * remaining, and re-renders it each tick.
 *
 * - `counting`: live status line plus a Cancel button.
 * - `cancelled`: live status line, no button.
 * - anything else (`idle`, `elapsed`, unknown): renders nothing.
 */
export function UndoSendToast({ status, remaining, onCancel }) {
    if (status !== 'counting' && status !== 'cancelled') return null;
    const counting = status === 'counting';
    return (
        <div className={styles.toast}>
            <span
                className={styles.message}
                role="status"
                aria-live="polite"
                aria-atomic="true"
            >
                {counting ? `Sending in ${remaining} s` : 'Send cancelled'}
            </span>
            {counting && (
                <button
                    type="button"
                    className={styles.cancelBtn}
                    onClick={() => {
                        if (typeof onCancel === 'function') onCancel();
                    }}
                >
                    Cancel
                </button>
            )}
        </div>
    );
}
