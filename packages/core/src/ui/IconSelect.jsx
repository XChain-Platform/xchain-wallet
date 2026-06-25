// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useRef, useState } from 'react';
import { ChevronIcon } from './ChainPicker.icons.jsx';
import styles from './IconSelect.module.css';

/**
 * Single-select dropdown that can render an icon per option. A native
 * `<select>` can only hold text, so this is a button + popover instead,
 * used where each choice needs a glyph (a lock for encrypted vs a coin
 * logo for a network). Styled to sit in a form like the text Input:
 * label on its own line above, control below.
 *
 * @param {object} props
 * @param {string} [props.label]
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange   receives the option value
 * @param {Array<{ value: string, label: string, sub?: string, icon?: import('react').ReactNode }>} props.options
 * @param {string} [props.placeholder]
 * @param {boolean} [props.disabled]
 */
export function IconSelect({ label, value, onChange, options = [], placeholder = 'Select…', disabled }) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef(null);
    const popoverRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onClick = (e) => {
            if (triggerRef.current?.contains(e.target)) return;
            if (popoverRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const selected = options.find((o) => o.value === value) || null;

    return (
        <div className={styles.wrap}>
            {label ? <span className={styles.label}>{label}</span> : null}
            <button
                type="button"
                ref={triggerRef}
                className={styles.trigger}
                onClick={() => !disabled && setOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={open ? 'true' : 'false'}
                disabled={disabled}
            >
                <span className={styles.icon} aria-hidden="true">{selected?.icon || null}</span>
                <span className={styles.text}>
                    {selected ? (
                        <>
                            <span className={styles.labelText}>{selected.label}</span>
                            {selected.sub ? <span className={styles.sub}>{selected.sub}</span> : null}
                        </>
                    ) : (
                        <span className={styles.labelText}>{placeholder}</span>
                    )}
                </span>
                <span className={styles.caret} aria-hidden="true">
                    <ChevronIcon open={open} />
                </span>
            </button>
            {open ? (
                <div ref={popoverRef} className={styles.popover} role="listbox">
                    <ul className={styles.list}>
                        {options.map((o) => (
                            <li key={o.value}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={value === o.value ? 'true' : 'false'}
                                    className={`${styles.item} ${value === o.value ? styles.itemActive : ''}`}
                                    onClick={() => { onChange(o.value); setOpen(false); }}
                                >
                                    <span className={styles.icon} aria-hidden="true">{o.icon || null}</span>
                                    <span className={styles.text}>
                                        <span className={styles.labelText}>{o.label}</span>
                                        {o.sub ? <span className={styles.sub}>{o.sub}</span> : null}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}
