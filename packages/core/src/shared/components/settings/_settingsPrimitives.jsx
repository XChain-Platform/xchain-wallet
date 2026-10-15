// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Shared layout primitives for the §35 Settings panels. Extracted so
// each section gets the same row chrome / status fallback / toggle
// styling without restating the inline-style blob 14 times.
//
// Underscore prefix marks this as internal to `components/settings/`;
// other directories shouldn't import from here.

import { cloneElement, useId } from 'react';
import { StatusMessage, Switch } from '@xchain-wallet/core/ui';
import { userFacingMessage } from '../../utils/userFacingMessage.js';
import cardStyles from '../../../ui/Card.module.css';

// A row's layout. The rows below draw their surface with the shared card
// class (ui/Card.module.css), so a row inside a wide form card flattens.
export const ROW_LAYOUT = {
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 'var(--xc-text-sm)',
    gap: 'var(--xc-space-3)',
};
// The same row as one inline style, drawn from the card tokens, for callers
// that spread it into their own style object.
export const ROW = {
    ...ROW_LAYOUT,
    padding: 'var(--xc-card-pad)',
    background: 'var(--xc-card-bg)',
    border: 'var(--xc-card-border)',
    borderRadius: 'var(--xc-card-radius)',
};
export const STACK = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-settings-row-gap)',
};
export const ROW_LABEL = { color: 'var(--xc-text-muted)' };
// A row's own title: full-strength text so every card in one list reads alike.
export const ROW_TITLE = { color: 'var(--xc-text)', fontWeight: 500 };
export const ROW_VALUE = { color: 'var(--xc-text)', fontWeight: 500 };
export const ROW_HINT = {
    color: 'var(--xc-text-muted)',
    fontSize: 'var(--xc-text-xs)',
    marginTop: 2,
    lineHeight: 1.3,
};
// Settings dropdowns take the shared dropdown look from tokens.css (the
// Network picker's height, padding, border, surface and chevron), so the
// inline style only keeps the control inside its row.
export const SELECT = {
    maxWidth: '100%',
};
// Settings inputs take the shared field metrics (border colour, radius, height,
// padding and type size) so a number box in a row matches the dropdown beside it.
export const INPUT = {
    background: 'var(--xc-surface)',
    color: 'var(--xc-text)',
    border: '1px solid var(--xc-control-border)',
    borderRadius: 'var(--xc-control-radius)',
    boxSizing: 'border-box',
    height: 'var(--xc-control-h-md)',
    padding: '0 var(--xc-control-pad-x-md)',
    fontSize: 'var(--xc-control-font-md)',
    lineHeight: 'var(--xc-control-line)',
    fontFamily: 'inherit',
};
// What a disabled settings input adds: the shared disabled colours, as a disabled Button.
export const INPUT_DISABLED = {
    background: 'var(--xc-control-disabled-bg)',
    borderColor: 'var(--xc-control-disabled-border)',
    color: 'var(--xc-control-disabled-text)',
    WebkitTextFillColor: 'var(--xc-control-disabled-text)',
    cursor: 'not-allowed',
};

export const ROW_COPY = {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 280px',
    minWidth: 'min(100%, 280px)',
};
// The control keeps to the row end beside the copy. On a phone the Settings
// page stylesheet widens this slot to the full row once it wraps under the
// copy, so a kit Select, whose own wrapper would otherwise shrink-wrap, fills
// the line like a native select does.
const CONTROL_SLOT = {
    display: 'flex',
    justifyContent: 'flex-end',
    marginInlineStart: 'auto',
    minWidth: 0,
    maxWidth: '100%',
};
export const EMBEDDED_ROW = {
    ...ROW,
    padding: 'var(--xc-space-1) 0',
    background: 'transparent',
    border: 0,
    borderRadius: 0,
};

/**
 * A settings row that associates one visible label and description with its control.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string} [props.hint]
 * @param {import('react').ReactElement} props.children
 * @param {boolean} [props.embedded]
 */
