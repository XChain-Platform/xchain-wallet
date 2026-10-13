// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import { chooseFirstOfferedToken, reachKnownScreen } from '../../e2e/layout/crawl.js';

describe('click crawler form and screen helpers', () => {
    it('opens an empty token field and chooses the first offered balance', async () => {
        const tokenClick = vi.fn().mockResolvedValue(undefined);
        const rowClick = vi.fn().mockResolvedValue(undefined);
        const field = {
            count: vi.fn().mockResolvedValue(1),
            first: vi.fn().mockReturnThis(),
            getAttribute: vi.fn().mockResolvedValue('Token to drop: Select a token'),
            click: tokenClick,
        };
        const form = { locator: vi.fn().mockReturnValue(field) };
        const forms = {
            count: vi.fn().mockResolvedValue(1),
            nth: vi.fn().mockReturnValue(form),
        };
        const row = { first: vi.fn().mockReturnThis(), click: rowClick };
        const list = { getByRole: vi.fn().mockReturnValue(row) };
        const page = {
            locator: vi.fn().mockReturnValue(forms),
            getByRole: vi.fn().mockReturnValue(list),
        };

        await expect(chooseFirstOfferedToken(page, 0))
            .resolves.toBe('Token to drop: Select a token');
        expect(form.locator).toHaveBeenCalledWith('button[aria-label$=": Select a token"]');
        expect(tokenClick).toHaveBeenCalledWith({ timeout: 3_000 });
        expect(list.getByRole).toHaveBeenCalledWith('listitem');
        expect(rowClick).toHaveBeenCalledWith({ timeout: 10_000 });
    });

    it('keeps the default Home-first route and opts desktop into cheap re-entry', async () => {
        const home = vi.fn().mockResolvedValue(undefined);
        const open = vi.fn().mockResolvedValue(undefined);
        const reopen = vi.fn().mockResolvedValue(undefined);
        const settle = vi.fn().mockResolvedValue(undefined);
        const screen = { open, reopen };

        await reachKnownScreen(screen, {
            reentry: true,
            directReentry: false,
            home,
            settle,
        });
        expect(home).toHaveBeenCalledOnce();
        expect(open).toHaveBeenCalledOnce();
        expect(reopen).not.toHaveBeenCalled();
        expect(settle).toHaveBeenLastCalledWith(500);

        vi.clearAllMocks();
        await reachKnownScreen(screen, {
            reentry: true,
            directReentry: true,
            home,
            settle,
        });
        expect(home).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
        expect(reopen).toHaveBeenCalledOnce();
        expect(settle).toHaveBeenLastCalledWith(100);
    });
});
