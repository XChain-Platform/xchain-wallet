// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The licence agreement keeps its terms in one outline card with inner
// padding: the scroll box draws the card outline and insets its text from
// the inner border edge by its own padding, at phone widths, on a short
// landscape phone and at desktop width.
//
// The spec measures the built renderer (packages/desktop/renderer/dist), so
// a style change needs a renderer build before it shows here.
// XCHAIN_E2E_PROFILE_ROOT picks where the throwaway profile goes; the
// system temp directory is the default.

import { existsSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, _electron as electron } from '@playwright/test';
import onboardingEn from '../../../packages/core/src/i18n/locales/en/onboarding.js';
import { closeElectron, launchGuardedElectron, readNetworkGuard } from '../fixtures/electron.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const desktopDir = join(resolve(here, '..', '..', '..'), 'packages', 'desktop');
const requireFromDesktop = createRequire(join(desktopDir, 'package.json'));

const TOLERANCE = 1;

const VIEWS = [
    { name: 'phone 360x780', width: 360, height: 780 },
    { name: 'phone 390x844', width: 390, height: 844 },
    { name: 'phone landscape 844x390', width: 844, height: 390 },
    { name: 'desktop 1280x800', width: 1280, height: 800 },
];

// Runs in the page: the terms scroll box, its outline and its first paragraph.
function measureLicence(label) {
    const terms = document.querySelector(`[aria-label="${label}"]`);
    if (!terms) return null;
    const first = terms.querySelector('p');
    const s = getComputedStyle(terms);
    const probe = document.createElement('div');
    probe.style.borderStyle = 'solid';
    probe.style.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--xc-border').trim();
    document.body.appendChild(probe);
    const tokenColor = getComputedStyle(probe).borderTopColor;
    probe.remove();
    const sides = ['Top', 'Right', 'Bottom', 'Left'].map((side) => ({
        side,
        width: parseFloat(s[`border${side}Width`]),
        style: s[`border${side}Style`],
        color: s[`border${side}Color`],
    }));
    const box = terms.getBoundingClientRect();
    const rtl = s.direction === 'rtl';
    const innerStart = rtl ? box.right - parseFloat(s.borderRightWidth) : box.left + parseFloat(s.borderLeftWidth);
    const p = first ? first.getBoundingClientRect() : null;
    return {
        viewport: [window.innerWidth, window.innerHeight],
        paddingInlineStart: s.paddingInlineStart,
        paddingInlineEnd: s.paddingInlineEnd,
        sides,
        tokenColor,
        hasParagraph: Boolean(first),
        textInlineStartGap: p ? (rtl ? innerStart - p.right : p.left - innerStart) : null,
    };
}

for (const view of VIEWS) {
    test(`licence card at ${view.name}: outlined, text inset by the card padding`, async () => {
        test.setTimeout(3 * 60 * 1000);
        expect(existsSync(join(desktopDir, 'renderer', 'dist', 'index.html')), 'renderer build present').toBe(true);
        const profile = mkdtempSync(join(process.env.XCHAIN_E2E_PROFILE_ROOT || tmpdir(), 'xc-licence-card-'));
        const app = await launchGuardedElectron(electron, {
            executablePath: requireFromDesktop('electron'),
            args: ['.', `--user-data-dir=${profile}`, '--use-mock-keychain'],
            cwd: desktopDir,
        });
        try {
            const win = await app.firstWindow();
            await app.evaluate(({ BrowserWindow }, [w, h]) => {
                const bw = BrowserWindow.getAllWindows()[0];
                bw.setMinimumSize(Math.min(w, 320), Math.min(h, 320));
                bw.setContentSize(w, h);
            }, [view.width, view.height]);
            await win.getByRole('button', { name: onboardingEn['onboarding.acceptAndContinue'] })
                .waitFor({ state: 'visible', timeout: 60_000 });
            await expect.poll(() => win.evaluate(() => [window.innerWidth, window.innerHeight]))
                .toEqual([view.width, view.height]);

            const m = await win.evaluate(measureLicence, onboardingEn['onboarding.licenseTerms']);
            expect(m, 'licence terms present').not.toBeNull();
            expect(m.hasParagraph, 'terms carry a first paragraph').toBe(true);

            const padStart = parseFloat(m.paddingInlineStart);
            expect(padStart, 'the terms card has inline-start padding').toBeGreaterThan(0);
            expect(parseFloat(m.paddingInlineEnd), 'the terms card has inline-end padding').toBeGreaterThan(0);
            expect(Math.abs(m.textInlineStartGap - padStart), `first paragraph starts at the card padding edge (${JSON.stringify(m)})`)
                .toBeLessThanOrEqual(TOLERANCE);

            for (const side of m.sides) {
                expect(side.width, `card outline ${side.side} width`).toBeGreaterThanOrEqual(1);
                expect(side.style, `card outline ${side.side} style`).toBe('solid');
                expect(side.color, `card outline ${side.side} uses the border token colour`).toBe(m.tokenColor);
            }

            const guard = await readNetworkGuard(app);
            expect(guard.refusals, 'no request left the machine').toEqual([]);
        } finally {
            await closeElectron(app);
        }
    });
}
