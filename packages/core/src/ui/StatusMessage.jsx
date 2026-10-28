// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useContext } from 'react';
import { ShellNoticesContext } from '../shared/components/noticesRoute.js';
import { useHideReachabilityNotice } from '../shared/components/hideReachabilityNotice.js';
import { Button } from './Button.jsx';
import styles from './StatusMessage.module.css';
import { t } from '../i18n/index.js';

/**
 * §53.3 / G169: shared info / warning / error / success row that every form can
 * use in place of an unannounced `<p>` or `<div>`. Picks the right
 * `role` + `aria-live` per variant so screen readers announce the
 * message exactly once when it appears.
 *
 *   variant="status"   role="status" aria-live="polite"  (alias for informational copy)
 *   variant="info"     role="status" aria-live="polite"  (informational copy)
 *   variant="warning"  role="status" aria-live="polite"  (caution / degraded state)
 *   variant="error"    role="alert"  aria-live="assertive" (validation failure / runtime error)
 *   variant="success"  role="status" aria-live="polite"  (confirmation copy after a successful action)
 *
 * Renders nothing when `children` is empty, so callers can mount the
 * component conditionally inside an effect-driven flow without an
 * extra null branch.
 *
 * §37 / G121: `recovery` slot lets a caller surface a one-click fix
 * inline with the error message (e.g. "Insufficient balance? Use Max",
 * "Backup file missing? Browse"). The button shares the message
 * row's aria-live region so the recovery affordance is announced
 * together with the diagnostic.
 *
 * @param {object} props
 * @param {'status' | 'info' | 'warning' | 'error' | 'success'} [props.variant]   default 'status'
 * @param {string} [props.id]
 * @param {import('react').ReactNode} props.children
 * @param {string} [props.className]                          appended after the variant class so callers can space-suffix layout adjustments
 * @param {string} [props.details]                            technical text shown only in a collapsed disclosure
 * @param {{ label: string, onAction: () => void | Promise<void>, ariaLabel?: string, disabled?: boolean }} [props.recovery]   one-click fix shown inline with the message
 * @param {'alert' | 'status' | 'note' | null} [props.role]   overrides the variant's role where the tone and the
 *   announcement differ: a caution the user must hear at once (warning tone, alert role), or
 *   a verification verdict that is a result rather than a failure (error tone, status role).
 *   null drops the role for a message that is part of the page from the first paint, so it is
 *   not a live region at all. The look always follows the variant, so one tone keeps one style.
 * @param {string} [props.testId]                             data-testid for tests that find the message by hook
 * @param {string} [props.lead]                               bold lead-in sentence before the text, such as "Destroy is irreversible."
 *
 * Children may be several block elements (one `<p>` per line of a multi-line
 * warning, or a `<ul>`): they stay one box and one announcement.
 *
 * An error a screen shows in the unlocked shell ("Couldn't load your
 * listings. The network is unreachable.") already says what the shell's
 * "Some balances may be out of date" would, more precisely, so the shell's
 * notice steps aside while it shows and the page carries one message.
 * `keepsShellNotice` opts out, for a box that already carries the shell's
 * sentence (a form's merged notice).
 *
 * @param {boolean} [props.keepsShellNotice]
 */
export function StatusMessage({ variant = 'status', id, children, className, details, recovery, role: roleOverride, testId, lead, keepsShellNotice = false }) {
    const presentation = STATUS_PRESENTATION[variant] || STATUS_PRESENTATION.status;
    const empty = children === null || children === undefined || children === '';
    const inShell = Boolean(useContext(ShellNoticesContext));
    useHideReachabilityNotice(inShell && !empty && !keepsShellNotice && presentation.tone === 'error');
    if (empty) return null;
    const role = roleOverride === null
        ? undefined
        : ROLE_LIVE[roleOverride] !== undefined
            ? roleOverride
            : (presentation.tone === 'error' ? 'alert' : 'status');
    const live = role ? ROLE_LIVE[role] || undefined : undefined;
    const variantClass = styles[presentation.tone];
    const classNames = [styles.row, variantClass, className].filter(Boolean).join(' ');
    return (
        <div
            role={role}
            aria-live={live}
            aria-atomic={live ? 'true' : undefined}
            id={id}
            className={classNames}
            data-variant={presentation.tone}
            data-testid={testId}
        >
            <span className={styles.icon} aria-hidden="true">{presentation.icon}</span>
            <div className={styles.text}>
                <div className={styles.body}>
                    {lead ? <><strong>{lead}</strong>{' '}</> : null}
                    {children}
                </div>
                {details ? (
                    <details className={styles.details}>
                        <summary>{t('pending.detail.technicalDetails')}</summary>
                        <code>{details}</code>
                    </details>
                ) : null}
            </div>
            {recovery && recovery.label && typeof recovery.onAction === 'function' ? (
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={null}
                    className={styles.recovery}
                    aria-label={recovery.ariaLabel || recovery.label}
                    disabled={recovery.disabled}
                    onClick={() => {
                        Promise.resolve(recovery.onAction()).catch(() => {
                            /* swallow; caller surfaces its own follow-up */
                        });
                    }}
                >
                    {recovery.label}
                </Button>
            ) : null}
        </div>
    );
}

