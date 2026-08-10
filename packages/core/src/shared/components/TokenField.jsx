// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useId } from 'react';
import { registry as registryLib } from '@xchain-wallet/core';
import { TickerIcon } from './TickerIcon.jsx';
import { TokenListIcon } from '../../ui/icons/index.jsx';
import styles from './TokenField.module.css';
import { StatusMessage } from '@xchain-wallet/core/ui';

const chainRegistry = registryLib.defaultRegistry();

/**
 * TokenField: the canonical inline token/asset selector for forms.
 *
 * A field-shaped button that shows the selected token's icon (with its
 * chain pip), ticker, and chain, and opens the full-page TokenPicker when
 * tapped. Presentation + click only: the host owns the picker navigation and
 * feeds the chosen `{ chainId, tick }` back in via `value`, mirroring how
 * AmountField is presentation-only and the route owns the data. This keeps
 * `core` shell-agnostic (no routing baked in).
 *
 * Sized to match the shared Input via the same `size` contract ('md' 36px
 * default / 'lg' 48px hero), so it drops into a form next to Input fields
 * without a size clash. Replaces the bare "type the ticker" `<Input>` used
 * across the action forms; the read-only sibling for locked tokens is
 * `LockedTokenContext`.
 *
 * @param {object} props
 * @param {string} [props.label]                              field label above the control (default 'Token')
 * @param {'md' | 'lg'} [props.size]
 * @param {{ chainId: string, tick: string } | null} [props.value]   selected token, or null for the empty state
 * @param {() => void} props.onOpenPicker                     called on click; host opens TokenPicker and writes the selection back to `value`
 * @param {string} [props.placeholder]                        empty-state text (default 'Select a token')
 * @param {boolean} [props.disabled]
 * @param {string} [props.error]                              error message shown below the control
 * @param {string} [props.id]
 */
export function TokenField({
    label = 'Token',
    size = 'md',
    value = null,
    onOpenPicker,
    placeholder = 'Select a token',
    disabled = false,
    error,
    id,
}) {
    const autoId = useId();
    const controlId = id || autoId;
    const errorId = error ? `${controlId}-error` : undefined;

    const chainId = value?.chainId;
    const tick = value?.tick;
    const hasValue = Boolean(chainId && tick);
    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const chainName = descriptor?.displayName || chainId;
    const iconSize = size === 'lg' ? 24 : 20;

    // Accessible name carries the field label + current selection (or the
    // empty-state text), since the visual chip isn't a native form control.
    const accessibleName = `${label}: ${hasValue
        ? `${tick}${chainName ? ` on ${chainName}` : ''}`
        : placeholder}`;

    return (
        <div className={`${styles.field} ${styles[size] || ''}`.trim()}>
            {label ? <span className={styles.label}>{label}</span> : null}
            <button
                type="button"
                id={controlId}
                className={`${styles.control} ${error ? styles.invalid : ''}`.trim()}
                onClick={onOpenPicker}
                disabled={disabled}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={errorId}
                aria-label={accessibleName}
            >
                {hasValue ? (
                    <>
                        <TickerIcon chainId={chainId} tick={tick} size={iconSize} />
                        <span className={styles.text}>
                            <span className={styles.tick}>{tick}</span>
                            {chainName ? (
                                <span className={styles.chain}>on {chainName}</span>
                            ) : null}
                        </span>
                    </>
                ) : (
                    <span className={styles.placeholder}>{placeholder}</span>
                )}
                {/* Trailing token-list icon: mirrors AddressField's icon slot; the
                    whole control opens the token list, the icon signals it. */}
                <span className={styles.caret} aria-hidden="true">
                    <TokenListIcon />
                </span>
            </button>
            {error ? (
                <StatusMessage variant="error" id={errorId} className={styles.error}>{error}</StatusMessage>
            ) : null}
        </div>
    );
}
