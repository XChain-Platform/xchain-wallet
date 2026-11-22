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
    it('lets the terms box and its gate fill the spare height on phone and popup widths, and stop at content height from 834px', () => {
        for (const selector of ['.licenseScroll', '.licenseGate']) {
            // Only the rules that set flex: the short-landscape rule after the
            // 834px block sets just a min-height and leaves the growth alone.
            const bodies = ruleBodies(onboardingCss, selector).filter((body) => flexGrow(body) !== null);
            expect(flexGrow(bodies[0]), `${selector} base flex-grow`).toBe(1);
            expect(flexGrow(bodies[bodies.length - 1]), `${selector} 834px flex-grow`).toBe(0);
        }
        const stack = ruleBodies(onboardingCss, 'form.licenseForm > [data-form-stack]');
        expect(flexGrow(stack[0])).toBe(1);
        expect(stack[0]).toMatch(/min-height\s*:\s*0\s*;/);
        expect(flexGrow(stack[stack.length - 1])).toBe(0);
    });

    it('keeps every gap between the header, terms, acknowledgement row and button at 8px', () => {
        const [gate] = ruleBodies(onboardingCss, '.licenseGate');
        expect(gate).toMatch(/gap\s*:\s*var\(--xc-space-2\)\s*;/);
        const [form] = ruleBodies(onboardingCss, 'form.licenseForm');
        expect(form).toMatch(/--xc-form-gap\s*:\s*var\(--xc-space-2\)\s*;/);
        expect(form).not.toMatch(/(?:^|[;\s])gap\s*:\s*var\(--xc-space-2\)\s*;/);
        const [body] = ruleBodies(formPageCss, '.body');
        expect(body).toMatch(/gap\s*:\s*var\(--xc-form-gap\)\s*;/);
        const [controls] = ruleBodies(onboardingCss, '.licenseControls');
        expect(controls).toMatch(/gap\s*:\s*var\(--xc-space-2\)\s*;/);
        // No margin or padding on the licence parts may exceed the 8px token.
        for (const selector of ['.licenseGate', '.licenseControls', 'label.licenseAck', '.licenseActions']) {
            for (const body of ruleBodies(onboardingCss, selector)) {
                expect(body, selector).not.toMatch(/(?:margin|padding)(?:-[a-z]+)?\s*:[^;]*(?:space-[3-9]|form-gap|page-top)/);
            }
        }
    });

    it('keeps the fill body from growing into spare height', () => {
        const checks = [
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
        expect(base).toMatch(/(?:^|[;\s])flex\s*:\s*1 1 auto\s*;/);
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

    it('wraps Accept to a full-width line below 834px and shares one row from 834px', () => {
        const bodies = ruleBodies(onboardingCss, '.licenseControls');
        expect(bodies.length).toBeGreaterThan(0);
        // No rule at any breakpoint may stack the row.
        for (const body of bodies) {
            expect(body).not.toMatch(/flex-direction\s*:\s*column/);
        }
        const [base] = bodies;
        expect(base).toMatch(/flex-direction\s*:\s*row\s*;/);
        expect(base).toMatch(/flex-wrap\s*:\s*wrap\s*;/);
        expect(base).toMatch(/align-items\s*:\s*center\s*;/);
        expect(base).toMatch(/justify-content\s*:\s*space-between\s*;/);
        expect(base).toMatch(/gap\s*:\s*var\(--xc-space-2\)\s*;/);
        // Below 834px Accept takes its own line at full width, the page's main
        // action (G50); from 834px it keeps its natural width at the row end (U68).
        const [baseButton, wideButton] = ruleBodies(onboardingCss, '.licenseActions > button');
        expect(baseButton).toMatch(/width\s*:\s*100%\s*;/);
        expect(wideButton).toMatch(/width\s*:\s*auto\s*;/);
        const [baseActions, wideActions] = ruleBodies(onboardingCss, '.licenseActions');
        expect(baseActions).toMatch(/flex\s*:\s*1 1 100%\s*;/);
        expect(wideActions).toMatch(/flex\s*:\s*0 0 auto\s*;/);
    });
});
