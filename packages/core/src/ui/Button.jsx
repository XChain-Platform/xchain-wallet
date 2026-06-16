// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import styles from './Button.module.css';
import { iconForLabel } from './icons/index.jsx';

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
 * @param {'primary' | 'secondary' | 'ghost' | 'danger'} [props.variant]
 * @param {'sm' | 'md'} [props.size]
 * @param {boolean} [props.block]
 * @param {boolean} [props.loading]
 * @param {boolean} [props.disabled]
 * @param {'button' | 'submit' | 'reset'} [props.type]
 * @param {(e: import('react').MouseEvent<HTMLButtonElement>) => void} [props.onClick]
 * @param {import('react').ReactNode | null} [props.icon]   icon node before the label, or `null` to suppress the auto-default
 * @param {import('react').ReactNode} props.children
 */
export function Button({
    variant = 'primary',
    size = 'md',
    block = false,
    loading = false,
    disabled = false,
    type = 'button',
    onClick,
    icon,
    children,
    ...rest
}) {
    const className = [
        styles.btn,
        styles[variant],
        styles[size],
        block ? styles.block : null,
        loading ? styles.loading : null,
    ].filter(Boolean).join(' ');
    // `icon` is `undefined` when the caller didn't pass it → fall back
    // to the auto-lookup. `null` is the explicit opt-out and renders
    // no icon at all. Any truthy value renders verbatim.
    const resolvedIcon = icon === undefined ? defaultIconFor(children) : icon;
    return (
        <button
            type={type}
            className={className}
            disabled={disabled || loading}
            onClick={onClick}
            aria-busy={loading ? 'true' : 'false'}
            {...rest}
        >
            {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
            {!loading && resolvedIcon ? <span className={styles.icon} aria-hidden="true">{resolvedIcon}</span> : null}
            <span className={styles.label}>{children}</span>
        </button>
    );
}
