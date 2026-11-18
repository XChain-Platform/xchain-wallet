// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronIcon } from './ChainPicker.icons.jsx';
import { InfoTip } from './InfoTip.jsx';
import { useBackHandler } from './backStack.js';
import { InFilterPanel } from './filterPanelSlot.js';
import { fieldHelpName } from './fieldRequirement.js';
import { useFormFieldError } from './formErrors.js';
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
 * @param {Array<IconSelectOption>} props.options
 * @param {string} [props.placeholder]
 * @param {boolean} [props.disabled]
 * @param {'sm' | 'md' | 'lg'} [props.size]
 * @param {string} [props.tag]  small state tag after the label (such as Detected); needs label and help
 * @param {string} [props['aria-label']]  names a select that has no visible label
 * @param {boolean} [props.wrapSub]  the closed field's sub line wraps and the field grows, instead of trailing off
 * @param {string} [props.id]  the trigger's id; with a form on the form error standard (useFormErrors), the field reads its entry by this id, outlines red with its line under it, and clears on a pick
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
    tag,
    id,
    wrapSub = false,
    'aria-label': ariaLabel,
}) {
    const formField = useFormFieldError(id);
    const errorId = formField.error && id ? `${id}-error` : undefined;
    const handleSelect = (next) => {
        formField.clear();
        onChange?.(next);
    };
    const selected = options.find((o) => o.value === value) || null;
    // The visual label is a span, so the accessible name pairs the field label
    // with its current selection. An unlabelled select keeps its visible text as
    // its name, unless the caller names it with aria-label (no visible label).
    // An option whose label is markup (an address isolated with dir="ltr")
    // names the selection with its plain `text`.
    const fieldName = label || ariaLabel;
    const accessibleName = fieldName
        ? `${fieldName}: ${selected ? (optionText(selected) || selected.label) : placeholder}`
        : undefined;
    // A filter panel's dropdowns show no label; the name above stays accessible.
    const shownLabel = useContext(InFilterPanel) ? null : label;
    const hasHelp = Boolean(shownLabel && help);

    return (
        <div className={`${styles.wrap} ${styles[size] || ''}`.trim()}>
            {hasHelp ? (
                <div className={`${inputStyles.labelRow} ${styles.labelRow}`}>
                    <span className={inputStyles.label}>{label}</span>
                    {tag ? <span className={inputStyles.optionalPill} data-field-tag>{tag}</span> : null}
                    <InfoTip
                        className={inputStyles.labelHelp}
                        label={help}
                        aria={t('ui.field.about', { label: fieldHelpName(label) })}
                    />
                </div>
            ) : shownLabel ? <span className={styles.label}>{label}</span> : null}
            <IconSelectControl
                value={value}
                options={options}
                onSelect={handleSelect}
                placeholder={placeholder}
                disabled={disabled}
                listboxLabel={fieldName || t('ui.iconSelect.options')}
                triggerProps={{
                    'aria-label': accessibleName,
                    ...(wrapSub ? { className: styles.subWraps } : {}),
                    ...(id ? { id } : {}),
                    ...(errorId ? { 'aria-invalid': 'true', 'aria-describedby': errorId } : {}),
                }}
            />
            {errorId ? <div id={errorId} className={inputStyles.error} role="alert">{formField.error}</div> : null}
        </div>
    );
}

/**
 * @typedef {object} IconSelectOption
 * @property {string} value
 * @property {import('react').ReactNode} label
 * @property {string} [text]  plain text for type-ahead when `label` is not a string
 * @property {import('react').ReactNode} [sub]
 * @property {import('react').ReactNode} [icon]
 * @property {boolean} [disabled]  shown but not pickable, like a disabled native option
 */

/** How long a type-ahead buffer keeps growing between key presses, as a native select does. */
const TYPEAHEAD_RESET_MS = 600;

