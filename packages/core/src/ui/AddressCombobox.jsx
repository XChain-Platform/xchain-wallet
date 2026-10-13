// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { forwardRef, useCallback, useId, useMemo, useRef, useState } from 'react';
import { Input } from './Input.jsx';
import { ClipboardPasteButton } from './ClipboardPasteButton.jsx';
import { UsersIcon, ScanIcon } from './icons/index.jsx';
import { filterSuggestions } from '../flows/recentDestinations.js';
import styles from './AddressCombobox.module.css';

const ICONS = {
    contacts: { Component: UsersIcon, defaultLabel: 'Open address book' },
    addresses: { Component: ScanIcon, defaultLabel: 'Choose address' },
};

function inspectClipboardPaste(value) {
    const edges = /^[\s\u200B-\u200D\u2060\uFEFF]+|[\s\u200B-\u200D\u2060\uFEFF]+$/g;
    const hiddenCharacters = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/;
    const normalized = String(value ?? '').replace(edges, '');
    const hidden = hiddenCharacters.test(normalized);
    return hidden
        ? {
            ok: false,
            value: normalized,
            error: 'Pasted text contains hidden characters. Check it and try again.',
        }
        : { ok: true, value: normalized, error: null };
}

/**
 * AddressCombobox: destination input for Send / authoring forms, with
 * autocomplete from contacts + recent send history. §29.4 + §21.6.
 *
 * The wrapping shell builds the suggestion list (via
 * `flows/recentDestinations.buildRecentDestinations`) and passes it in.
 * This component owns dropdown visibility, filtering against the live
 * input, keyboard navigation, and selection.
 *
 * Like AddressField, it can render one trailing icon action inside the
 * field (`icon` + `onIconClick`), so the autocomplete field keeps the
 * standardized in-field affordance (e.g. the contacts book on Send's To)
 * instead of a separate floating button.
 *
 * Props
 *   - value, onChange       same shape as `<Input>`; onChange fires
 *                             with `{ target: { value } }` so callers
 *                             can swap from `<Input>` without changes.
 *   - suggestions           `Suggestion[]` from buildRecentDestinations.
 *   - onSuggestionSelect    optional selection handler for callers that need
 *                             the full suggestion metadata. When present, it
 *                             replaces the default address-only `onChange`.
 *   - onPaste               called first for BIP21 / WIF handling; when the
 *                             host does not consume the event, surrounding
 *                             whitespace is trimmed before insertion.
 *   - icon                  'contacts' | 'addresses'; renders the in-field
 *                             trailing button when set.
 *   - onIconClick           handler for the trailing icon button.
 *   - iconLabel             accessible label override for the icon button.
 *   - size                  'md' | 'lg'; forwarded to `<Input>`.
 *   - everything else       forwarded to `<Input>` (label, hint, error,
 *                             placeholder, autoComplete, etc.).
 *
 * @typedef {object} AddressComboboxOwnProps
 * @property {string} value
 * @property {(e: { target: { value: string } }) => void} onChange
 * @property {import('../flows/recentDestinations.js').Suggestion[]} [suggestions]
 * @property {(suggestion: import('../flows/recentDestinations.js').Suggestion) => void} [onSuggestionSelect]
 * @property {(e: React.ClipboardEvent<HTMLInputElement>) => void} [onPaste]
 * @property {'contacts' | 'addresses'} [icon]
 * @property {() => void} [onIconClick]
 * @property {string} [iconLabel]
 */
