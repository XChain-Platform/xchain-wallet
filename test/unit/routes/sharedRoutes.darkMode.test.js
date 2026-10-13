// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const routeCss = (name) => readFileSync(`packages/core/src/shared/routes/${name}.module.css`, 'utf8');
const tokensCss = readFileSync('packages/core/src/ui/tokens.css', 'utf8');

function declarationsFor(pattern) {
    const body = pattern.exec(tokensCss)?.[1];
    expect(body, pattern.source).toBeTruthy();
    return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)]
        .map(([, name, value]) => [name, value.trim()]));
}

const light = declarationsFor(/^:root\s*\{([\s\S]*?)^\}/m);
const dark = {
    ...light,
    ...declarationsFor(/^:root\[data-xc-theme="dark"\]\s*\{([\s\S]*?)^\}/m),
};

function rgb(value) {
    const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
    expect(match, value).toBeTruthy();
    return match.slice(1).map((channel) => Number.parseInt(channel, 16));
}

function luminance(value) {
    return rgb(value)
        .map((channel) => channel / 255)
        .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(first, second) {
    const values = [luminance(first), luminance(second)];
    return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

describe('shared route dark-mode colors', () => {
    it('uses adaptive semantic fills for dispenser lifecycle states', () => {
        const css = routeCss('DispensersList');
        expect(css).toMatch(/\.status_open\s*\{[^}]*background:\s*var\(--xc-success-bg\)/s);
        expect(css).toMatch(/\.status_canceled,[\s\S]*?background:\s*var\(--xc-danger-bg\)/);
        expect(css).toMatch(/\.status_cancelling\s*\{[^}]*background:\s*var\(--xc-warning-bg\)/s);
        expect(css).not.toMatch(/background:\s*rgba\((?:34, 197, 94|220, 38, 38|234, 179, 8)/);
    });

    it('keeps warning, send-gate, and official-region borders visible in dark mode', () => {
        const send = routeCss('Send');
        const detail = routeCss('TokenDetail');
        expect(send).toMatch(/\.warnings\s*\{[^}]*border:\s*1px solid var\(--xc-warning\)/s);
        expect(send).toMatch(/\.testSendGate\s*\{[^}]*border:\s*1px solid var\(--xc-accent-primary\)/s);
        expect(detail).toMatch(/\.officialBanner\s*\{[^}]*border:\s*1px solid var\(--xc-success\)/s);
        expect(detail).toMatch(/\.officialBanner\s*\{[^}]*background:\s*var\(--xc-success-bg\)/s);
        for (const border of ['--xc-warning', '--xc-accent-primary', '--xc-success']) {
            expect(contrast(dark[border], dark['--xc-surface-raised']), border).toBeGreaterThanOrEqual(3);
        }
    });

    it('keeps the composer focus ring above 3:1 on its hover fill', () => {
        const css = routeCss('MessagingInbox');
        expect(css).toMatch(/\.composerSend\s*\{[^}]*--xc-focus-ring:\s*var\(--xc-on-accent\)/s);
        for (const theme of [light, dark]) {
            expect(contrast(theme['--xc-on-accent'], theme['--xc-accent-primary-hover']))
                .toBeGreaterThanOrEqual(3);
        }
    });

    it('uses the on-accent token for token hero controls and small text', () => {
        const css = routeCss('TokenDetail');
        expect(css).not.toMatch(/rgba\(255,\s*255,\s*255/);
        expect(css).toMatch(/\.balanceHeroSwap,[\s\S]*?var\(--xc-on-accent\) 15%/);
        for (const selector of ['balanceHeroAmountCode', 'balanceHeroNoteCode', 'balanceHeroHidden']) {
            expect(css).toMatch(new RegExp(`\\.${selector}\\s*\\{[^}]*color:\\s*var\\(--xc-on-accent\\)`, 's'));
        }
    });
});
