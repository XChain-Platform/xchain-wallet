// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The licence gate's actions sit directly under the terms. The terms box takes
// the height of its text and shrinks with its own scroll only when the screen
// is too short; neither the box, its gate nor the FormPage fill body grows into
// spare height, so on a wide or tall shell no blank space opens inside the card
// bottom. At the licence breakpoint the acknowledgement and button share the
// row directly below the terms.

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Onboarding } from '../../../packages/core/src/shared/routes/Onboarding.jsx';

const ONBOARDING_CSS = 'packages/core/src/shared/routes/Onboarding.module.css';
const FORM_PAGE_CSS = 'packages/core/src/ui/FormPage.module.css';

function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

const onboardingCss = stripComments(readFileSync(ONBOARDING_CSS, 'utf8'));
const formPageCss = stripComments(readFileSync(FORM_PAGE_CSS, 'utf8'));

// Every innermost rule whose selector list names the selector, media blocks
// included, so a breakpoint cannot hand the growth back.
function ruleBodies(source, selector) {
    const bodies = [];
    for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = match[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
        if (selectors.includes(selector)) bodies.push(match[2]);
    }
    return bodies;
}

// The flex-grow a rule body sets, or null when it sets none.
function flexGrow(body) {
    const grow = body.match(/(?:^|[;\s])flex-grow\s*:\s*([^;]+)/);
    if (grow) return Number.parseFloat(grow[1]);
    const flex = body.match(/(?:^|[;\s])flex\s*:\s*([^;]+)/);
    if (!flex) return null;
    const value = flex[1].trim();
    if (value === 'none') return 0;
    if (value === 'auto' || value === 'initial') return value === 'auto' ? 1 : 0;
    const first = Number.parseFloat(value.split(/\s+/)[0]);
    return Number.isNaN(first) ? 1 : first;
}

afterEach(() => {
    cleanup();
    globalThis.localStorage?.clear?.();
});

describe('Licence gate actions sit under the terms', () => {
    it('keeps the terms box, its gate and the fill body from growing into spare height', () => {
        const checks = [
            [ONBOARDING_CSS, onboardingCss, '.licenseScroll'],
            [ONBOARDING_CSS, onboardingCss, '.licenseGate'],
            [FORM_PAGE_CSS, formPageCss, '.fill > .body'],
        ];
        for (const [file, source, selector] of checks) {
            const bodies = ruleBodies(source, selector);
            expect(bodies.length, `${selector} in ${file}`).toBeGreaterThan(0);
            for (const body of bodies) {
                const grow = flexGrow(body);
                if (grow === null) continue;
                expect(grow, `${selector} flex-grow in ${file}`).toBe(0);
            }
        }
    });

    it('lets the terms box shrink with its own scroll and keep a readable floor on a short screen', () => {
        const [base] = ruleBodies(onboardingCss, '.licenseScroll');
        expect(base).toMatch(/(?:^|[;\s])flex\s*:\s*0 1 auto\s*;/);
        expect(base).toMatch(/min-height\s*:\s*160px\s*;/);
        expect(base).toMatch(/overflow-y\s*:\s*auto\s*;/);
        const [gate] = ruleBodies(onboardingCss, '.licenseGate');
        expect(gate).toMatch(/min-height\s*:\s*0\s*;/);
        const [fillBody] = ruleBodies(formPageCss, '.fill > .body');
        expect(fillBody).toMatch(/min-height\s*:\s*0\s*;/);
        expect(fillBody).toMatch(/overflow-y\s*:\s*auto\s*;/);
    });

    it('renders the checkbox before the button in one controls wrapper', () => {
        render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging: {} },
            React.createElement(Onboarding, { onCreate: () => {}, onImport: () => {} }),
        ));

        const terms = screen.getByLabelText('License terms');
        const checkbox = screen.getByRole('checkbox');
        const accept = screen.getByRole('button', { name: /Accept and continue/i });
        const controls = checkbox.closest('label')?.parentElement;
        expect(controls).not.toBeNull();
        expect(controls.contains(accept)).toBe(true);
        expect(terms.nextElementSibling).toBe(controls);
        expect(checkbox.compareDocumentPosition(accept) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('switches the shared controls wrapper to a row at 834px', () => {
        const wideControls = onboardingCss.match(
            /@media \(min-width: 834px\) \{[\s\S]*?\.licenseControls\s*\{([^}]*)\}/,
        )?.[1] ?? '';
        expect(wideControls).toMatch(/flex-direction\s*:\s*row\s*;/);
        expect(wideControls).toMatch(/align-items\s*:\s*center\s*;/);
        expect(wideControls).toMatch(/justify-content\s*:\s*space-between\s*;/);
    });
});
