// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { submitOnlyFromLastField } from '../../../packages/core/src/ui/formEnter.js';

// jsdom lays out nothing, so every input reports no client rects; the tests
// give each input one box, the way a browser does for a rendered field
// (Chromium included for a field inside a closed <details>).
function mountForm(html) {
    const form = document.createElement('form');
    form.innerHTML = html;
    document.body.append(form);
    form.querySelectorAll('input').forEach((input) => {
        input.getClientRects = () => [{ width: 100, height: 40 }];
    });
    return form;
}

function pressEnter(form, id) {
    const target = form.querySelector(`#${id}`);
    const event = {
        key: 'Enter',
        defaultPrevented: false,
        target,
        currentTarget: form,
        preventDefault() { this.defaultPrevented = true; },
    };
    submitOnlyFromLastField(event);
    return { submits: !event.defaultPrevented };
}

afterEach(() => {
    document.body.replaceChildren();
});

describe('submitOnlyFromLastField', () => {
    it('submits from the last typing field and holds Enter in an earlier one', () => {
        const form = mountForm('<input id="to"><input id="amount" type="text">');
        expect(pressEnter(form, 'to').submits).toBe(false);
        expect(pressEnter(form, 'amount').submits).toBe(true);
    });

    it('ignores a field inside a closed disclosure after the last typing field', () => {
        const form = mountForm(`
            <input id="from" readonly>
            <input id="to">
            <input id="amount">
            <details><summary>Advanced</summary><input id="memo"></details>
        `);
        expect(pressEnter(form, 'to').submits).toBe(false);
        expect(pressEnter(form, 'amount').submits).toBe(true);
    });

    it('counts a field in an open disclosure as the last field', () => {
        const form = mountForm(`
            <input id="to">
            <input id="amount">
            <details open><summary>Advanced</summary><input id="memo"></details>
        `);
        expect(pressEnter(form, 'amount').submits).toBe(false);
        expect(pressEnter(form, 'memo').submits).toBe(true);
    });

    it('ignores a read-only picker field after the last typing field', () => {
        const form = mountForm(`
            <input id="to">
            <input id="amount">
            <details open><summary>Advanced</summary><input id="change" readonly></details>
        `);
        expect(pressEnter(form, 'amount').submits).toBe(true);
    });

    it('never submits from a read-only field', () => {
        const form = mountForm('<input id="from" readonly><input id="amount">');
        expect(pressEnter(form, 'from').submits).toBe(false);
        const single = mountForm('<input id="only" readonly>');
        expect(pressEnter(single, 'only').submits).toBe(false);
    });

    it('leaves a one-field form and non-text controls to the browser', () => {
        const single = mountForm('<input id="name">');
        expect(pressEnter(single, 'name').submits).toBe(true);
        const withBox = mountForm('<input id="pick" type="checkbox"><input id="a"><input id="b">');
        expect(pressEnter(withBox, 'pick').submits).toBe(true);
    });
});
