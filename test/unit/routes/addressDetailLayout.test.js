// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Layout guards for the View Address screen (AddressDetail, approved Layout 1).
// jsdom lays nothing out, so these read the stylesheet rules the layout rests on.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');
const css = read('packages/core/src/shared/routes/AddressDetail.module.css');
const listCss = read('packages/core/src/shared/routes/AddressList.module.css');

function rule(selector, source = css) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(source)?.[1] || '';
}

describe('View Address identity card', () => {
    it('centres the network icon and the QR as a pair, 8px apart, in fixed boxes', () => {
        const pair = rule('.pair');
        expect(pair).toMatch(/display:\s*flex/);
        expect(pair).toMatch(/justify-content:\s*center/);
        expect(pair).toMatch(/gap:\s*var\(--xc-space-2\)/);
        expect(rule('.qr')).toMatch(/flex:\s*0 0 auto/);
        expect(rule('.qr')).toMatch(/block-size:/);
        expect(rule('.networkIcon')).toMatch(/flex:\s*0 0 auto/);
    });

    it('gives the address row the card width, so the fit cut measures the room beside the copy icon', () => {
        const row = rule('.addressRow');
        expect(row).toMatch(/display:\s*flex/);
        expect(row).toMatch(/justify-content:\s*center/);
        expect(row).toMatch(/inline-size:\s*100%/);
        expect(row).toMatch(/gap:\s*var\(--xc-space-2\)/);
        expect(row).not.toMatch(/flex-wrap:\s*wrap/);
        expect(rule('.addressText')).toMatch(/min-inline-size:\s*0/);
        expect(rule('.copy')).toMatch(/flex:\s*0 0 auto/);
        expect(rule('.card.card')).toMatch(/align-items:\s*stretch/);
    });

    it('leaves the panel spacing to the shared Actions | Details toggle (G102)', () => {
        const jsx = read('packages/core/src/shared/routes/AddressDetail.jsx');
        const toggleCss = read('packages/core/src/shared/components/ActionsDetailsToggle.module.css');
        expect(jsx).toMatch(/<ActionsDetailsToggle\b/);
        expect(rule('.panel')).toBe('');
        expect(rule('.panel', toggleCss)).toMatch(/gap:\s*var\(--xc-space-2\)/);
    });
});

describe('Old View Address pieces are gone', () => {
    it('drops the inline label editor, copy row and small quick actions from the list sheet', () => {
        for (const selector of ['.labelRow', '.detailAddr', '.quickActions', '.quickAction', '.tabPanel', '.detailTop']) {
            expect(rule(selector, listCss)).toBe('');
        }
    });
});
