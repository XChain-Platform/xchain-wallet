// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

export function readFoldCapture(
    {
        scrollSelector = '[data-list-detail] > div:not([role]) > [role="region"]',
        confirmSelector = '[data-testid="confirm-modal"]',
        detailSelector = '[data-list-detail] > [role="region"]',
    } = {},
    root = document,
) {
    const fields = {};
    const skippedInputTypes = new Set(['hidden', 'password', 'file', 'button', 'submit', 'reset']);

    for (const field of root.querySelectorAll('input, textarea, select')) {
        const key = field.getAttribute('name') || field.getAttribute('id');
        const inputType = field.tagName === 'INPUT' ? field.type.toLowerCase() : '';

        if (!key || skippedInputTypes.has(inputType) || Object.hasOwn(fields, key)) continue;

        const value = inputType === 'checkbox' || inputType === 'radio' ? String(field.checked) : String(field.value);
        Object.defineProperty(fields, key, { value, enumerable: true, configurable: true, writable: true });
    }

    const scrollRegion = root.querySelector(scrollSelector);
    const detailLabel = root.querySelector(detailSelector)?.getAttribute('aria-label');

    return {
        fields,
        scrollTop: scrollRegion?.scrollTop ?? null,
        confirmOpen: root.querySelector(confirmSelector) !== null,
        detailKey: detailLabel || null,
    };
}

export function captureFoldState(page, options = {}) {
    return page.evaluate(readFoldCapture, options);
}
