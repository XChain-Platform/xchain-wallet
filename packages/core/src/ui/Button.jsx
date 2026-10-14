// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { forwardRef } from 'react';
import styles from './Button.module.css';
import { iconForLabel } from './icons/index.jsx';

/**
 * Loading indicator sized from the shared icon scale.
 *
 * @param {object} props
 * @param {'sm' | 'md' | 'lg'} [props.size]
 * @param {string} [props.label]
 * @param {string} [props.className]
 */
export function Spinner({ size = 'md', label, className, ...rest }) {
    return (
        <span
            className={[styles.spinnerStatus, className].filter(Boolean).join(' ')}
            role={label ? 'status' : undefined}
            aria-label={label || undefined}
            {...rest}
        >
            <span
                className={[styles.spinner, styles[`spinner_${size}`]].filter(Boolean).join(' ')}
                aria-hidden="true"
            />
            {label ? <span>{label}</span> : null}
        </span>
    );
}

// Auto-icon: if the caller didn't pass an explicit `icon` prop AND
// children is a static string, look the label up via the shared
// `iconForLabel` resolver (in icons/index.jsx). Caller can pass
// `icon={null}` to opt out for the rare label-only button.
function defaultIconFor(children) {
    const Icon = iconForLabel(typeof children === 'string' ? children : null);
    return Icon ? <Icon /> : null;
}

/**
 * @param {object} props
 * @param {'primary' | 'secondary' | 'ghost' | 'link' | 'danger' | 'success'} [props.variant]
 * @param {'sm' | 'md' | 'lg'} [props.size]
 * @param {boolean} [props.block]
 * @param {boolean} [props.loading]
 * @param {boolean} [props.disabled]
 * @param {string} [props.className]
 * @param {'button' | 'submit' | 'reset'} [props.type]
 * @param {(e: import('react').MouseEvent<HTMLButtonElement>) => void} [props.onClick]
 * @param {import('react').ReactNode | null} [props.icon]   icon node before the label, or `null` to suppress the auto-default
 * @param {import('react').ReactNode} [props.children]
 * @param {import('react').Ref<HTMLButtonElement>} [ref]  forwarded to the native button so callers can restore focus to it
 */
export const Button = forwardRef(function Button({
    variant = 'primary',
    size = 'md',
    block = false,
    loading = false,
    disabled = false,
    type = 'button',
    className,
    onClick,
    icon,
    children,
    ...rest
}, ref) {
    // `icon` is `undefined` when the caller didn't pass it → fall back
    // to the auto-lookup. `null` is the explicit opt-out and renders
    // no icon at all. Any truthy value renders verbatim.
    const resolvedIcon = icon === undefined ? defaultIconFor(children) : icon;
    const iconOnly = Boolean(resolvedIcon) && children == null;
    const ariaLabel = rest['aria-label'];
    const ariaLabelledBy = rest['aria-labelledby'];
    if (iconOnly && !(typeof ariaLabel === 'string' && ariaLabel.trim()) && !ariaLabelledBy) {
        throw new Error('Icon-only Button requires an aria-label or aria-labelledby.');
    }
    // A native title keeps the icon action discoverable with a pointer and
    // keyboard focus while the accessible name remains available to AT.
    const title = rest.title || (iconOnly && typeof ariaLabel === 'string' ? ariaLabel : undefined);
    const classes = [
        styles.btn,
        styles[variant],
        styles[size],
        iconOnly ? styles.iconOnly : null,
        block ? styles.block : null,
        loading ? styles.loading : null,
        className,
    ].filter(Boolean).join(' ');
    return (
        <button
            {...rest}
            ref={ref}
            type={type}
            className={classes}
            disabled={disabled || loading}
            onClick={onClick}
            // A caller that tracks its own pending write keeps its busy state.
            aria-busy={loading || String(rest['aria-busy']) === 'true' ? 'true' : 'false'}
            title={title}
        >
            {/* Busy keeps the icon and label in layout (hidden) so the button never resizes; the spinner overlays the centre. */}
            {loading ? <Spinner size={size} className={styles.busySpinner} /> : null}
            {resolvedIcon ? <span className={styles.icon} aria-hidden="true">{resolvedIcon}</span> : null}
            {/* An icon-only button renders no label span: an empty flex item
                plus the icon gap would pull the icon off centre. */}
            {iconOnly ? null : <span className={styles.label}>{children}</span>}
        </button>
    );
});