export function SettingsFieldRow({ label, hint, children, embedded = false }) {
    const generatedId = useId();
    const controlId = children.props.id || `settings-field-${generatedId}`;
    const hintId = hint ? `${controlId}-hint` : undefined;
    const describedBy = [children.props['aria-describedby'], hintId].filter(Boolean).join(' ') || undefined;
    const control = cloneElement(children, {
        id: controlId,
        'aria-describedby': describedBy,
    });

    return (
        <div className={embedded ? undefined : cardStyles.card} style={embedded ? EMBEDDED_ROW : ROW_LAYOUT}>
            <div style={ROW_COPY}>
                <label htmlFor={controlId} style={ROW_VALUE}>{label}</label>
                {hint ? <span id={hintId} style={ROW_HINT}>{hint}</span> : null}
            </div>
            <div data-settings-control="" style={CONTROL_SLOT}>{control}</div>
        </div>
    );
}

const ACTION_TITLE = {
    ...ROW_VALUE,
    margin: 0,
    fontSize: 'inherit',
    lineHeight: 1.3,
    overflowWrap: 'anywhere',
};
const ACTION_HINT = { ...ROW_HINT, margin: 0, overflowWrap: 'anywhere' };
// When the row wraps on a narrow screen the actions keep to the row end, the
// same edge a switch or select sits on.
const ACTION_SLOT = {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 'var(--xc-space-2)',
    marginInlineStart: 'auto',
    maxWidth: '100%',
};

/**
 * A settings row whose control is one or more action buttons: the same
 * bordered row, label and hint as a toggle or field row, with the actions at
 * the row end. The label stays a heading so screen readers can jump between
 * rows.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {import('react').ReactNode} [props.hint]
 * @param {'h2' | 'h3'} [props.headingLevel]
 * @param {import('react').ReactNode} [props.children]   the row's actions
 */
export function SettingsActionRow({ label, hint, headingLevel: Heading = 'h2', children }) {
    return (
        <section className={cardStyles.card} style={ROW_LAYOUT}>
            <div style={ROW_COPY}>
                <Heading style={ACTION_TITLE}>{label}</Heading>
                {hint ? <p style={ACTION_HINT}>{hint}</p> : null}
            </div>
            {children ? <div style={ACTION_SLOT}>{children}</div> : null}
        </section>
    );
}

/**
 * Two-column row with a label, hint, and on-off control.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string} [props.hint]
 * @param {boolean} props.checked
 * @param {(next: boolean) => void} props.onChange
 * @param {boolean} [props.disabled]
 * @param {string} [props.accessibleLabel]
 * @param {boolean} [props.embedded]
 */
export function ToggleRow({
    label,
    hint,
    checked,
    onChange,
    disabled,
    accessibleLabel,
    embedded = false,
}) {
    return (
        <div className={embedded ? undefined : cardStyles.card} style={embedded ? EMBEDDED_ROW : ROW_LAYOUT}>
            <Switch
                label={label}
                description={hint}
                aria-label={accessibleLabel}
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
            />
        </div>
    );
}

/**
 * A settings message: the shared StatusMessage row, so a settings error or
 * status looks like every other inline message in the wallet (it was an
 * outlined box for errors and a dashed box otherwise).
 *
 * @param {object} props
 * @param {string} props.text
 * @param {'error'|'warning'|'success'|'muted'} [props.tone]   muted (the default) is a plain status
 * @param {string} [props.id]
 */
export function Status({ text, tone, id }) {
    const variant = tone === 'error' || tone === 'warning' || tone === 'success' ? tone : 'status';
    return (
        <StatusMessage variant={variant} id={id}>
            {text}
        </StatusMessage>
    );
}

export const SETTINGS_LOAD_FALLBACK = 'Settings could not be loaded. Close and reopen the wallet, then try again.';

/**
 * The settings-load failure as copy a user can read. Copy written for a user
 * passes through; developer or runtime text is logged and replaced.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function settingsLoadErrorText(error) {
    const text = userFacingMessage(error, SETTINGS_LOAD_FALLBACK);
    if (text !== SETTINGS_LOAD_FALLBACK) return `Settings unavailable: ${text}`;
    // Keep the raw cause diagnosable without showing it to the user.
    if (error) console.warn(`[settings] load failed: ${error instanceof Error ? error.message : String(error)}`);
    return SETTINGS_LOAD_FALLBACK;
}

/**
 * The status block every Settings section shows when its settings fail to load.
 *
 * @param {{ error: unknown }} props
 */
export function SettingsLoadError({ error }) {
    return <Status text={settingsLoadErrorText(error)} tone="error" />;
}
