// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect } from 'vitest';
import axe from 'axe-core';

const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

export async function expectNoSeriousAxeViolations(container) {
    const { violations } = await axe.run(container, {
        rules: {
            // jsdom does not compute the styles that axe needs for contrast.
            'color-contrast': { enabled: false },
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
