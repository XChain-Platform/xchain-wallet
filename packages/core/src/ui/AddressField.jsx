// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { forwardRef, useLayoutEffect, useRef, useState } from 'react';
import { Input } from './Input.jsx';
import { Button } from './Button.jsx';
import { ClipboardPasteButton } from './ClipboardPasteButton.jsx';
import { inspectClipboardPaste, syncPasteWidth } from './inFieldPaste.js';
import { AddressText } from './AddressText.jsx';
import { UsersIcon, ScanIcon } from './icons/index.jsx';
import styles from './AddressField.module.css';

const ICONS = {
    contacts: { Component: UsersIcon, defaultLabel: 'Open address book' },
    addresses: { Component: ScanIcon, defaultLabel: 'Choose address' },
};

/**
 * AddressField: an address input with an optional trailing icon action
 * inside the field. The two canonical icon uses:
 *
 *   - To ("contacts"): outbound destination. The field accepts typed or
 *     pasted addresses; the address-book icon navigates to the user's
 *     saved contacts (ContactsPickerScreen), and picking an entry fills
 *     the field.
 *   - From ("addresses"): the source address a transaction spends from,
 *     always one of the wallet's own. The field is read-only; the QR
 *     icon navigates to the wallet's own address list (the same screen
 *     as change-address) to select one.
 *
 * The component renders the field + icon only; the host owns the picker
 * screen the icon navigates to and writes the result back via
 * `value` / `onChange` (To) or its own selection state (From).
 *
 * Props (all others forward to `Input`, incl. label / size / hint /
 * error / readOnly / onPaste):
 *   - icon          'contacts' | 'addresses'
 *   - onIconClick   () => void   navigate to the picker screen
 *   - iconLabel     accessible label override for the icon button
 *   - onPaste       host callback for URI handling; unconsumed plain text
 *                     with surrounding whitespace is trimmed before insertion
 *   - paste         renders the in-field Paste button that Send's recipient
 *                     field uses (never on a read-only field). A Paste tap
 *                     runs the same clipboard check, hands the text to
 *                     `onPaste` first, then sets the field through
 *                     `onChange` as a typed value would.
 *
 * @typedef {object} AddressFieldOwnProps
 * @property {'contacts' | 'addresses'} [icon]
 * @property {() => void} [onIconClick]
 * @property {string} [iconLabel]
 * @property {boolean} [wrapReadOnlyAddress]
 * @property {boolean} [paste]
 */
export const AddressField = /* @__PURE__ */ forwardRef(function AddressField(
    {
        icon,
        onIconClick,
        iconLabel,
        wrapReadOnlyAddress = false,
        size = 'md',
        label,
        disabled,
        style,
        value,
        onChange,
        onPaste,
        paste = false,
        error,
        ...rest
    },
    ref,
) {
    const { Component: IconComponent, defaultLabel } = ICONS[icon] || {};
    const showReadOnlyAddress = rest.readOnly && typeof value === 'string' && value.length !== 0;
    const showPaste = Boolean(paste) && !rest.readOnly;
    const [pasteError, setPasteError] = useState('');
    const wrapRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const pasteSlotRef = useRef(/** @type {HTMLSpanElement | null} */ (null));
    const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useLayoutEffect(() => {
        if (!showPaste) return undefined;
        const wrap = wrapRef.current;
        const button = pasteSlotRef.current?.querySelector('button') ?? null;
        syncPasteWidth(wrap, button);
        if (!button || typeof ResizeObserver !== 'function') return undefined;
        const observer = new ResizeObserver(() => syncPasteWidth(wrap, button));
        observer.observe(button);
        return () => observer.disconnect();
    }, [showPaste]);

    const wrapClass = [
        styles.wrap,
        styles[size] || '',
        label ? '' : styles.noLabel,
        showReadOnlyAddress ? styles.readOnly : '',
        showReadOnlyAddress && wrapReadOnlyAddress ? styles.wrappedReadOnly : '',
        showPaste ? styles.withPaste : '',
    ].filter(Boolean).join(' ');

    // Room at the field's end for Paste, the icon action, or both.
    const endRoom = showPaste
        ? (IconComponent
            ? 'calc(var(--address-paste-width) + var(--address-control-height))'
            : 'var(--address-paste-width)')
        : (IconComponent ? 'calc(var(--address-control-height) + var(--xc-space-2))' : null);

    const handleChange = (event) => {
        if (pasteError) setPasteError('');
        onChange?.(event);
    };

    const pasteFromClipboard = (text) => {
        const inspected = inspectClipboardPaste(text);
        if (!inspected.ok) {
            setPasteError(inspected.error);
            return;
        }
        setPasteError('');
        const pasteEvent = {
            clipboardData: { getData: () => inspected.value },
            defaultPrevented: false,
            currentTarget: inputRef.current,
            target: inputRef.current,
            preventDefault() { this.defaultPrevented = true; },
        };
        onPaste?.(pasteEvent);
        if (!pasteEvent.defaultPrevented) onChange?.({ target: { value: inspected.value } });
    };

    const handlePaste = (event) => {
        onPaste?.(event);
        if (event.defaultPrevented || typeof onChange !== 'function') return;

        const pasted = event.clipboardData?.getData?.('text');
        if (typeof pasted !== 'string' || pasted === pasted.trim()) return;

        const input = event.currentTarget;
        const current = String(value ?? input.value ?? '');
        const start = input.selectionStart ?? current.length;
        const end = input.selectionEnd ?? start;
        event.preventDefault();
        onChange({
            target: { value: `${current.slice(0, start)}${pasted.trim()}${current.slice(end)}` },
        });
    };

    return (
        <div className={wrapClass} ref={wrapRef}>
            <Input
                ref={(node) => {
                    inputRef.current = node;
                    if (typeof ref === 'function') ref(node);
                    else if (ref) ref.current = node;
                }}
                label={label}
                size={size}
                disabled={disabled}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                style={endRoom ? {
                    '--address-end-room': endRoom,
                    ...style,
                } : style}
                title={showReadOnlyAddress ? value : undefined}
                value={value}
                onChange={handleChange}
                onPaste={handlePaste}
                pasteGuard
                error={pasteError || error}
                {...rest}
                dir="ltr"
            />
            {showReadOnlyAddress ? (
                <span className={styles.readOnlyValue} aria-hidden="true">
                    <AddressText address={value} truncate={!wrapReadOnlyAddress} focusable={false} />
                </span>
            ) : null}
            {IconComponent ? (
                <span className={styles.iconButton}>
                    <Button
                        type="button"
                        variant="secondary"
                        size={size}
                        icon={<IconComponent />}
                        onClick={onIconClick}
                        disabled={disabled}
                        aria-label={iconLabel || defaultLabel}
                        title={iconLabel || defaultLabel}
                    />
                </span>
            ) : null}
            {showPaste ? (
                <span className={styles.pasteAction} ref={pasteSlotRef}>
                    <ClipboardPasteButton
                        disabled={disabled}
                        onMessage={(message) => { if (message) setPasteError(message); }}
                        onPaste={pasteFromClipboard}
                    />
                </span>
            ) : null}
        </div>
    );
});
