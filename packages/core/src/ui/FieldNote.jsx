// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import styles from './FieldNote.module.css';

/**
 * A line of toned text that belongs to one thing on the page: under the field
 * whose value it is about, or beside the item of a review summary it
 * describes. It reads like a field's own error line (a glyph and small toned
 * text) and draws no box, so it never becomes a box inside the form card. A
 * message about the whole form or its context is a FormNotice instead.
 *
 * Several lines pass as `lines`, one paragraph each.
 *
 * @param {object} props
 * @param {'warning' | 'error' | 'info' | 'success'} [props.variant]   default 'warning'
 * @param {'alert' | 'status' | null} [props.role]           default 'alert' for warning and error, 'status' for success, none for info
 * @param {string} [props.id]                               so the field can name it in aria-describedby
 * @param {string} [props.testId]
 * @param {readonly import('react').ReactNode[] | null} [props.lines]
 * @param {import('react').ReactNode} [props.action]   a small link-style recovery control (such as Clear) drawn in the note, under its text
 * @param {import('react').ReactNode} [props.children]
 */
export function FieldNote({ variant = 'warning', role, id, testId, lines, action, children }) {
    const list = Array.isArray(lines) ? lines.filter((line) => line != null && line !== '') : null;
    if (list ? list.length === 0 : (children == null || children === '' || children === false)) return null;
    const tone = TONES[variant] ? variant : 'warning';
    const resolvedRole = role === null ? undefined : (role || DEFAULT_ROLE[tone]);
    return (
        <div id={id} className={`${styles.note} ${styles[tone]}`} role={resolvedRole} data-testid={testId} data-field-note={tone}>
            <span className={styles.glyph} aria-hidden="true">{TONES[tone]}</span>
            <div className={styles.text}>
                {list ? list.map((line, i) => <p key={i}>{line}</p>) : children}
                {action ? <div className={styles.action} data-field-note-action>{action}</div> : null}
            </div>
        </div>
    );
}

const TONES = { warning: '⚠', error: '!', info: 'ℹ', success: '✓' };
const DEFAULT_ROLE = { warning: 'alert', error: 'alert', info: undefined, success: 'status' };
