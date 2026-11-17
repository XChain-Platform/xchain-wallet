// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ControllerBindForm } from '../../../packages/core/src/shared/routes/ControllerBindForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const CSS = readFileSync(
    join(process.cwd(), 'packages', 'core', 'src', 'shared', 'routes', 'IssueTokenForm.module.css'),
    'utf8',
);

// The Action class grid: full-width rows on narrow screens, two columns from
// the standard 600px form breakpoint, and one help tip on the group only.
describe('Controller bind Action class grid', () => {
    afterEach(() => cleanup());

    it('uses full-width rows by default and never auto-fill', () => {
        const block = CSS.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.roundedFieldset\s*\{[^}]*\}/)?.[0] ?? '';
        expect(block).toMatch(/display:\s*grid/);
        expect(block).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
        expect(block).not.toMatch(/auto-fill|auto-fit/);
    });

    it('uses two equal columns from the 600px form breakpoint', () => {
        const media = [...CSS.matchAll(/@media[^{]*\{(?:[^{}]|\{[^}]*\})*\}/g)]
            .map((match) => match[0])
            .filter((block) => block.includes('.roundedFieldset'));
        expect(media).toHaveLength(1);
        expect(media[0]).toMatch(/@media\s*\(min-width:\s*600px\)/);
        expect(media[0]).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    });

    it('keeps the Checkbox grid and its label on one line', () => {
        const source = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
        const row = source.match(/\.checkRow\.checkRow\s*\{[^}]*\}/)?.[0] ?? '';
        const label = source.match(/\.actionClassLabel\s*\{[^}]*\}/)?.[0] ?? '';
        expect(row).toMatch(/display:\s*grid/);
        expect(row).toMatch(/grid-template-columns:\s*var\(--xc-control-icon-md,[^;]+minmax\(0,\s*1fr\)/);
        expect(row).toMatch(/width:\s*100%/);
        expect(label).toMatch(/white-space:\s*nowrap/);
    });

    it('keeps one help tip on the group label and none on the items', async () => {
        const messaging = new Proxy({
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{ id: 'a1', address: 'bc1qdevmock02aabbcc', publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' }],
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getControllerActionClasses: vi.fn().mockResolvedValue({
                actionClasses: ['transfer', 'trade', 'burn', 'mint', 'stake', 'ownership', 'all'],
            }),
        }, {
            get(object, property) {
                if (property in object) return object[property];
                return vi.fn().mockResolvedValue({});
            },
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ControllerBindForm walletId="wallet-1" chainId={CHAIN} onBack={() => {}} />
            </MessagingProvider>,
        );
        const group = (await screen.findByRole('group', { name: /Action class/ }));
        expect(await screen.findByLabelText('ownership')).toBeTruthy();
        expect(group.querySelectorAll('input[type="checkbox"]').length).toBe(7);
        const tips = [...group.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
        expect(tips).toEqual(['About Action class']);
    });
});
