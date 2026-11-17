// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Children, Fragment, forwardRef, isValidElement, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { IconSelectControl } from './IconSelect.jsx';
import { InFilterPanel } from './filterPanelSlot.js';
import { InfoTip } from './InfoTip.jsx';
import styles from './Input.module.css';
import iconSelectStyles from './IconSelect.module.css';
import { fieldHelpName, resolveFieldRequirement } from './fieldRequirement.js';
import { OptionalPill } from './OptionalPill.jsx';
import { useFormFieldError } from './formErrors.js';
import { t } from '../i18n/index.js';
import '../i18n/locales/en/ui.js';

/**
 * The wallet's standard dropdown (ruling G96): the themed IconSelect trigger
 * and listbox, never a native grey `<select>`, inside Input's field layout
 * (label on its own line above, full-width control below, hint and error
 * under it).
 *
 * Choices come as `<option>` children (optionally inside `<optgroup>`, which
 * is flattened), as `<Select.Option value icon sub>` children when a choice
 * needs a glyph, or as an `options` array of `{ value, label, icon?, sub?,
 * disabled? }`. Values are strings, as a native select reports them.
 *
 * `onChange` receives a change-event-like object whose `target` and
 * `currentTarget` carry `value`, `name` and `id`, so `e.target.value` callers
 * work unchanged. It fires only when the picked value differs, as native
 * change does. A `name` adds a hidden input so the value reaches FormData.
 * The forwarded ref is the trigger button, whose `value` is the current value.
 * Uncontrolled use takes `defaultValue`.
 *
 * @typedef {object} SelectOwnProps
 * @property {string} [label]
 * @property {import('react').ReactNode} [help] contextual help shown from the label-row InfoTip.
 * @property {string} [hint]
 * @property {string} [error]
 * @property {string} [id]
 * @property {boolean} [optional]   shows the shared Optional pill and exposes the field as optional to assistive technology.
 * @property {'sm' | 'md' | 'lg'} [size] field size, matching Input.
 * @property {Array<{ value: string | number, label: import('react').ReactNode, icon?: import('react').ReactNode, sub?: import('react').ReactNode, disabled?: boolean }>} [options]
 * @property {string} [placeholder] shown only when there are no choices at all.
 */