const SEVERITY = { success: 0, status: 1, info: 1, warning: 2, error: 3 };

/**
 * Several notices of one page in one box: the page carries one message per
 * state, so a form's caution, its saved draft and the shell's "Some balances
 * may be out of date" read as one notice with a line each, never a stack of
 * boxes. The box takes the most severe tone; each line keeps its bold lead-in
 * and its own action.
 *
 * @param {object} props
 * @param {ReadonlyArray<{
 *   key: string,
 *   variant?: string,
 *   lead?: string,
 *   children: import('react').ReactNode,
 *   recovery?: { label: string, onAction: () => void | Promise<void>, ariaLabel?: string, disabled?: boolean },
 *   details?: string,
 *   role?: 'alert' | 'status' | 'note' | null,
 *   testId?: string,
 *   id?: string,
 * }>} props.entries
 */
export function StatusMessageGroup({ entries }) {
    if (!entries || entries.length === 0) return null;
    const variant = entries.reduce((most, entry) => (
        (SEVERITY[entry.variant || 'status'] ?? 1) > (SEVERITY[most] ?? 1) ? (entry.variant || 'status') : most
    ), entries[0].variant || 'status');
    // A box made only of static notes stays out of the live regions; one
    // holding a note the user must hear at once is announced as an alert.
    let role;
    if (entries.every((entry) => entry.role === entries[0].role)) role = entries[0].role;
    else if (entries.every((entry) => entry.role === null)) role = null;
    else role = entries.some((entry) => entry.role === 'alert') ? 'alert' : undefined;
    return (
        <StatusMessage variant={variant} role={role} className={styles.group} keepsShellNotice>
            {entries.map((entry) => (
                <div key={entry.key} id={entry.id} className={styles.entry} data-testid={entry.testId}>
                    <div className={styles.entryText}>
                        <div>
                            {entry.lead ? <><strong>{entry.lead}</strong>{' '}</> : null}
                            {entry.children}
                        </div>
                        {entry.details ? (
                            <details className={styles.details}>
                                <summary>{t('pending.detail.technicalDetails')}</summary>
                                <code>{entry.details}</code>
                            </details>
                        ) : null}
                    </div>
                    {entry.recovery && entry.recovery.label && typeof entry.recovery.onAction === 'function' ? (
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            icon={null}
                            className={styles.recovery}
                            aria-label={entry.recovery.ariaLabel || entry.recovery.label}
                            disabled={entry.recovery.disabled}
                            onClick={() => {
                                Promise.resolve(entry.recovery.onAction()).catch(() => {
                                    /* swallow; caller surfaces its own follow-up */
                                });
                            }}
                        >
                            {entry.recovery.label}
                        </Button>
                    ) : null}
                </div>
            ))}
        </StatusMessage>
    );
}

// A note is static context, so it is not a live region at all.
const ROLE_LIVE = { alert: 'assertive', status: 'polite', note: null };

const STATUS_PRESENTATION = {
    status: { tone: 'info', icon: 'ℹ' },
    info: { tone: 'info', icon: 'ℹ' },
    warning: { tone: 'warning', icon: '⚠' },
    error: { tone: 'error', icon: '✕' },
    success: { tone: 'success', icon: '✓' },
};
