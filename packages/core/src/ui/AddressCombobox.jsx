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
import { filterSuggestions } from '../flows/recentDestinations.js';
import styles from './AddressCombobox.module.css';

/**
 * AddressCombobox — Send / authoring forms' destination input with
 * autocomplete from contacts + recent send history. §29.4 + §21.6.
 *
 * The wrapping shell builds the suggestion list (via
 * `flows/recentDestinations.buildRecentDestinations`) and passes it in.
 * This component owns dropdown visibility, filtering against the live
 * input, keyboard navigation, and selection.
 *
 * Props
 *   - value, onChange       — same shape as `<Input>`; onChange fires
 *                             with `{ target: { value } }` so callers
 *                             can swap from `<Input>` without changes.
 *   - suggestions           — `Suggestion[]` from buildRecentDestinations.
 *   - onPaste               — pass-through to the underlying input.
 *                             Send.jsx wires this for BIP21 / WIF detect.
 *   - everything else       — forwarded to `<Input>` (label, hint, error,
 *                             placeholder, autoComplete, etc.).
 *
 * @typedef {object} AddressComboboxOwnProps
 * @property {string} value
 * @property {(e: { target: { value: string } }) => void} onChange
 * @property {import('../flows/recentDestinations.js').Suggestion[]} [suggestions]
 * @property {(e: React.ClipboardEvent<HTMLInputElement>) => void} [onPaste]
 */
export const AddressCombobox = forwardRef(function AddressCombobox(
    {
        value,
        onChange,
        suggestions = [],
        onPaste,
        ...rest
    },
    ref,
) {
    const listboxId = useId();
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const containerRef = useRef(/** @type {HTMLDivElement | null} */ (null));

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
            onChange({ target: { value: s.address } });
            close();
        },
        [onChange, close],
    );

    const onKeyDown = (e) => {
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
        } else if (e.key === 'Enter' && open && activeIndex >= 0) {
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
    const activeId = showDropdown && activeIndex >= 0
        ? `${listboxId}-opt-${activeIndex}`
        : undefined;

    return (
        <div className={styles.wrap} ref={containerRef} onBlur={onBlur}>
            <Input
                ref={ref}
                role="combobox"
                aria-expanded={showDropdown ? 'true' : 'false'}
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-activedescendant={activeId}
                value={value}
                onChange={(e) => {
                    onChange(e);
                    setOpen(true);
                    setActiveIndex(-1);
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                {...rest}
            />
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