// Option rides on Select itself (`<Select.Option>`), assigned inside the
// declaration because a module that imports an i18n namespace may have no
// other top-level statement (see namespaceImports.test.js).
export const Select = /* @__PURE__ */ Object.assign(/* @__PURE__ */ forwardRef(function Select(
    {
        label,
        help,
        hint,
        error: errorProp,
        id,
        optional = false,
        size = 'md',
        children,
        options: optionsProp,
        className,
        style,
        onChange,
        value: valueProp,
        defaultValue,
        name,
        disabled = false,
        placeholder = t('ui.iconSelect.select'),
        required = false,
        'aria-invalid': externalInvalid,
        'aria-describedby': externalDescribedBy,
        'aria-required': externalRequired,
        ...rest
    },
    ref,
) {
    const autoId = useId();
    const selectId = id || autoId;
    // The form error standard: this field's entry in the form's error map,
    // dropped on change; an `error` the caller passes wins.
    const formField = useFormFieldError(id);
    const error = errorProp || formField.error;
    const triggerRef = useRef(null);
    const setTriggerRef = useCallback((node) => {
        triggerRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
    }, [ref]);
    const options = useMemo(() => normalizeOptions(optionsProp, children), [optionsProp, children]);
    const controlled = valueProp !== undefined;
    const [uncontrolledValue, setUncontrolledValue] = useState(
        () => (defaultValue == null ? undefined : String(defaultValue)),
    );
    const requestedValue = controlled ? valueProp : uncontrolledValue;
    // A value no option carries shows the first enabled option, as React's
    // controlled native select does, so the trigger never reads blank.
    const shownOption = (requestedValue != null && options.find((o) => o.value === String(requestedValue)))
        || options.find((o) => !o.disabled)
        || null;
    const currentValue = shownOption ? shownOption.value : '';
    const requirement = resolveFieldRequirement({
        label,
        optional,
        required,
        ariaRequired: externalRequired,
    });
    const [dismissedError, setDismissedError] = useState(null);
    const visibleError = error && error !== dismissedError ? error : null;
    const hintId = hint && !visibleError ? `${selectId}-hint` : undefined;
    const errorId = visibleError ? `${selectId}-error` : undefined;
    const optionalPillId = requirement.isOptional ? `${selectId}-optional` : undefined;
    // In a list's filter panel the label is the trigger's accessible name only;
    // nothing shows above the dropdown, and its first option names the filter.
    const labelHidden = useContext(InFilterPanel) && Boolean(label);
    const shownLabel = labelHidden ? null : label;
    const hiddenLabelName = labelHidden && typeof requirement.label === 'string' ? requirement.label : undefined;
    const hasHelp = Boolean(shownLabel && help);
    const describedBy = [externalDescribedBy, optionalPillId, hintId, errorId]
        .filter(Boolean).join(' ') || undefined;

    useEffect(() => {
        if (!error) setDismissedError(null);
    }, [error]);

    const handleSelect = (nextValue) => {
        if (nextValue === currentValue) return;
        if (error) setDismissedError(error);
        formField.clear();
        if (!controlled) setUncontrolledValue(nextValue);
        onChange?.(selectChangeEvent(nextValue, name, selectId));
    };

    // A native label click only focuses its select; it must not also open the list.
    const focusTrigger = (event) => {
        event.preventDefault();
        triggerRef.current?.focus();
    };

    return (
        <div className={`${styles.field} ${styles[size] || ''}`.trim()}>
            {shownLabel && (requirement.isOptional || hasHelp) ? (
                <div className={styles.labelRow}>
                    <label htmlFor={selectId} className={styles.label} onClick={focusTrigger}>
                        {requirement.label}
                    </label>
                    {hasHelp ? (
                        <InfoTip
                            className={styles.labelHelp}
                            label={help}
                            aria={t('ui.field.about', { label: fieldHelpName(requirement.label, rest['aria-label']) })}
                        />
                    ) : null}
                    {/* The ? help comes first, then the Optional tag. */}
                    {requirement.isOptional ? <OptionalPill id={optionalPillId} /> : null}
                </div>
            ) : shownLabel ? (
                <label htmlFor={selectId} className={styles.label} onClick={focusTrigger}>{requirement.label}</label>
            ) : null}
            <div className={`${iconSelectStyles.wrap} ${iconSelectStyles[size] || ''}`.trim()}>
                <IconSelectControl
                    value={currentValue}
                    options={options}
                    onSelect={handleSelect}
                    placeholder={placeholder}
                    disabled={disabled}
                    iconSlot="auto"
                    listboxLabel={rest['aria-label'] || (typeof requirement.label === 'string' ? requirement.label : undefined)}
                    triggerRef={setTriggerRef}
                    triggerProps={{
                        ...rest,
                        'aria-label': rest['aria-label'] || hiddenLabelName,
                        id: selectId,
                        role: 'combobox',
                        value: currentValue,
                        className: [className, visibleError ? iconSelectStyles.invalid : '']
                            .filter(Boolean).join(' ') || undefined,
                        style,
                        'data-xc-select': '',
                        'aria-invalid': visibleError ? 'true' : externalInvalid,
                        'aria-describedby': describedBy,
                        'aria-required': requirement.ariaRequired,
                    }}
                />
                {name ? <input type="hidden" name={name} value={currentValue} /> : null}
            </div>
            {hint && !visibleError ? (
                <div id={hintId} className={styles.hint}>{hint}</div>
            ) : null}
            {visibleError ? (
                <div id={errorId} className={styles.error} role="alert">{visibleError}</div>
            ) : null}
        </div>
    );
}), { Option: SelectOption });

/**
 * One choice for Select when it needs more than text: `icon` renders before
 * the label in the trigger and the list, `sub` as a second line. It renders
 * nothing itself; Select reads its props. Also reachable as `Select.Option`.
 *
 * @param {{ value: string | number, icon?: import('react').ReactNode, sub?: import('react').ReactNode, disabled?: boolean, children?: import('react').ReactNode }} _props
 */
export function SelectOption(_props) {
    return null;
}

function selectChangeEvent(value, name, id) {
    const target = { value, name, id };
    return {
        type: 'change',
        target,
        currentTarget: target,
        preventDefault() {},
        stopPropagation() {},
        persist() {},
        isDefaultPrevented: () => false,
        isPropagationStopped: () => false,
    };
}

function normalizeOptions(optionsProp, children) {
    if (Array.isArray(optionsProp)) {
        return optionsProp.map((o) => ({
            value: String(o.value),
            label: o.label,
            text: textOf(o.label),
            icon: o.icon,
            sub: o.sub,
            disabled: Boolean(o.disabled),
        }));
    }
    const out = [];
    collectOptions(children, false, out);
    return out;
}

function collectOptions(children, groupDisabled, out) {
    Children.forEach(children, (child) => {
        if (!isValidElement(child)) return;
        const { props } = child;
        if (child.type === Fragment) {
            collectOptions(props.children, groupDisabled, out);
            return;
        }
        if (child.type === 'optgroup') {
            collectOptions(props.children, groupDisabled || Boolean(props.disabled), out);
            return;
        }
        if (child.type !== 'option' && child.type !== SelectOption) return;
        const text = textOf(props.children);
        out.push({
            value: String(props.value ?? text),
            // A native option shows only its text, so it is labelled with that text.
            label: child.type === 'option' ? text : props.children,
            text,
            icon: props.icon,
            sub: props.sub,
            disabled: groupDisabled || Boolean(props.disabled),
        });
    });
}

function textOf(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join('');
    if (isValidElement(node)) return textOf(node.props.children);
    return '';
}
