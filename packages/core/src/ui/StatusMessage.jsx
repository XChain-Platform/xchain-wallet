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
import { AlertCircleIcon, CircleCheckIcon, InfoIcon, RefreshIcon, XIcon } from './icons/index.jsx';
import styles from './StatusMessage.module.css';
import { t } from '../i18n/index.js';
import '../i18n/locales/en/shell.js';

/**
 * The dismiss control of a dismissible notice: always the last child of the
 * box, pinned to its top end corner, so every dismissible notice has it in the
 * same place.
 *
 * @param {{ onDismiss: () => void, label?: string }} props
 */
function DismissButton({ onDismiss, label }) {
    return (
        <button
            type="button"
            className={styles.dismiss}
            aria-label={label || t('shell.dismiss')}
            data-notice-dismiss=""
            onClick={() => onDismiss()}
        >
            <XIcon />
        </button>
    );
}

/**
 * The notice's one action: the kit secondary Button (size sm), a refresh icon
 * unless the caller names another. The form error notice (FormErrorSummary)
 * draws its one action with it too.
 *
 * @param {{ action: { label: string, onAction: () => void | Promise<void>, ariaLabel?: string, disabled?: boolean, icon?: import('react').ReactNode } }} props
 */
export function NoticeAction({ action: recovery }) {
    return (
        <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={recovery.icon || <RefreshIcon />}
            className={styles.recovery}
            aria-label={recovery.ariaLabel || recovery.label}
            disabled={recovery.disabled}
            onClick={() => {
                // Swallowed so the notice stays; the caller surfaces its own follow-up.
                Promise.resolve(recovery.onAction()).catch(() => {});
            }}
        >
            {recovery.label}
        </Button>
    );
}

const usableAction = (action) => Boolean(action && action.label && typeof action.onAction === 'function');

/**
 * The wallet's one notice (the Notice Standard, approved 2026-11-15, style 2):
 * a box tinted in its tone with a thin border of the same tone, 8px corners,
 * the tone's icon, an optional bold title on its own line, the body, an
 * optional action and an optional close X in the top end corner.
 *
 * Two tones carry meaning: `info` (a note) and `danger` (a warning, an error
 * or a critical caution, always red). `success` keeps its green for the
 * result of an action. The older variant names still work and map onto
 * them: `status` and `note` are info; `warning`, `error` and `critical`
 * are danger. Only the paint folds: a warning keeps its polite status role
 * and an error its assertive alert role, and `data-variant` keeps the
 * variant name so a test or a screen reader sees what it saw before.
 *
 *   tone="info"     role="status" aria-live="polite"
 *   tone="danger"   role="alert"  aria-live="assertive" (an error)
 *   variant="warning" (danger paint) role="status" aria-live="polite"
 *   tone="success"  role="status" aria-live="polite"
 *
 * A critical caution that is part of the page from the first paint (the
 * recovery phrase warning) passes `role={null}` so it is not a live region.
 *
 * Renders nothing when it has neither `children` nor `title`, so callers can
 * mount it conditionally without an extra null branch.
 *
 * @param {object} props
 * @param {'info' | 'danger' | 'success'} [props.tone]   the Notice Standard tone; wins over `variant`
 * @param {'status' | 'info' | 'warning' | 'error' | 'success' | 'note' | 'danger' | 'critical'} [props.variant]   older name for the tone, default 'status'
 * @param {string} [props.id]
 * @param {import('react').ReactNode} [props.children]
 * @param {import('react').ReactNode} [props.title]           bold title on its own line above the body
 * @param {string} [props.className]                          appended after the tone class so callers can space-suffix layout adjustments
 * @param {string} [props.details]                            technical text shown only in a collapsed disclosure
 * @param {{ label: string, onAction: () => void | Promise<void>, ariaLabel?: string, disabled?: boolean, icon?: import('react').ReactNode }} [props.action]   the notice's one action (a kit secondary sm Button)
 * @param {{ label: string, onAction: () => void | Promise<void>, ariaLabel?: string, disabled?: boolean }} [props.recovery]   older name for `action` (§37 / G121: a one-click fix shown with the message)
 * @param {'alert' | 'status' | 'note' | null} [props.role]   overrides the tone's role where the tone and the
 *   announcement differ: a caution the user must hear at once (alert), or a verification verdict that is a
 *   result rather than a failure (status). null drops the role for a notice that is part of the page from
 *   the first paint, so it is not a live region at all. The look always follows the tone.
 * @param {string} [props.testId]                             data-testid for tests that find the notice by hook
 * @param {import('react').ReactNode} [props.icon]             optional screen-specific icon in the standard notice icon slot
 * @param {string} [props.lead]                               legacy alias for `title`; rendered as a block above the body
 * @param {string} [props.label]                              accessible name for the live region, for a notice found by name such as "Loading markets"
 * @param {boolean} [props.busy]                              marks a loading notice aria-busy while its content loads
 *
 * Children may be several block elements (one `<p>` per line of a multi-line
 * notice, or a `<ul>`): they stay one box and one announcement.
 *
 * An error a screen shows in the unlocked shell ("Couldn't load your
 * listings. The network is unreachable.") already says what the shell's
 * "Some balances may be out of date" would, more precisely, so the shell's
 * notice steps aside while it shows and the page carries one message.
 * `keepsShellNotice` opts out, for a box that already carries the shell's
 * sentence (a form's merged notice). A static critical caution (role null
 * or note) is not an error report, so the shell's notice stays.
 *
 * @param {boolean} [props.keepsShellNotice]
 * @param {() => void} [props.onDismiss]  makes the notice dismissible: a close X is the last child of the box, in its top end corner
 * @param {string} [props.dismissLabel]   accessible name of the close X, default "Dismiss"
 * @param {boolean} [props.marksNotice]   marks the outer box as a notice (data-xc-notice) when its live region sits on an inner element, so a placement check measures the box
 * @param {boolean} [props.flush]         no outer margin, for a container whose own gap spaces it (a collapsible section body)
 */
