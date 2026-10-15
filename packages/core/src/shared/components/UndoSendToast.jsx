// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useLayoutEffect, useRef } from 'react';
import styles from './UndoSendToast.module.css';
import { restingPlacement } from './toastPlacement.js';

/**
 * Props-only countdown toast for a held send. Owns no timer or state: the
 * parent passes the controller status and the whole seconds remaining, and
 * re-renders it each tick. Its only effect picks the same resting corner as
 * the host toast stack.
 *
 * - `counting`: live status line plus a Cancel button.
 * - `cancelled`: live status line, no button.
 * - anything else (`idle`, `elapsed`, unknown): renders nothing.
 */
export function UndoSendToast({ status, remaining, onCancel }) {
    const visible = status === 'counting' || status === 'cancelled';
    const stackRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    useLayoutEffect(() => {
        if (stackRef.current) stackRef.current.dataset.placement = restingPlacement();
    }, [visible]);
    if (!visible) return null;
    const counting = status === 'counting';
    return (
        <div ref={stackRef} className={styles.stack}>
            <div className={styles.toast} data-variant="info">
                <span className={styles.icon} aria-hidden="true">ℹ</span>
                <span
                    className={styles.message}
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                >
                    {counting ? `Sending in ${remaining} s` : 'Send cancelled'}
                </span>
                {counting && (
                    <div className={styles.controls}>
                        <button
                            type="button"
                            className={styles.cancelBtn}
                            onClick={() => {
                                if (typeof onCancel === 'function') onCancel();
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
