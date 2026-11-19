// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The height rule of an auto-growing Textarea: one line when empty, taller
// with each wrapped line up to `maxRows`, then a fixed height that scrolls.

/**
 * The box height and vertical overflow for a text of `scrollHeight` (content
 * plus padding, as the browser reports it with the height set to auto).
 * Below the cap the box fits the text and never scrolls; past it the box
 * stops at `maxRows` lines and the text scrolls inside.
 *
 * @param {object} metrics
 * @param {number} metrics.scrollHeight  content plus block padding, in px
 * @param {number} metrics.lineHeight    one text line, in px
 * @param {number} metrics.paddingBlock  top plus bottom padding, in px
 * @param {number} metrics.borderBlock   top plus bottom border, in px
 * @param {number} metrics.maxRows       the most lines shown before it scrolls
 * @returns {{ height: number, overflowY: 'hidden' | 'auto' }}
 */
export function autoGrowSize({ scrollHeight, lineHeight, paddingBlock, borderBlock, maxRows }) {
    const cap = lineHeight * Math.max(1, maxRows) + paddingBlock;
    const inner = Math.min(scrollHeight, cap);
    return {
        height: inner + borderBlock,
        // Half a pixel of slack: subpixel line heights round scrollHeight up.
        overflowY: scrollHeight > cap + 0.5 ? 'auto' : 'hidden',
    };
}

/**
 * Sizes a textarea in place by autoGrowSize. The CSS min-height keeps the
 * one-line box at the control height, so an empty field matches an Input.
 *
 * @param {HTMLTextAreaElement | null} node
 * @param {number} maxRows
 */
export function fitAutoGrow(node, maxRows) {
    if (!node || typeof getComputedStyle !== 'function') return;
    node.style.height = 'auto';
    // Not laid out (inside a closed section): leave the CSS height, and fit
    // again once it shows (the Textarea watches its width for that).
    if (!node.scrollHeight) {
        node.style.height = '';
        return;
    }
    const cs = getComputedStyle(node);
    const px = (v) => parseFloat(v) || 0;
    const fontSize = px(cs.fontSize) || 14;
    const lineHeight = px(cs.lineHeight) || fontSize * 1.25;
    const { height, overflowY } = autoGrowSize({
        scrollHeight: node.scrollHeight,
        lineHeight,
        paddingBlock: px(cs.paddingTop) + px(cs.paddingBottom),
        borderBlock: px(cs.borderTopWidth) + px(cs.borderBottomWidth),
        maxRows,
    });
    node.style.height = `${height}px`;
    node.style.overflowY = overflowY;
}
