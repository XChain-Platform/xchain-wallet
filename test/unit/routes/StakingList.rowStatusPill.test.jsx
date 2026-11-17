// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Staking rows stay three lines at most on narrow windows: the status pill
// sits at the end of the amount line, the amount truncates before the pill
// can wrap, and no phone rule drops the pill to its own line.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakingList } from '../../../packages/core/src/shared/routes/StakingList.jsx';

const css = readFileSync(join(process.cwd(), 'packages/core/src/shared/routes/StakingList.module.css'), 'utf8');
const CHAIN = 'bitcoin-mainnet';
const ONE = 'bc1qoneoneoneoneoneoneoneoneoneoneoneone';

afterEach(cleanup);

function cssRule(selector) {
    const m = css.match(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
    return m ? m[1] : '';
}

describe('Staking row status pill', () => {
    it('renders the pill beside the amount on line two, before the owner line', async () => {
        const read = (map) => vi.fn(async ({ address }) => map[address] || []);
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ id: 'a1', address: ONE }] }),
            getStakesForAddress: read({ [ONE]: [{ stake_id: 's1', amount: '10', status: 'active', block_index: 9 }] }),
            getDelegationsForAddress: read({}),
            getRewardsForAddress: read({}),
            getRewardClaimsForAddress: read({}),
            getContractStakesForAddress: read({}),
            getContractUnstakesForAddress: read({}),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <StakingList walletId="w" onOpenStake={vi.fn()} onBack={vi.fn()} />
            </MessagingProvider>,
        );
        const row = await screen.findByRole('button', { name: /^Open Validator stake/ });
        const pill = within(row).getByText('Active');
        const line = pill.parentElement;
        expect(line.children.length).toBe(2);
        expect(line.children[0].textContent).toMatch(/10 XCHAIN/);
        expect(line.children[1]).toBe(pill);
        // The owner is the third line, and the pill is no longer in a trailing column.
        expect(line.nextElementSibling.textContent).toMatch(/bc1qon/);
        expect(pill.closest('[class*="trailing"]')).toBeNull();
    });

    // A locked stake that is owed rewards: amount, period, reward chip and pill together.
    function fullRowMessaging() {
        const read = (map) => vi.fn(async ({ address }) => map[address] || []);
        return {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ id: 'a1', address: ONE }] }),
            getStakesForAddress: read({
                [ONE]: [{ stake_id: 's1', amount: '1234567.89', status: 'active', block_index: 9, activation_block: 500 }],
            }),
            getDelegationsForAddress: read({}),
            getRewardsForAddress: read({ [ONE]: [{ id: 1, amount: '5' }] }),
            getRewardClaimsForAddress: read({}),
            getContractStakesForAddress: read({}),
            getContractUnstakesForAddress: read({}),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        };
    }

    it('keeps the amount, period, reward chip and pill all on line two, with no fourth line', async () => {
        render(
            <MessagingProvider shell="web" messaging={fullRowMessaging()}>
                <StakingList walletId="w" onOpenStake={vi.fn()} onBack={vi.fn()} />
            </MessagingProvider>,
        );
        const row = await screen.findByRole('button', { name: /^Open Validator stake/ });
        const chip = within(row).getByText(/reward$/);
        const pill = within(row).getByText('Locked');
        const line = pill.parentElement;
        expect(chip.parentElement).toBe(line);
        // Text (amount and period), chip, pill: one flex line.
        expect(line.children.length).toBe(3);
        expect(line.children[0].textContent).toMatch(/1,234,567\.89 XCHAIN/);
        expect(line.children[1]).toBe(chip);
        expect(line.children[2]).toBe(pill);
        const body = line.parentElement;
        // Name, line two, owner: three children, nothing after them in the row but the chevron.
        expect(body.children.length).toBe(3);
        expect(row.querySelector('[class*="trailing"]')).toBeNull();
    });

    it('lays that row out on three lines at 360 px wide', async (ctx) => {
        let browser;
        try {
            const { chromium } = await import('playwright');
            browser = await chromium.launch();
        } catch {
            return ctx.skip();
        }
        try {
            render(
                <MessagingProvider shell="web" messaging={fullRowMessaging()}>
                    <StakingList walletId="w" onOpenStake={vi.fn()} onBack={vi.fn()} />
                </MessagingProvider>,
            );
            const row = await screen.findByRole('button', { name: /^Open Validator stake/ });
            const item = row.closest('[role="listitem"]');
            // Re-key the real stylesheet to the hashed class names the render used
            // (`_key_hash`), read off the rendered row itself.
            let sheet = css.replace(/composes:[^;]*;/g, '');
            const tokens = new Set();
            for (const el of [item, ...item.querySelectorAll('[class]')]) {
                for (const token of String(el.getAttribute('class')).split(/\s+/)) {
                    if (/^_\w+_[0-9a-f]{6}$/.test(token)) tokens.add(token);
                }
            }
            for (const token of tokens) {
                sheet = sheet.replace(new RegExp(`\\.${token.slice(1, -7)}(?![\\w-])`, 'g'), `.${token}`);
            }
            const page = await browser.newPage({ viewport: { width: 360, height: 400 } });
            await page.setContent(`<!doctype html><html><head><style>
                body { margin: 0; font: 16px/1.4 sans-serif;
                    --xc-control-h-md: 44px; --xc-control-h-lg: 48px; --xc-space-1: 4px;
                    --xc-space-2: 8px; --xc-space-3: 12px; --xc-text-xs: 12px; --xc-text-sm: 14px; }
                ${sheet}
            </style></head><body><div style="width:360px">${item.outerHTML}</div></body></html>`);
            const m = await page.evaluate(() => {
                const rowEl = document.querySelector('button');
                const body = rowEl.children[1];
                const lineEl = body.children[1];
                const pill = lineEl.lastElementChild;
                const l = lineEl.getBoundingClientRect();
                const p = pill.getBoundingClientRect();
                const r = rowEl.getBoundingClientRect();
                return {
                    lineHeight: l.height, pillHeight: p.height, pillRight: p.right, rowRight: r.right,
                    pillWithinLine: p.top >= l.top - 0.5 && p.bottom <= l.bottom + 0.5,
                    bodyChildren: body.children.length,
                    bodyHeight: body.getBoundingClientRect().height,
                };
            });
            expect(m.pillWithinLine).toBe(true);
            expect(m.pillRight).toBeLessThanOrEqual(m.rowRight);
            // Line two is a single line: no taller than the pill plus a hair.
            expect(m.lineHeight).toBeLessThanOrEqual(m.pillHeight + 2);
            expect(m.bodyChildren).toBe(3);
            // Three lines of 16px/1.4 text with their gaps stay under a fourth line's height.
            expect(m.bodyHeight).toBeLessThan(3 * 22.4 + 4 * 22.4 / 2);
        } finally {
            await browser.close();
        }
    });

    it('the status line is nowrap; the amount truncates with min-width 0; the pill never shrinks', () => {
        const line = cssRule('.statusLine');
        expect(line).toMatch(/display:\s*flex/);
        expect(line).toMatch(/flex-wrap:\s*nowrap/);
        expect(line).toMatch(/min-width:\s*0/);
        expect(cssRule('.statusLineText')).toMatch(/min-width:\s*0/);
        const sub = cssRule('.subtitle');
        expect(sub).toMatch(/text-overflow:\s*ellipsis/);
        expect(sub).toMatch(/white-space:\s*nowrap/);
        expect(sub).toMatch(/overflow:\s*hidden/);
        const status = cssRule('.status');
        expect(status).toMatch(/flex:\s*0 0 auto/);
        expect(status).toMatch(/white-space:\s*nowrap/);
    });

    it('no phone rule lets the name or amount wrap or moves the pill to its own line', () => {
        const phone = css.slice(css.indexOf('@media not all and (min-width: 400px)'));
        expect(phone).not.toMatch(/\.(name|subtitle)\b[^{]*\{[^}]*white-space:\s*normal/);
        expect(phone).not.toMatch(/\.status\b/);
    });
});