export const AddressCombobox = forwardRef(function AddressCombobox(
    {
        value,
        onChange,
        suggestions = [],
        onSuggestionSelect,
        onPaste,
        icon,
        onIconClick,
        iconLabel,
        size = 'md',
        label,
        disabled,
        style,
        onFocus: onInputFocus,
        onKeyDown: onInputKeyDown,
        error,
        ...rest
    },
    ref,
) {
    const listboxId = useId();
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [pasteError, setPasteError] = useState('');
    const containerRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    const filtered = useMemo(
        () => filterSuggestions(suggestions, value),
        [suggestions, value],
    );

    const close = useCallback(() => {
        setOpen(false);
        setActiveIndex(-1);
    }, []);

    const select = useCallback(
        (s) => {
            if (!s) return;
            if (onSuggestionSelect) onSuggestionSelect(s);
            else onChange({ target: { value: s.address } });
            close();
        },
        [onChange, onSuggestionSelect, close],
    );

    const onKeyDown = (e) => {
        onInputKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (filtered.length === 0) {
            if (e.key === 'Escape') close();
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActiveIndex((i) => (i + 1) % filtered.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            setActiveIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1));
        } else if (e.key === 'Enter' && open && filtered[activeIndex]) {
            e.preventDefault();
            select(filtered[activeIndex]);
        } else if (e.key === 'Escape') {
            close();
        }
    };

    const onBlur = (e) => {
        if (containerRef.current && containerRef.current.contains(e.relatedTarget)) return;
        close();
    };

    const showDropdown = open && filtered.length > 0;
    const activeId = showDropdown && filtered[activeIndex]
        ? `${listboxId}-opt-${activeIndex}`
        : undefined;

    const { Component: IconComponent, defaultLabel } = ICONS[icon] || {};
    const wrapClass = [
        styles.wrap,
        size === 'lg' ? styles.lg : '',
        label ? '' : styles.noLabel,
    ].filter(Boolean).join(' ');

    return (
        <div className={wrapClass} ref={containerRef} onBlur={onBlur}>
            <Input
                ref={(node) => {
                    inputRef.current = node;
                    if (typeof ref === 'function') ref(node);
                    else if (ref) ref.current = node;
                }}
                role="combobox"
                aria-expanded={showDropdown ? 'true' : 'false'}
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-activedescendant={activeId}
                placeholder="Address"
                label={label}
                size={size}
                disabled={disabled}
                autoComplete="off"
                style={IconComponent ? { paddingInlineEnd: '48px', ...style } : style}
                value={value}
                onChange={(e) => {
                    setPasteError('');
                    onChange(e);
                    setOpen(true);
                    setActiveIndex(-1);
                }}
                onFocus={(e) => {
                    onInputFocus?.(e);
                    setOpen(true);
                }}
                onKeyDown={onKeyDown}
                onPaste={(e) => {
                    onPaste?.(e);
                    if (e.defaultPrevented) return;

                    const pasted = e.clipboardData?.getData?.('text');
                    if (typeof pasted !== 'string' || pasted === pasted.trim()) return;

                    const input = e.currentTarget;
                    const current = String(value ?? input.value ?? '');
                    const start = input.selectionStart ?? current.length;
                    const end = input.selectionEnd ?? start;
                    e.preventDefault();
                    onChange({
                        target: { value: `${current.slice(0, start)}${pasted.trim()}${current.slice(end)}` },
                    });
                    setOpen(true);
                    setActiveIndex(-1);
                }}
                pasteGuard
                error={pasteError || error}
                {...rest}
            />
            {IconComponent ? (
                <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => {
                        close();
                        onIconClick?.();
                    }}
                    disabled={disabled}
                    aria-label={iconLabel || defaultLabel}
                    title={iconLabel || defaultLabel}
                >
                    <IconComponent />
                </button>
            ) : null}
            {/* After the in-field icon button so focus follows the visual order:
                field, its trailing icon, then the paste control below it. */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                <ClipboardPasteButton
                    disabled={disabled}
                    onPaste={(text) => {
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
                        if (!pasteEvent.defaultPrevented) onChange({ target: { value: inspected.value } });
                        setOpen(true);
                        setActiveIndex(-1);
                    }}
                />
            </div>
            {showDropdown ? (
                <ul
                    id={listboxId}
                    role="listbox"
                    className={styles.dropdown}
                >
                    {filtered.map((s, i) => (
                        <li
                            id={`${listboxId}-opt-${i}`}
                            key={`${s.source}:${s.address}`}
                            role="option"
                            aria-selected={i === activeIndex ? 'true' : 'false'}
                            className={styles.option}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                select(s);
                            }}
                            onMouseEnter={() => setActiveIndex(i)}
                        >
                            <span className={styles.label}>
                                {s.label}
                                <span className={styles.badge}>
                                    {s.source === 'contact' ? 'Contact' : 'Recent'}
                                </span>
                            </span>
                            {s.sublabel ? (
                                <span className={styles.sublabel}>{s.sublabel}</span>
                            ) : null}
                            <span className={styles.sublabel}>{s.address}</span>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
});
