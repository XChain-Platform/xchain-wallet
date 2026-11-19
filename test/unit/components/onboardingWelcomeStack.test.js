// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('packages/core/src/shared/routes/Onboarding.module.css', 'utf8');
const source = readFileSync('packages/core/src/shared/routes/Onboarding.jsx', 'utf8');

// Lists every style rule with the @media condition it sits in, so a check can
// tell a base rule from one scoped to a short viewport.
function rules(text) {
    const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '');
    const found = [];
    const stack = [];
    let start = 0;
    for (let i = 0; i < stripped.length; i += 1) {
        const ch = stripped[i];
        if (ch === '{') {
            const prelude = stripped.slice(start, i).trim();
            const media = stack.filter((entry) => entry.startsWith('@media'));
            if (prelude.startsWith('@')) {
                stack.push(prelude);
            } else {
                const end = stripped.indexOf('}', i);
                found.push({ selector: prelude, body: stripped.slice(i + 1, end), media });
                i = end;
            }
            start = i + 1;
        } else if (ch === '}') {
            stack.pop();
            start = i + 1;
        }
    }
    return found;
}

const all = rules(css);
const selects = (rule, name) => rule.selector.split(',').map((s) => s.trim()).includes(name);

describe('Welcome stack', () => {
    it('stacks the logo above the tagline in one centred column', () => {
        const base = all.filter((rule) => rule.media.length === 0 && selects(rule, '.welcomeHeader'));
        expect(base).toHaveLength(1);
        const body = base[0].body;
        expect(body).toMatch(/display:\s*flex;/);
        expect(body).toMatch(/flex-direction:\s*column;/);
        expect(body).toMatch(/align-items:\s*center;/);
        expect(body).toMatch(/text-align:\s*center;/);
    });

    it('keeps a row layout for the brand only inside a short-viewport media block', () => {
        const rows = all.filter((rule) => /\.welcomeHeader\b/.test(rule.selector) && /flex-direction:\s*row/.test(rule.body));
        for (const rule of rows) {
            expect(rule.media.some((m) => /max-height/.test(m))).toBe(true);
        }
    });

    it('keeps the logo at its full artwork width on the welcome screen', () => {
        expect(css).not.toMatch(/min\(\s*40%\s*,\s*140px\s*\)/);
        const capped = all.filter((rule) => /\.welcomeHeader\s*>\s*\.logo(?:Popup|Full)/.test(rule.selector)
            && /(?:^|[;\s])width:/.test(rule.body));
        expect(capped).toEqual([]);
        const logoFull = all.find((rule) => rule.media.length === 0 && selects(rule, '.logoFull') && /width:/.test(rule.body));
        const logoPopup = all.find((rule) => rule.media.length === 0 && selects(rule, '.logoPopup') && /width:/.test(rule.body));
        expect(logoFull.body).toMatch(/width:\s*240px;/);
        expect(logoPopup.body).toMatch(/width:\s*140px;/);
    });

    it('has no app header or page header: the body shows the logo and tagline', () => {
        const block = source.slice(source.indexOf('data-onboarding-welcome-header=""'));
        const welcome = block.slice(0, block.indexOf('status='));
        expect(source).toMatch(/<Screen\s+variant=\{variant\}\s+header=\{header\}\s+bodyClassName=\{header \? undefined : styles\.wideCentre\}\s*>\s*<FormPage\s+label=\{t\('onboarding\.walletSetup'\)\}\s+className=\{header \? undefined : styles\.welcomeForm\}/);
        expect(source).not.toMatch(/<BootFrame>\{null\}<\/BootFrame>/);
        expect(source).not.toMatch(/firstRunFrame\(branding\.PRODUCT_NAME\)/);
        expect(welcome.indexOf('styles.welcomeLogo')).toBeGreaterThan(-1);
        expect(welcome).not.toContain('styles.welcomeTitle');
        expect(welcome).toMatch(/<h1 className="sr-only">\{branding\.PRODUCT_NAME\}<\/h1>/);
        expect(welcome.indexOf('styles.welcomeTagline')).toBeGreaterThan(welcome.indexOf('<h1 className="sr-only">'));
        expect(welcome).toContain("t('onboarding.welcomeTagline')");
    });

    it('centres the uncarded narrow welcome group', () => {
        const form = all.find((rule) => rule.media.length === 0 && selects(rule, 'form.welcomeForm'));
        expect(form.body).toMatch(/justify-content:\s*center;/);
        expect(form.body).toMatch(/min-height:\s*100%;/);
        expect(form.body).toMatch(/margin:\s*0 auto;/);
        const logo = all.find((rule) => rule.media.length === 0 && selects(rule, '.welcomeLogo'));
        expect(logo.body).toMatch(/width:\s*140px;/);
        const header = all.find((rule) => rule.media.length === 0 && selects(rule, '.welcomeHeader'));
        expect(header.body).toMatch(/gap:\s*var\(--xc-space-2\);/);
    });

    it('centres welcome and carousel content from 600px without stretching either card', () => {
        const isWide = (rule) => rule.media.some((m) => /min-width:\s*600px/.test(m));
        const centre = all.find((rule) => isWide(rule)
            && selects(rule, '.wideCentre.wideCentre.wideCentre'));
        const centredChild = all.find((rule) => isWide(rule)
            && selects(rule, '.wideCentre.wideCentre.wideCentre > *'));
        expect(centre.body).toMatch(/display:\s*flex;/);
        expect(centre.body).toMatch(/flex-direction:\s*column;/);
        expect(centredChild.body).toMatch(/margin-block:\s*auto;/);

        const welcome = all.find((rule) => isWide(rule) && selects(rule, 'form.welcomeForm'));
        expect(welcome.body).toMatch(/min-height:\s*auto;/);
        expect(welcome.body).not.toMatch(/(?:^|;)\s*height:|(?:^|;)\s*flex(?:-grow)?:/);

        const carousel = all.find((rule) => isWide(rule) && selects(rule, 'div.carouselForm'));
        const carouselStack = all.find((rule) => isWide(rule)
            && selects(rule, 'div.carouselForm > [data-form-stack]'));
        expect(carousel.body).toMatch(/height:\s*auto;/);
        expect(carouselStack.body).toMatch(/flex:\s*0 1 auto;/);
        expect(source).toMatch(/header=\{null\} bodyClassName=\{styles\.wideCentre\}>\s*<FormPage[\s\S]*?className=\{styles\.carouselForm\}/);
    });
});
