// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect } from 'vitest';
import axe from 'axe-core';

const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

export function supportsAxeColorContrast(container) {
    const doc = container?.ownerDocument;
    const view = doc?.defaultView;
    if (!doc || !view?.getComputedStyle) return false;

    const probe = doc.createElement('span');
    probe.textContent = 'contrast probe';
    probe.style.color = 'rgb(1, 2, 3)';
    probe.style.backgroundColor = 'rgb(250, 251, 252)';
    container.append(probe);
    const computed = view.getComputedStyle(probe);
    const hasComputedColors = computed.color === 'rgb(1, 2, 3)'
        && computed.backgroundColor === 'rgb(250, 251, 252)';
    const hasLayoutBox = probe.getClientRects().length > 0;
    probe.remove();
    return hasComputedColors && hasLayoutBox;
}

export async function expectNoSeriousAxeViolations(container, options = {}) {
    const colorContrast = options.rules?.['color-contrast']?.enabled
        ?? supportsAxeColorContrast(container);
    const { violations } = await axe.run(container, {
        ...options,
        rules: {
            ...options.rules,
            'color-contrast': { enabled: colorContrast },
        },
    });
    const blocking = violations
        .filter((violation) => BLOCKING_IMPACTS.has(violation.impact))
        .map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            help: violation.help,
            nodes: violation.nodes.map((node) => ({
                target: node.target,
                html: node.html,
                failureSummary: node.failureSummary,
            })),
        }));
    expect(blocking).toEqual([]);
}
