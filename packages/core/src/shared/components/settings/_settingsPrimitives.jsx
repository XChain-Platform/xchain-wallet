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
import { userFacingMessage } from '../../utils/userFacingMessage.js';

export const ROW = {
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--xc-space-2) var(--xc-space-3)',
    background: 'var(--xc-surface-raised)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
    fontSize: 'var(--xc-text-sm)',
    gap: 'var(--xc-space-3)',
};
export const STACK = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-1)',
};
export const ROW_LABEL = { color: 'var(--xc-text-muted)' };
export const ROW_VALUE = { color: 'var(--xc-text)', fontWeight: 500 };
export const ROW_HINT = {
    color: 'var(--xc-text-muted)',
    fontSize: 'var(--xc-text-xs)',
    marginTop: 2,
    lineHeight: 1.3,
};
export const SELECT = {
    background: 'var(--xc-bg)',
    color: 'var(--xc-text)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-2)',
    fontSize: 'var(--xc-text-sm)',
    fontFamily: 'inherit',
};
export const INPUT = {
    background: 'var(--xc-bg)',
    color: 'var(--xc-text)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-2)',
    fontSize: 'var(--xc-text-sm)',
    fontFamily: 'inherit',
};

export const ROW_COPY = {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 280px',
    minWidth: 'min(100%, 280px)',
};
const EMBEDDED_ROW = {
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
        <div style={embedded ? EMBEDDED_ROW : ROW}>
            <div style={ROW_COPY}>
                <label htmlFor={controlId} style={ROW_VALUE}>{label}</label>
                {hint ? <span id={hintId} style={ROW_HINT}>{hint}</span> : null}
            </div>
            {control}
        </div>
    );
}

/**
 * Two-column row with a label + hint on the left and an `<input
 * type="checkbox">` styled as a toggle on the right.
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
        <SettingsFieldRow label={label} hint={hint} embedded={embedded}>
            <input
                type="checkbox"
                role="switch"
                aria-label={accessibleLabel}
                aria-checked={checked}
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                style={{
                    width: 36,
                    // The shared target token keeps every settings switch at the pointer-size floor.
                    height: 'var(--xc-tap-min)',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                }}
            />
        </SettingsFieldRow>
    );
}

/**
 * @param {object} props
 * @param {string} props.text
 * @param {'error'|'muted'} [props.tone]
 * @param {string} [props.id]
 */
export function Status({ text, tone, id }) {
    return (
        <div id={id} role={tone === 'error' ? 'alert' : undefined} style={{
            padding: 'var(--xc-space-3) var(--xc-space-4)',
            background: 'var(--xc-surface-raised)',
            border: tone === 'error'
                ? '1px solid var(--xc-danger-fg)'
                : '1px dashed var(--xc-border)',
            borderRadius: 'var(--xc-radius-md)',
            color: tone === 'error' ? 'var(--xc-danger-fg)' : 'var(--xc-text-muted)',
            fontSize: 'var(--xc-text-sm)',
        }}>
            {text}
        </div>
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
