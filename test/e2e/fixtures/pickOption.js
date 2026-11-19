// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every wallet dropdown is the themed dropdown (ruling G96): a
// `button[role=combobox][data-xc-select]` trigger that opens a
// `[role=listbox]` of `[role=option][data-value]` buttons. Playwright's
// `selectOption` and `toHaveValue` only work on a native <select>, so specs
// pick and read these fields through this file. A native <select> that is not
// the shared Select still works through the same calls.

import { expect } from '@playwright/test';

/** Matches native selects and themed dropdown triggers, for control sweeps. */
export const SELECT_CONTROL = 'select, [data-xc-select]';

function attrValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Picks `choice` on a dropdown the way a person does. It fails when the
 * option is missing or the list stays open; it does not wait for the value,
 * because some fields (the active network) apply a pick only after a confirm
 * dialog. `choice` takes Playwright's selectOption shapes: a value string,
 * `{ value }`, `{ label }` or `{ index }`.
 *
 * @param {import('@playwright/test').Locator} control  the trigger (or a native select)
 * @param {string | { value?: string, label?: string | RegExp, index?: number }} choice
 * @returns {Promise<string[]>} the picked value, in an array as selectOption returns it
 */
export async function pickOption(control, choice) {
    const tag = await control.evaluate((el) => el.tagName);
    if (tag === 'SELECT') return control.selectOption(choice);
    const wanted = choice !== null && typeof choice === 'object' && !(choice instanceof RegExp)
        ? choice
        : { value: String(choice) };
    // The open listbox carries the field's name too, so a getByLabel locator
    // would match two elements once it opens, and a pick can rename the field
    // (Language). Pin the trigger by id while the list is still closed.
    const triggerId = await control.getAttribute('id');
    const trigger = triggerId ? control.page().locator(`[id="${attrValue(triggerId)}"]`) : control;
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const listboxId = await trigger.getAttribute('aria-controls');
    const listbox = control.page().locator(`[id="${attrValue(listboxId)}"]`);
    let option;
    if ('index' in wanted) option = listbox.getByRole('option').nth(wanted.index);
    else if ('value' in wanted) option = listbox.locator(`[role="option"][data-value="${attrValue(wanted.value)}"]`);
    else option = listbox.getByRole('option', { name: wanted.label, exact: typeof wanted.label === 'string' });
    const value = await option.getAttribute('data-value');
    await option.click();
    await expect(listbox).toBeHidden();
    return [value];
}

/**
 * Picks several values back to back inside the page, with only a zero-delay
 * task between clicks, for race tests that need picks far faster than a
 * Playwright round trip. A native select gets a value plus change event per
 * pick; a themed dropdown gets a trigger click and an option click per pick.
 *
 * @param {import('@playwright/test').Locator} control
 * @param {string[]} values
 */
export async function rapidPicks(control, values) {
    await control.evaluate(async (el, picks) => {
        const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });
        for (const value of picks) {
            if (el.tagName === 'SELECT') {
                el.value = value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                continue;
            }
            if (el.getAttribute('aria-expanded') !== 'true') el.click();
            await tick();
            const listbox = document.getElementById(el.getAttribute('aria-controls') || '');
            const option = listbox?.querySelector(`[role="option"][data-value="${CSS.escape(value)}"]`);
            if (!option) throw new Error(`rapidPicks: no option ${value}`);
            option.click();
            await tick();
        }
    }, values);
}

/**
 * The value a dropdown currently holds: the trigger's `value` attribute, or a
 * native select's value. Use it where a spec read `inputValue()`.
 *
 * @param {import('@playwright/test').Locator} control
 */
export async function dropdownValue(control) {
    const tag = await control.evaluate((el) => el.tagName);
    if (tag === 'SELECT') return control.inputValue();
    return (await control.getAttribute('value')) ?? '';
}

/**
 * Asserts the value a dropdown holds, retrying like `toHaveValue`.
 *
 * @param {import('@playwright/test').Locator} control
 * @param {string} value
 */
export async function expectDropdownValue(control, value) {
    await expect.poll(() => dropdownValue(control)).toBe(String(value));
}
