// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Finds visible text that a clipping container cuts off on the block axis.
 * The function is self-contained so Playwright can serialize it into the page.
 *
 * @param {Document|Element} [root]
 * @returns {Array<{element: string, text: string, clientHeight: number, scrollHeight: number}>}
 */
export function clippedTextContainers(root = document) {
    const view = root.defaultView || root.ownerDocument?.defaultView || window;
    const candidates = root.querySelectorAll('*');
    const offenders = [];

    for (const element of candidates) {
        if (element.closest('[hidden], [aria-hidden="true"], .sr-only')) continue;

        const style = view.getComputedStyle(element);
        const opacity = Number.parseFloat(style.opacity);
        if (style.display === 'none' || style.visibility === 'hidden' || opacity === 0) {
            continue;
        }
        const clipsAll = (style.clipPath && style.clipPath !== 'none')
            || (style.clip && style.clip !== 'auto');
        if (style.position === 'absolute'
            && element.clientWidth <= 1
            && element.clientHeight <= 1
            && clipsAll) {
            continue;
        }
        if (style.overflowY !== 'hidden' && style.overflowY !== 'clip') continue;

        const text = (element.textContent || '').trim().replace(/\s+/g, ' ');
        if (!text || element.clientHeight <= 0) continue;
        if (element.scrollHeight <= element.clientHeight + 1) continue;

        offenders.push({
            element: element.tagName.toLowerCase()
                + (typeof element.className === 'string' && element.className.trim()
                    ? `.${element.className.trim().split(/\s+/).join('.')}`
                    : ''),
            text: text.slice(0, 80),
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
        });
    }

    return offenders;
}
