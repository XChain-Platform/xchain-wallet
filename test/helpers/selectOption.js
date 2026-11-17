// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Picks a choice on the wallet's themed dropdown (ui/Select, ui/IconSelect)
// the way a person does: open the trigger, click the option. A native
// <select> still works, through a change event, so one helper serves both.
//
// `choice` is a value string, or `{ value }`, `{ label }` (option text,
// string or RegExp) or `{ index }`, matching Playwright's selectOption.

import { fireEvent } from '@testing-library/react';
import { flushSync } from 'react-dom';

// Inside a caller's act() the open-list update would wait for that act to
// end, so each click is flushed synchronously and the list exists at once.
function click(element) {
    flushSync(() => { fireEvent.click(element); });
}

function normalizeChoice(choice) {
    if (choice && typeof choice === 'object' && !(choice instanceof RegExp)) return choice;
    return { value: String(choice) };
}

function optionMatches(option, choice) {
    if ('value' in choice) return option.getAttribute('data-value') === String(choice.value);
    const text = option.textContent.trim();
    return choice.label instanceof RegExp ? choice.label.test(text) : text === choice.label;
}

function describeOptions(options) {
    return options.map((o) => `${o.getAttribute('data-value')} (${o.textContent.trim()})`).join(', ');
}

function nativeValue(select, choice) {
    const options = Array.from(select.options);
    if ('index' in choice) return options[choice.index]?.value;
    if ('value' in choice) return String(choice.value);
    return options.find((o) => (choice.label instanceof RegExp
        ? choice.label.test(o.textContent.trim())
        : o.textContent.trim() === choice.label))?.value;
}

/** The open listbox a themed trigger controls, opening it first if needed. */
export function openSelectListbox(trigger) {
    if (trigger.getAttribute('aria-expanded') !== 'true') click(trigger);
    const id = trigger.getAttribute('aria-controls');
    const listbox = id ? document.getElementById(id) : null;
    if (!listbox) throw new Error('selectOption: the trigger did not open a listbox (is it disabled?)');
    return listbox;
}

/** The option element a choice names, inside an open listbox. */
export function findSelectOption(listbox, choice) {
    const wanted = normalizeChoice(choice);
    const options = Array.from(listbox.querySelectorAll('[role="option"]'));
    const option = 'index' in wanted ? options[wanted.index] : options.find((o) => optionMatches(o, wanted));
    if (!option) {
        throw new Error(`selectOption: no option ${JSON.stringify(wanted)}; available: ${describeOptions(options)}`);
    }
    return option;
}

/**
 * Picks `choice` on `control` synchronously with fireEvent. Returns the
 * picked value. Throws when the option is missing or disabled, so a test
 * never passes on a pick that did not happen.
 *
 * @param {HTMLElement} control  the combobox trigger (or a native select)
 * @param {string | { value?: string, label?: string | RegExp, index?: number }} choice
 */
export function selectOption(control, choice) {
    const wanted = normalizeChoice(choice);
    if (control instanceof HTMLSelectElement) {
        const value = nativeValue(control, wanted);
        fireEvent.change(control, { target: { value } });
        return value;
    }
    const option = findSelectOption(openSelectListbox(control), wanted);
    if (option.getAttribute('aria-disabled') === 'true') {
        throw new Error(`selectOption: option ${option.getAttribute('data-value')} is disabled`);
    }
    click(option);
    return option.getAttribute('data-value');
}

/**
 * The userEvent form of selectOption: real pointer clicks on the trigger and
 * the option.
 *
 * @param {{ click: (el: Element) => Promise<void>, selectOptions?: Function }} user
 * @param {HTMLElement} control
 * @param {string | { value?: string, label?: string | RegExp, index?: number }} choice
 */
export async function userSelectOption(user, control, choice) {
    const wanted = normalizeChoice(choice);
    if (control instanceof HTMLSelectElement) {
        const value = nativeValue(control, wanted);
        await user.selectOptions(control, value);
        return value;
    }
    if (control.getAttribute('aria-expanded') !== 'true') await user.click(control);
    const id = control.getAttribute('aria-controls');
    const listbox = id ? document.getElementById(id) : null;
    if (!listbox) throw new Error('userSelectOption: the trigger did not open a listbox (is it disabled?)');
    const option = findSelectOption(listbox, wanted);
    if (option.getAttribute('aria-disabled') === 'true') {
        throw new Error(`userSelectOption: option ${option.getAttribute('data-value')} is disabled`);
    }
    await user.click(option);
    return option.getAttribute('data-value');
}

/**
 * Reads every option of a dropdown (opening and then closing a themed one)
 * as `{ value, label, disabled, selected }`, in order.
 */
export function selectOptionDetails(control) {
    if (control instanceof HTMLSelectElement) {
        return Array.from(control.options).map((o) => ({
            value: o.value, label: o.textContent.trim(), disabled: o.disabled, selected: o.selected,
        }));
    }
    const wasOpen = control.getAttribute('aria-expanded') === 'true';
    const listbox = openSelectListbox(control);
    const details = Array.from(listbox.querySelectorAll('[role="option"]')).map((o) => ({
        value: o.getAttribute('data-value'),
        label: o.textContent.trim(),
        disabled: o.getAttribute('aria-disabled') === 'true',
        selected: o.getAttribute('aria-selected') === 'true',
    }));
    if (!wasOpen) click(control);
    return details;
}

/** The option values a dropdown offers, in order. */
export function selectOptionValues(control) {
    return selectOptionDetails(control).map((o) => o.value);
}

/** The option labels a dropdown shows, in order. */
export function selectOptionLabels(control) {
    return selectOptionDetails(control).map((o) => o.label);
}
