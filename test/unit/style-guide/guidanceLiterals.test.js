// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

const sectionModules = import.meta.glob(
    '../../../packages/web/src/style-guide/sections/*.jsx',
    { eager: true },
);
const pageModules = import.meta.glob(
    '../../../packages/web/src/style-guide/StyleGuidePage.jsx',
    { eager: true },
);
const metaSections = Object.values(sectionModules)
    .flatMap((module) => module.SECTION_META ?? []);
const { SECTIONS = [], LEGACY_SECTION_IDS } = Object.values(pageModules)[0] ?? {};
const everySectionIsMeta = Array.isArray(LEGACY_SECTION_IDS)
    && LEGACY_SECTION_IDS.length === 0;
const forbiddenLiteral = /\d+px|#[\da-f]{3,8}\b|\brgb\(|\b(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\s+(?:screens?|routes?|files?|sections?|icons?|tokens?|variants?|rows?|groups?)\b/i;

afterEach(cleanup);

function guidanceProse(container) {
    const prose = [...container.querySelectorAll('.sg-guide-prose')];
    const legacy = [...container.querySelectorAll('.sg-guide dt')]
        .filter((term) => ['What', 'When'].includes(term.textContent.trim()))
        .map((term) => term.nextElementSibling)
        .filter(Boolean);

    return [...prose, ...legacy].map((element) => {
        const copy = element.cloneNode(true);
        copy.querySelectorAll('[data-ruling-id], code').forEach((node) => node.remove());
        return copy.textContent.replace(/\s+/g, ' ').trim();
    });
}

function violations(container) {
    return guidanceProse(container).filter((text) => forbiddenLiteral.test(text));
}

function renderSections(sections, closingMode) {
    return render(React.createElement(React.Fragment, null,
        ...sections.map(({ id, Component }) => (
            React.createElement(Component, { key: id, closingMode })
        )),
    ));
}

describe('style-guide guidance literals', () => {
    it('keeps meta section guidance free of values that belong in rulings or code', () => {
        if (everySectionIsMeta) {
            expect(metaSections.map(({ id }) => id).sort())
                .toEqual(SECTIONS.map(({ id }) => id).sort());
        }

        const { container } = renderSections(metaSections, true);

        expect(violations(container)).toEqual([]);
    });

    it('detects the planted prose while ignoring ruling and code literals', () => {
        function PlantedSection({ closingMode }) {
            return React.createElement('div', { className: 'sg-guide-prose' },
                closingMode && 'Twelve routes use a 12px gap. ',
                React.createElement('span', { 'data-ruling-id': 'G1' }, '#fff'),
                React.createElement('code', null, 'rgb(0 0 0)'),
            );
        }
        const { container } = renderSections([
            { id: 'planted', Component: PlantedSection },
        ], true);

        expect(violations(container)).toEqual(['Twelve routes use a 12px gap.']);
    });
});
