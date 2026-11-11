// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The axe-core scan, shared by the dev-server a11y suite and the regtest
// one.
//
// It lives here because the confirm surface can only be scanned on the
// regtest venue - the dev shell cannot compose - while everything else is
// scanned against the dev server. Two copies of "what counts as a
// violation, and how is it reported" would drift, and the reporting half is
// the part that makes a failure actionable.

import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { freezeMotion } from './wallet.js';

export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// The accent, success, warning and muted-text tokens in tokens.css clear AA
// in the default light theme, so this suite quarantines none of them. One exception remains, by ruling: U97 keeps the main action
// green (light theme success fill) at #16A34A with white text, 3.3:1. Only
// that exact pair is dropped; every other color-contrast finding fails.
const RULED_CONTRAST_PAIRS = [{ fg: '#ffffff', bg: '#16a34a', ruling: 'U97' }];

function contrastPair(node) {
    const data = node.any?.[0]?.data || {};
    return { fg: data.fgColor, bg: data.bgColor, ratio: data.contrastRatio };
}

function isRuledContrast(node) {
    const { fg, bg } = contrastPair(node);
    return RULED_CONTRAST_PAIRS.some((pair) => pair.fg === String(fg).toLowerCase()
        && pair.bg === String(bg).toLowerCase());
}

/** Drops the color-contrast nodes a ruling accepts, and any rule left with no nodes. */
export function withoutRuledContrast(violations) {
    return violations
        .map((v) => (v.id === 'color-contrast' ? { ...v, nodes: v.nodes.filter((n) => !isRuledContrast(n)) } : v))
        .filter((v) => v.nodes.length > 0);
}

export async function violationsFor(page) {
    // Settle the paint first: a scan racing a fade-in reads blended colors.
    await freezeMotion(page);
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    return withoutRuledContrast(results.violations);
}

export async function scan(page, label) {
    const unexpected = await violationsFor(page);

    expect(
        unexpected,
        `${label} a11y violations: ${unexpected
            .map((v) =>
                v.id === 'color-contrast'
                    ? `color-contrast on ${v.nodes
                        .map((n) => {
                            const { fg, bg, ratio } = contrastPair(n);
                            return `${fg} on ${bg} (${ratio}:1)`;
                        })
                        .join(', ')}`
                    : `${v.id} (${v.impact}): ${v.help}`,
            )
            .join('; ')}`,
    ).toEqual([]);
}
