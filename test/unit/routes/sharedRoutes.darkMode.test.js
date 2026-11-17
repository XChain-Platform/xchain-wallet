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
        // Official project membership is a Details row on Token detail, not a
        // bordered notice; the shared success message keeps its own border.
        // The send warnings are the shared warning message, so theirs is the
        // warning row's.
        const detail = readFileSync('packages/core/src/shared/routes/TokenDetail.jsx', 'utf8');
        const message = readFileSync('packages/core/src/ui/StatusMessage.module.css', 'utf8');
        expect(send).not.toMatch(/^\.warnings\s*\{/m);
        // Notice Standard (2026-11-15): a warning is the red danger look.
        expect(message).toMatch(/\.row\.warning,\s*\.row\.error\s*\{[^}]*border:\s*1px solid var\(--xc-danger\)/s);
        // The small test send suggestion is the shared info message, so its
        // border is the info row's own.
        expect(send).not.toMatch(/\.testSendGate\s*\{/);
        expect(message).toMatch(/\.row\.info\s*\{[^}]*border:\s*1px solid var\(--xc-info/s);
        expect(detail).toMatch(/<DetailRow label="Projects">/);
        expect(detail).not.toMatch(/This token is an official token/);
        expect(message).toMatch(/\.row\.success\s*\{[^}]*border:\s*1px solid var\(--xc-success/s);
        expect(message).toMatch(/\.row\.success\s*\{[^}]*background:\s*var\(--xc-success-bg/s);
        for (const border of ['--xc-warning', '--xc-danger', '--xc-info', '--xc-success']) {
            expect(contrast(dark[border], dark['--xc-surface-raised']), border).toBeGreaterThanOrEqual(3);
        }
    });

    // The thread composer is one full-width kit Input with no send button
    // (2026-11-13 redesign; Enter sends). Its focus ring is the Input's
    // focus-ring halo, drawn on the raised footer surface, and the route CSS
    // must not strip it.
    it('keeps the composer focus ring above 3:1 against the surface it is drawn on', () => {
        const inbox = readFileSync('packages/core/src/shared/routes/MessagingInbox.jsx', 'utf8');
        const input = readFileSync('packages/core/src/ui/Input.module.css', 'utf8');
        const routeStyles = routeCss('MessagingInbox');
        const composer = inbox.slice(inbox.indexOf('function ThreadComposer'));
        expect(composer).toMatch(/<Input\b[^>]*className=\{local\.composerInput\}/s);
        expect(routeStyles).not.toMatch(/\.composerSend\b/);
        expect(routeStyles).not.toMatch(/\.composerInput:focus(?:-visible)?\s*\{[^}]*box-shadow:\s*none/s);
        expect(input).toMatch(/\.input:focus\s*\{[^}]*box-shadow:\s*0 0 0 3px var\(--xc-focus-ring\)/s);
        for (const theme of [light, dark]) {
            expect(contrast(theme['--xc-focus-ring'], theme['--xc-surface-raised']))
                .toBeGreaterThanOrEqual(3);
        }
    });

    it('uses the on-accent token for token hero controls and small text', () => {
        const css = routeCss('TokenDetail');
        expect(css).not.toMatch(/rgba\(255,\s*255,\s*255/);
        const heroCss = readFileSync('packages/core/src/shared/components/TotalBalanceHero.module.css', 'utf8');
        expect(heroCss).toMatch(/\.eye\s*\{[^}]*var\(--xc-on-accent\) 15%/);
        // The balance hero's code, note and hidden classes were retired with
        // the old hero; the card's icon fallback and secondary figures carry
        // the on-accent token now.
        for (const selector of ['cardCaptionIconFallback']) {
            expect(css).toMatch(new RegExp(`\\.${selector}\\s*\\{[^}]*color:\\s*var\\(--xc-on-accent\\)`, 's'));
        }
        expect(css).toMatch(/\.cardSecondary\s*\{[^}]*color:\s*color-mix\(in srgb, var\(--xc-on-accent\) 80%, transparent\)/s);
        expect(css).not.toMatch(/\.balanceHero/);
    });
});