export function Notice({ tone, variant = 'status', id, children, title, className, details, action, recovery, role: roleOverride, testId, icon, lead, label, busy = false, keepsShellNotice = false, marksNotice = false, flush = false, onDismiss, dismissLabel, ...rest }) {
    // Only data-* attributes pass through to the box (a wrapper's own marker,
    // such as WarningLine's data-warning-line); anything else is ignored.
    const dataProps = Object.fromEntries(Object.entries(rest).filter(([key]) => key.startsWith('data-')));
    const presentation = noticePresentation(tone || variant);
    const emptyBody = children === null || children === undefined || children === '' || children === false;
    const resolvedTitle = title === null || title === undefined || title === '' || title === false ? lead : title;
    const emptyTitle = resolvedTitle === null || resolvedTitle === undefined || resolvedTitle === '' || resolvedTitle === false;
    const empty = emptyBody && emptyTitle;
    const inShell = Boolean(useContext(ShellNoticesContext));
    const reportsError = presentation.variant === 'error' && roleOverride !== null && roleOverride !== 'note';
    useHideReachabilityNotice(inShell && !empty && !keepsShellNotice && reportsError);
    if (empty) return null;
    const role = roleOverride === null
        ? undefined
        : ROLE_LIVE[roleOverride] !== undefined
            ? roleOverride
            : (presentation.variant === 'error' ? 'alert' : 'status');
    const live = role ? ROLE_LIVE[role] || undefined : undefined;
    const classNames = [styles.row, styles[presentation.className], flush ? styles.flush : null, className].filter(Boolean).join(' ');
    const shownAction = usableAction(action) ? action : (usableAction(recovery) ? recovery : null);
    const ToneIcon = TONE_ICON[presentation.tone];
    return (
        <div
            {...dataProps}
            role={role}
            aria-live={live}
            aria-atomic={live ? 'true' : undefined}
            aria-label={label || undefined}
            aria-busy={busy ? 'true' : undefined}
            id={id}
            className={classNames}
            data-variant={presentation.variant}
            data-tone={presentation.tone}
            data-testid={testId}
            data-xc-notice={marksNotice ? '' : undefined}
        >
            <span className={styles.icon} aria-hidden="true">{icon || <ToneIcon />}</span>
            <div className={styles.text}>
                {emptyTitle ? null : <div className={styles.title}>{resolvedTitle}</div>}
                {emptyBody ? null : (
                    <div className={styles.body}>
                        {children}
                    </div>
                )}
                {details ? (
                    <details className={styles.details}>
                        <summary>{t('pending.detail.technicalDetails')}</summary>
                        <code>{details}</code>
                    </details>
                ) : null}
            </div>
            {shownAction ? <NoticeAction action={shownAction} /> : null}
            {typeof onDismiss === 'function' ? <DismissButton onDismiss={onDismiss} label={dismissLabel} /> : null}
        </div>
    );
}

