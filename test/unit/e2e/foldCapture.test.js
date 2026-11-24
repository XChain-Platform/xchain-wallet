// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, expect, it, vi } from 'vitest';

import { captureFoldState, readFoldCapture } from '../../e2e/fixtures/foldCapture.js';

afterEach(() => {
    document.body.replaceChildren();
});

it('captures supported fields by name or id and keeps the first duplicate', () => {
    document.body.innerHTML = `
        <input name="recipient" value="xc1recipient">
        <textarea name="memo">rent</textarea>
        <select name="asset"><option value="xch" selected>XCH</option></select>
        <input name="approved" type="checkbox" checked>
        <input name="declined" type="radio">
        <input id="id-only" value="fallback">
        <input value="unkeyed">
        <input name="secret" type="password" value="hidden">
        <input name="recipient" value="duplicate">
    `;

    expect(readFoldCapture().fields).toEqual({
        recipient: 'xc1recipient',
        memo: 'rent',
        asset: 'xch',
        approved: 'true',
        declined: 'false',
        'id-only': 'fallback',
    });
});

it.each(['hidden', 'file', 'button', 'submit', 'reset'])('skips %s inputs', (type) => {
    document.body.innerHTML = `<input name="excluded" type="${type}" value="ignored">`;

    expect(readFoldCapture().fields).toEqual({});
});

it('captures the default list body scroll position', () => {
    document.body.innerHTML = `
        <div data-list-detail>
            <div><div role="region" id="list-body"></div></div>
            <div role="region" aria-label="transaction-1"></div>
        </div>
    `;
    Object.defineProperty(document.querySelector('#list-body'), 'scrollTop', { value: 37 });

    expect(readFoldCapture()).toMatchObject({ scrollTop: 37, detailKey: 'transaction-1' });
});

it('returns null scroll without a list body or for a collapsed split', () => {
    expect(readFoldCapture().scrollTop).toBeNull();

    document.body.innerHTML = `
        <div data-list-detail>
            <div role="region" aria-label="transaction-1">
                <div role="region" id="nested-region"></div>
            </div>
        </div>
    `;
    Object.defineProperty(document.querySelector('#nested-region'), 'scrollTop', { value: 55 });

    expect(readFoldCapture().scrollTop).toBeNull();
});

it('captures confirm presence with the default and a custom selector', () => {
    expect(readFoldCapture().confirmOpen).toBe(false);

    document.body.innerHTML = '<div data-testid="confirm-modal"></div>';
    expect(readFoldCapture().confirmOpen).toBe(true);

    document.body.innerHTML = '<dialog data-custom-confirm></dialog>';
    expect(readFoldCapture({ confirmSelector: '[data-custom-confirm]' }).confirmOpen).toBe(true);
});

it('captures a detail label and returns null for an empty or absent label', () => {
    document.body.innerHTML = '<div data-list-detail><div role="region" aria-label="transaction-1"></div></div>';
    expect(readFoldCapture().detailKey).toBe('transaction-1');

    document.querySelector('[role="region"]').setAttribute('aria-label', '');
    expect(readFoldCapture().detailKey).toBeNull();

    document.querySelector('[role="region"]').remove();
    expect(readFoldCapture().detailKey).toBeNull();
});

it('uses custom scroll and detail selectors', () => {
    document.body.innerHTML = '<div data-custom-scroll></div><div data-custom-detail aria-label="custom-detail"></div>';
    Object.defineProperty(document.querySelector('[data-custom-scroll]'), 'scrollTop', { value: 19 });

    expect(
        readFoldCapture({
            scrollSelector: '[data-custom-scroll]',
            detailSelector: '[data-custom-detail]',
        }),
    ).toMatchObject({ scrollTop: 19, detailKey: 'custom-detail' });
});

it('serializes without outer bindings and reads from the global document', () => {
    document.body.innerHTML = `
        <input name="amount" value="12">
        <div data-custom-scroll></div>
        <dialog data-custom-confirm></dialog>
        <div data-custom-detail aria-label="transaction-2"></div>
    `;
    Object.defineProperty(document.querySelector('[data-custom-scroll]'), 'scrollTop', { value: 41 });
    const rebuiltReader = new Function(`return (${readFoldCapture.toString()})`)();
    const options = {
        scrollSelector: '[data-custom-scroll]',
        confirmSelector: '[data-custom-confirm]',
        detailSelector: '[data-custom-detail]',
    };

    expect(rebuiltReader(options)).toEqual(readFoldCapture(options));
});

it('passes the reader and options to page.evaluate using one browser argument', async () => {
    document.body.innerHTML = '<input name="amount" value="12"><div data-custom-detail aria-label="transaction-3"></div>';
    const options = { detailSelector: '[data-custom-detail]' };
    const page = {
        evaluate: vi.fn(async (reader, browserOptions) => reader(browserOptions)),
    };

    await expect(captureFoldState(page, options)).resolves.toMatchObject({
        fields: { amount: '12' },
        detailKey: 'transaction-3',
    });
    expect(page.evaluate).toHaveBeenCalledWith(readFoldCapture, options);
});