/**
 * The themed trigger and listbox shared by IconSelect and Select. The caller
 * owns the label, the positioned wrapper (`styles.wrap`) and the trigger's
 * name: IconSelect names it with an aria-label, Select with its `<label for>`.
 *
 * Keyboard: Arrow keys open the list from the trigger; inside it Arrow keys,
 * Home and End move, Enter and Space pick, Escape (the back stack) and Tab
 * close, and typed letters jump to the next matching option. Typed letters on
 * the closed trigger pick the match directly, like a native select.
 *
 * @param {object} props
 * @param {string} props.value  the value shown as selected
 * @param {Array<IconSelectOption>} props.options
 * @param {(value: string) => void} props.onSelect
 * @param {import('react').ReactNode} [props.placeholder]
 * @param {boolean} [props.disabled]
 * @param {string} [props.listboxLabel]
 * @param {'always' | 'auto'} [props.iconSlot]  'auto' drops the icon column when no option has an icon
 * @param {import('react').Ref<HTMLButtonElement>} [props.triggerRef]
 * @param {object} [props.triggerProps]  extra attributes for the trigger button (id, role, aria-*, className, style)
 */
export function IconSelectControl({
    value,
    options,
    onSelect,
    placeholder,
    disabled,
    listboxLabel,
    iconSlot = 'always',
    triggerRef: externalTriggerRef,
    triggerProps = {},
}) {
    const [open, setOpen] = useState(false);
    const listboxId = useId();
    const triggerRef = useRef(null);
    const popoverRef = useRef(null);
    const focusOnOpenRef = useRef('selected');
    const typeaheadRef = useRef({ buffer: '', at: 0 });

    const setTriggerRef = useCallback((node) => {
        triggerRef.current = node;
        if (typeof externalTriggerRef === 'function') externalTriggerRef(node);
        else if (externalTriggerRef) externalTriggerRef.current = node;
    }, [externalTriggerRef]);

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

    // The open list is as wide as its longest option and is never cut off
    // (operator rulings 2026-11-14 and 2026-11-15): it opens under the trigger
    // from its start edge, turns to the trigger's end edge when that would run
    // past the viewport, opens upward when the space below is too short and
    // more is above, and when neither side holds it all it becomes a scrolling
    // list capped to the room on its side, so no option is ever off screen.
    const [placement, setPlacement] = useState(NO_FLIP);
    useLayoutEffect(() => {
        if (!open) {
            setPlacement((p) => (p === NO_FLIP ? p : NO_FLIP));
            return;
        }
        const next = listPlacement(popoverRef.current, triggerRef.current);
        if (next) setPlacement(next);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const optionElements = listboxOptions(popoverRef.current);
        const enabled = optionElements.filter(isEnabledOption);
        const selectedOption = optionElements.find(
            (option) => option.getAttribute('aria-selected') === 'true',
        );
        const fallback = focusOnOpenRef.current === 'last' ? enabled.at(-1) : enabled[0];
        (selectedOption || fallback)?.focus();
    }, [open]);

    const openSelect = (focus = 'selected') => {
        focusOnOpenRef.current = focus;
        setOpen(true);
    };

    const pick = (option) => {
        if (!option || option.disabled) return;
        onSelect?.(option.value);
    };

    // Native select type-ahead: letters typed in quick succession build one
    // search string; repeating one letter cycles through the options that
    // start with it. Returns the matching enabled option index, or -1.
    const typeaheadIndex = (key, fromIndex) => {
        const now = Date.now();
        const state = typeaheadRef.current;
        state.buffer = now - state.at > TYPEAHEAD_RESET_MS ? key : state.buffer + key;
        state.at = now;
        const needle = state.buffer.toLowerCase();
        const repeated = needle.split('').every((ch) => ch === needle[0]);
        const search = repeated ? needle[0] : needle;
        const start = repeated || needle.length === 1 ? fromIndex + 1 : Math.max(fromIndex, 0);
        for (let step = 0; step < options.length; step += 1) {
            const i = (start + step + options.length) % options.length;
            const option = options[i];
            if (!option.disabled && optionText(option).toLowerCase().startsWith(search)) return i;
        }
        return -1;
    };

    const onListboxKeyDown = (e) => {
        const optionElements = listboxOptions(popoverRef.current);
        const enabled = optionElements.filter(isEnabledOption);
        const index = enabled.indexOf(document.activeElement);
        let nextIndex = null;
        if (e.key === 'ArrowDown') nextIndex = (index + 1) % enabled.length;
        if (e.key === 'ArrowUp') nextIndex = (index - 1 + enabled.length) % enabled.length;
        if (e.key === 'Home') nextIndex = 0;
        if (e.key === 'End') nextIndex = enabled.length - 1;
        if (nextIndex !== null && enabled.length > 0) {
            e.preventDefault();
            enabled[nextIndex]?.focus();
            return;
        }
        if ((e.key === 'Enter' || e.key === ' ') && index >= 0) {
            e.preventDefault();
            enabled[index].click();
            return;
        }
        if (e.key === 'Tab') {
            // Focus goes back to the trigger first, so Tab moves on from the field.
            closeSelect(true);
            return;
        }
        if (isTypeaheadKey(e)) {
            const current = optionElements.indexOf(document.activeElement);
            const match = typeaheadIndex(e.key, current);
            if (match >= 0) {
                e.preventDefault();
                optionElements[match]?.focus();
            }
        }
    };

    const onTriggerKeyDown = (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            openSelect(e.key === 'ArrowUp' && !selected ? 'last' : 'selected');
            return;
        }
        // Space opens the list like a button press unless it continues a typed search.
        const typing = Date.now() - typeaheadRef.current.at <= TYPEAHEAD_RESET_MS;
        if (isTypeaheadKey(e) && (e.key !== ' ' || typing)) {
            const match = typeaheadIndex(e.key, options.indexOf(selected));
            if (match >= 0) {
                e.preventDefault();
                pick(options[match]);
            }
        }
    };

    const showIcons = iconSlot === 'always' || options.some((o) => o.icon);

    return (
        <>
            <button
                type="button"
                {...triggerProps}
                ref={setTriggerRef}
                // G112: leadIcon puts the option icon in its square slot.
                className={[buttonStyles.btn, styles.trigger, showIcons ? styles.leadIcon : '', triggerProps.className].filter(Boolean).join(' ')}
                onClick={() => {
                    if (disabled) return;
                    if (open) closeSelect();
                    else openSelect();
                }}
                onKeyDown={onTriggerKeyDown}
                aria-haspopup="listbox"
                aria-expanded={open ? 'true' : 'false'}
                aria-controls={open ? listboxId : undefined}
                disabled={disabled}
            >
                {showIcons ? <span className={styles.icon} aria-hidden="true">{selected?.icon || null}</span> : null}
                <span className={styles.text}>
                    {selected ? (
                        <>
                            <span className={styles.labelText}>{selected.label}</span>
                            {selected.sub ? <span className={styles.sub}>{selected.sub}</span> : null}
                        </>
                    ) : (
                        <span className={styles.labelText}>{placeholder}</span>
                    )}
                    {/* Every option's label, invisible and zero-height, so the
                        closed trigger is as wide as its longest choice and a
                        pick never resizes it. The text is drawn from the data
                        attribute, so it is not in the button's content. */}
                    <span className={styles.sizer} aria-hidden="true">
                        {options.map((o, i) => (
                            <span key={`${i}:${o.value}`} className={styles.sizerItem} data-label={optionText(o)} />
                        ))}
                    </span>
                </span>
                <span className={styles.caret} aria-hidden="true">
                    <ChevronIcon open={open} />
                </span>
            </button>
            {open ? (
                <div
                    ref={popoverRef}
                    id={listboxId}
                    className={[
                        styles.popover,
                        placement.end ? styles.popoverEnd : '',
                        placement.up ? styles.popoverUp : '',
                    ].filter(Boolean).join(' ')}
                    data-placement={`${placement.up ? 'top' : 'bottom'}-${placement.end ? 'end' : 'start'}`}
                    // Capped to the room on its side; the list scrolls inside it.
                    style={placement.maxHeight != null ? { maxHeight: `${placement.maxHeight}px` } : undefined}
                    role="listbox"
                    aria-label={listboxLabel || t('ui.iconSelect.options')}
                    onKeyDown={onListboxKeyDown}
                >
                    {/* The list and its items are layout only, so the listbox owns its options directly. */}
                    <ul className={styles.list} role="presentation">
                        {options.map((o, i) => (
                            <li key={`${i}:${o.value}`} role="presentation">
                                <button
                                    type="button"
                                    role="option"
                                    tabIndex={-1}
                                    data-value={o.value}
                                    aria-selected={value === o.value ? 'true' : 'false'}
                                    aria-disabled={o.disabled ? 'true' : undefined}
                                    className={[
                                        styles.item,
                                        value === o.value ? styles.itemActive : '',
                                        o.disabled ? styles.itemDisabled : '',
                                    ].filter(Boolean).join(' ')}
                                    onClick={() => {
                                        if (o.disabled) return;
                                        pick(o);
                                        closeSelect(true);
                                    }}
                                >
                                    {showIcons ? <span className={styles.icon} aria-hidden="true">{o.icon || null}</span> : null}
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
        </>
    );
}

const NO_FLIP = Object.freeze({ end: false, up: false, maxHeight: null });
// The gap the open list keeps from the viewport edges.
const VIEWPORT_MARGIN = 8;
// The space between the field and its open list (.popover's 4px offset).
const LIST_GAP = 4;
// A capped list still shows about two options, however short the room.
const MIN_LIST_HEIGHT = 72;

/**
 * The visible band a list under `node` can draw in: the viewport, narrowed by
 * every ancestor that clips or scrolls its content (the screen's scroller, a
 * card with hidden overflow), since a list past their edge is cut off too.
 *
 * @param {HTMLElement} node
 * @param {number} vh  the viewport height
 * @returns {{ top: number, bottom: number }}
 */
function visibleBand(node, vh) {
    let top = 0;
    let bottom = vh;
    for (let el = node.parentElement; el && el !== document.documentElement; el = el.parentElement) {
        const overflowY = window.getComputedStyle?.(el)?.overflowY;
        if (!overflowY || overflowY === 'visible') continue;
        const rect = el.getBoundingClientRect();
        if (rect.height <= 0) continue;
        top = Math.max(top, rect.top);
        bottom = Math.min(bottom, rect.bottom);
    }
    return { top, bottom };
}

/**
 * Where the open list goes so it stays fully on screen, measured as it first
 * opens (under the field, from its start edge). It stays under the field when
 * it fits there; otherwise it opens on whichever side has more room, and when
 * that side is still too short `maxHeight` caps it to the room so the list
 * scrolls instead of running off the screen. Null when nothing can be
 * measured (no layout, as in a test DOM).
 *
 * @param {HTMLElement | null} popover
 * @param {HTMLElement | null} trigger
 * @returns {{ end: boolean, up: boolean, maxHeight: number | null } | null}
 */
export function listPlacement(popover, trigger) {
    if (!popover || !trigger || typeof window === 'undefined') return null;
    // A list laid out in its container's flow (a filter panel) grows that
    // container, which scrolls, so a cap here would cut options off.
    if (window.getComputedStyle?.(popover)?.position === 'static') return NO_FLIP;
    const vw = window.innerWidth || document.documentElement?.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement?.clientHeight || 0;
    const list = popover.getBoundingClientRect();
    const box = trigger.getBoundingClientRect();
    if (!vw || !vh || (list.width === 0 && list.height === 0)) return null;
    const rtl = window.getComputedStyle?.(popover)?.direction === 'rtl';
    const end = rtl ? list.left < VIEWPORT_MARGIN : list.right > vw - VIEWPORT_MARGIN;
    // The list hangs off its positioned wrapper (label, field and any line
    // under it), below it or, flipped, above it, so the room is measured
    // from the wrapper's edges; the field's own box stands in without one.
    const anchorEl = popover.offsetParent;
    const anchor = anchorEl && anchorEl.contains(trigger) ? anchorEl.getBoundingClientRect() : box;
    const band = visibleBand(anchorEl && anchorEl.contains(trigger) ? anchorEl : trigger, vh);
    const below = Math.floor(band.bottom - anchor.bottom - LIST_GAP - VIEWPORT_MARGIN);
    const above = Math.floor(anchor.top - band.top - LIST_GAP - VIEWPORT_MARGIN);
    const up = list.height > below && above > below;
    const room = Math.max(MIN_LIST_HEIGHT, up ? above : below);
    const maxHeight = list.height > room ? room : null;
    return end || up || maxHeight != null ? { end, up, maxHeight } : NO_FLIP;
}

function isEnabledOption(element) {
    return element.getAttribute('aria-disabled') !== 'true';
}

function isTypeaheadKey(event) {
    return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

function optionText(option) {
    if (typeof option.text === 'string') return option.text;
    return typeof option.label === 'string' || typeof option.label === 'number' ? String(option.label) : '';
}

function listboxOptions(popover) {
    return Array.from(popover?.querySelectorAll('[role="option"]') || []);
}