/**
 * The older name of the Notice, kept so every existing call site renders in
 * the Notice Standard with no edit. It is the same component, so a form's
 * notice slot that merges StatusMessage elements merges Notice elements too.
 */
export const StatusMessage = Notice;

const SEVERITY = { success: 0, status: 1, info: 1, note: 1, warning: 2, error: 3, danger: 3, critical: 3 };

/**
 * Several notices of one page in one box: the page carries one message per
 * state, so a form's caution, its saved draft and the shell's "Some balances
 * may be out of date" read as one notice with a line each, never a stack of
 * boxes. The box takes the most severe tone; each line keeps its block title
 * and its own action.
 *
 * @param {object} props
 * @param {ReadonlyArray<{
 *   key: string,
 *   variant?: string,
 *   title?: import('react').ReactNode,
 *   lead?: string,
 *   children: import('react').ReactNode,
 *   recovery?: { label: string, onAction: () => void | Promise<void>, ariaLabel?: string, disabled?: boolean },
 *   onDismiss?: () => void,
 *   details?: string,
 *   role?: 'alert' | 'status' | 'note' | null,
 *   testId?: string,
 *   id?: string,
 * }>} props.entries
 * @param {string} [props.testId] data-testid for the shared notice box
 */
export function StatusMessageGroup({ entries, testId }) {
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
    // A box with one line puts its close X on the box itself (last child, top
    // end corner), exactly as a lone notice does; a box of several lines keeps
    // one X per line.
    const boxDismiss = entries.length === 1 && typeof entries[0].onDismiss === 'function'
        ? entries[0].onDismiss
        : undefined;
    return (
        <Notice variant={variant} role={role} className={styles.group} keepsShellNotice onDismiss={boxDismiss} testId={testId}>
            {entries.map((entry) => (
                <div key={entry.key} id={entry.id} className={styles.entry} data-testid={entry.testId}>
                    <div className={styles.entryText}>
                        {entry.title || entry.lead ? <div className={styles.title}>{entry.title || entry.lead}</div> : null}
                        <div>
                            {entry.children}
                        </div>
                        {entry.details ? (
                            <details className={styles.details}>
                                <summary>{t('pending.detail.technicalDetails')}</summary>
                                <code>{entry.details}</code>
                            </details>
                        ) : null}
                    </div>
                    {usableAction(entry.recovery) ? <NoticeAction action={entry.recovery} /> : null}
                    {typeof entry.onDismiss === 'function' && !boxDismiss ? <DismissButton onDismiss={entry.onDismiss} /> : null}
                </div>
            ))}
        </Notice>
    );
}

// A note is static context, so it is not a live region at all.
const ROLE_LIVE = { alert: 'assertive', status: 'polite', note: null };

const TONE_ICON = { info: InfoIcon, danger: AlertCircleIcon, success: CircleCheckIcon };

const PRESENTATION = {
    status: { variant: 'info', tone: 'info', className: 'info' },
    info: { variant: 'info', tone: 'info', className: 'info' },
    note: { variant: 'info', tone: 'info', className: 'info' },
    warning: { variant: 'warning', tone: 'danger', className: 'warning' },
    error: { variant: 'error', tone: 'danger', className: 'error' },
    danger: { variant: 'error', tone: 'danger', className: 'error' },
    critical: { variant: 'error', tone: 'danger', className: 'error' },
    success: { variant: 'success', tone: 'success', className: 'success' },
};

/**
 * The paint and announcement of a tone or older variant name.
 *
 * @param {string} [name]
 * @returns {{ variant: 'info' | 'warning' | 'error' | 'success', tone: 'info' | 'danger' | 'success', className: string }}
 */
export function noticePresentation(name) {
    return PRESENTATION[name] || PRESENTATION.status;
}
