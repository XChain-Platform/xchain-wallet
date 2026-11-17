// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');
const css = read('packages/core/src/shared/routes/DispenserDetail.module.css');
const jsx = read('packages/core/src/shared/routes/DispenserDetail.jsx');

function rule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] || '';
}

describe('Dispenser detail wide panel layout', () => {
    it('stacks the embedded hero and tabs in one full-width fluid column', () => {
        expect(jsx).toContain('if (embedded) return page;');

        const layout = rule('.layout');
        const column = rule('.layout > .column');
        expect(css).toMatch(/\.layout,\s*\.column\s*\{[^}]*flex-direction:\s*column/s);
        expect(layout).toMatch(/width:\s*100%/);
        expect(layout).toMatch(/max-width:\s*none/);
        expect(layout).not.toMatch(/flex-flow:\s*row|grid-template-columns|column-count/);
        expect(column).toMatch(/width:\s*100%/);
        expect(column).toMatch(/max-width:\s*none/);
        expect(column).not.toMatch(/flex:\s*1\s+1|grid-column/);
    });

    it('renders the selected wide sections in identity, Buy, Details, recent order', () => {
        const embedded = /if \(embedded && !ownerAddress\) \{([\s\S]*?)\n    return wrap\(/.exec(jsx)?.[1] || '';
        const identity = embedded.indexOf('data-testid="embedded-identity"');
        const buy = embedded.indexOf('data-testid="embedded-buy"');
        const details = embedded.indexOf('data-testid="embedded-details"');
        const recent = embedded.indexOf('data-testid="embedded-recent"');

        expect(identity).toBeGreaterThan(-1);
        expect(buy).toBeGreaterThan(identity);
        expect(details).toBeGreaterThan(buy);
        expect(recent).toBeGreaterThan(details);
        expect(embedded).toContain('<h3 id="embedded-buy-title" className={local.embeddedTitle}>Buy</h3>');
        expect(embedded).toContain('<h3 id="embedded-details-title" className={local.embeddedTitle}>Details</h3>');
    });

    it('keeps the wide Details card to the approved facts and excludes address rows', () => {
        const details = /data-testid="embedded-details"([\s\S]*?)data-testid="embedded-recent"/.exec(jsx)?.[1] || '';
        const labels = [...details.matchAll(/className=\{styles\.detailsLabel\}>([^<]+)</g)]
            .map((match) => match[1]);

        expect(labels).toEqual([
            'Network',
            'Each dispense gives',
            'Price per dispense',
            'Price per token',
            'Stock',
            'In escrow',
            'Vended',
            'Status',
            'Opened',
            'Expires',
            'Allow list',
            'Block list',
        ]);
        expect(details).not.toMatch(/Seller|Source|AddressText|>Address</);
    });

    it('uses the existing buy submit and preflight path from the wide Buy box', () => {
        const buy = /data-testid="embedded-buy"([\s\S]*?)data-testid="embedded-details"/.exec(jsx)?.[1] || '';

        expect(buy).toContain('data-testid="buy-stepper"');
        expect(buy).toContain('data-testid="buy-totals"');
        expect(buy).toContain('onClick={beginBuy}');
        expect(buy.indexOf('data-testid="buy-stepper"')).toBeLessThan(buy.indexOf('data-testid="buy-totals"'));
        expect(buy).toContain('Network fee ~');
        expect(buy).not.toMatch(/shown before|priced at review/i);
        expect(jsx).toContain('const buyPreflight = useMemo');
        expect(jsx).toContain('if (!validateBuy()) return;');
    });
});
