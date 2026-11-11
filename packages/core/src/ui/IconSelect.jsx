// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronIcon } from './ChainPicker.icons.jsx';
import { InfoTip } from './InfoTip.jsx';
import { useBackHandler } from './backStack.js';
import { fieldHelpName } from './fieldRequirement.js';
// Ahead of the select's own sheet, so the shared button base loads first and
// the trigger's rules follow it; see Chip.jsx for why this is not `composes`.
import buttonStyles from './Button.module.css';
import inputStyles from './Input.module.css';
import styles from './IconSelect.module.css';
import { t } from '../i18n/index.js';
import '../i18n/locales/en/ui.js';

/**
 * Single-select dropdown that can render an icon per option. A native
 * `<select>` can only hold text, so this is a button + popover instead,
 * used where each choice needs a glyph (a lock for encrypted vs a coin
 * logo for a network). Styled to sit in a form like the text Input:
 * label on its own line above, control below.
 *
 * @param {object} props
 * @param {string} [props.label]
 * @param {import('react').ReactNode} [props.help] contextual help shown from the label-row InfoTip.
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange   receives the option value
 * @param {Array<{ value: string, label: string, sub?: string, icon?: import('react').ReactNode }>} props.options
 * @param {string} [props.placeholder]
 * @param {boolean} [props.disabled]
 * @param {'sm' | 'md' | 'lg'} [props.size]
 */
export function IconSelect({
    label,
    help,
    value,
    onChange,
    options = [],
    placeholder = t('ui.iconSelect.select'),
    disabled,
    size = 'md',
}) {
    const [open, setOpen] = useState(false);
    const listboxId = useId();
    const triggerRef = useRef(null);
    const popoverRef = useRef(null);
    const focusOnOpenRef = useRef('selected');

    const closeSelect = useCallback((restoreFocus = false) => {
        setOpen(false);
        if (restoreFocus) triggerRef.current?.focus();
    }, []);
    useBackHandler(open ? () => closeSelect(true) : undefined);

    useEffect(() => {
        if (!open) return undefined;
        const onClick = (e) => {
            if (triggerRef.current?.contains(e.target)) return;
            if (popoverRef.current?.contains(e.target)) return;
            closeSelect(true);
        };
        window.addEventListener('mousedown', onClick);
        return () => window.removeEventListener('mousedown', onClick);
    }, [closeSelect, open]);

    const selected = options.find((o) => o.value === value) || null;

    useEffect(() => {
        if (!open) return;
        const optionElements = listboxOptions(popoverRef.current);
        const selectedOption = optionElements.find(
            (option) => option.getAttribute('aria-selected') === 'true',
        );
        const fallback = focusOnOpenRef.current === 'last' ? optionElements.at(-1) : optionElements[0];
        (selectedOption || fallback)?.focus();
    }, [open]);

    const openSelect = (focus = 'selected') => {
        focusOnOpenRef.current = focus;
        setOpen(true);
    };

    const onListboxKeyDown = (e) => {
        const optionElements = listboxOptions(popoverRef.current);
        const index = optionElements.indexOf(document.activeElement);
        let nextIndex = null;
        if (e.key === 'ArrowDown') nextIndex = (index + 1) % optionElements.length;
        if (e.key === 'ArrowUp') nextIndex = (index - 1 + optionElements.length) % optionElements.length;
        if (e.key === 'Home') nextIndex = 0;
        if (e.key === 'End') nextIndex = optionElements.length - 1;
        if (nextIndex !== null && optionElements.length > 0) {
            e.preventDefault();
            optionElements[nextIndex]?.focus();
            return;
        }
        if ((e.key === 'Enter' || e.key === ' ') && index >= 0) {
            e.preventDefault();
            optionElements[index].click();
        }
        if (e.key === 'Tab') closeSelect();
    };

    // The visual label is a span, so the accessible name pairs the field label
    // with its current selection. An unlabelled select keeps its visible text as
    // its name.
    const accessibleName = label
        ? `${label}: ${selected ? selected.label : placeholder}`
        : undefined;
    const hasHelp = Boolean(label && help);

    return (
        <div className={`${styles.wrap} ${styles[size] || ''}`.trim()}>
            {hasHelp ? (
                <div className={`${inputStyles.labelRow} ${styles.labelRow}`}>
                    <span className={inputStyles.label}>{label}</span>
                    <InfoTip
                        className={inputStyles.labelHelp}
                        label={help}
                        aria={t('ui.field.about', { label: fieldHelpName(label) })}
                    />
                </div>
            ) : label ? <span className={styles.label}>{label}</span> : null}
            <button
                type="button"
                ref={triggerRef}
                className={`${buttonStyles.btn} ${styles.trigger}`}
                onClick={() => {
                    if (disabled) return;
                    if (open) closeSelect();
                    else openSelect();
                }}
                onKeyDown={(e) => {
                    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                    e.preventDefault();
                    openSelect(e.key === 'ArrowUp' && !selected ? 'last' : 'selected');
                }}
                aria-haspopup="listbox"
                aria-expanded={open ? 'true' : 'false'}
                aria-controls={open ? listboxId : undefined}
                aria-label={accessibleName}
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
                <div
                    ref={popoverRef}
                    id={listboxId}
                    className={styles.popover}
                    role="listbox"
                    aria-label={label || t('ui.iconSelect.options')}
                    onKeyDown={onListboxKeyDown}
                >
                    <ul className={styles.list}>
                        {options.map((o) => (
                            <li key={o.value}>
                                <button
                                    type="button"
                                    role="option"
                                    tabIndex={-1}
                                    aria-selected={value === o.value ? 'true' : 'false'}
                                    className={`${styles.item} ${value === o.value ? styles.itemActive : ''}`}
                                    onClick={() => { onChange(o.value); closeSelect(true); }}
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

function listboxOptions(popover) {
    return Array.from(popover?.querySelectorAll('[role="option"]') || []);
}
