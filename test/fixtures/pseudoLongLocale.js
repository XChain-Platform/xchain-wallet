// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { en } from '../../packages/core/src/i18n/locales/en/index.js';

export const PSEUDO_LONG_LOCALE = 'en-XA';
export const PSEUDO_LONG_MARKER = '［';

export function pseudoLong(value) {
    const source = String(value);
    const targetLength = Math.ceil(Array.from(source).length * 1.4);
    const paddingLength = Math.max(1, targetLength - Array.from(source).length);
    return `${PSEUDO_LONG_MARKER}${source}${'~'.repeat(paddingLength - 1)}`;
}

export const pseudoLongDictionary = Object.fromEntries(
    Object.entries(en).map(([key, value]) => [key, pseudoLong(value)]),
);

// Some route copy still bypasses t(), so the test harness expands those
// rendered English nodes and accessible labels without shipping a fallback.
export function pseudoLongRenderedEnglish(root) {
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const node of textNodes) {
        const match = node.textContent.match(/^(\s*)([\s\S]*?)(\s*)$/);
        const text = match?.[2] || '';
        if (!/[A-Za-z]/.test(text) || text.startsWith(PSEUDO_LONG_MARKER)) continue;
        node.textContent = `${match[1]}${pseudoLong(text)}${match[3]}`;
    }
    for (const element of root.querySelectorAll('[aria-label], [title], [placeholder]')) {
        for (const attribute of ['aria-label', 'title', 'placeholder']) {
            const value = element.getAttribute(attribute);
            if (/[A-Za-z]/.test(value || '') && !value.startsWith(PSEUDO_LONG_MARKER)) {
                element.setAttribute(attribute, pseudoLong(value));
            }
        }
    }
}
