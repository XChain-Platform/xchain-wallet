// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import betFeedsSource from '../../../packages/core/src/shared/routes/BetFeedsList.jsx?raw';
import menuSource from '../../../packages/core/src/shared/routes/MenuRoute.jsx?raw';
import stakeNewSource from '../../../packages/core/src/shared/routes/StakeNew.jsx?raw';

describe('list screen templates', () => {
    it('builds the menu and new-stake chooser on ListPage', () => {
        expect(menuSource).toMatch(/<ListPage\b/);
        expect(stakeNewSource).toMatch(/<ListPage\b/);
    });

    it('uses the shared list row for menu, stake, and betting choices', () => {
        expect(menuSource).toMatch(/className=\{rowStyles\.entry\}/);
        expect(stakeNewSource).toMatch(/className=\{styles\.entry\}/);
        expect(betFeedsSource).toMatch(/className=\{rowStyles\.entry\}/);
        expect(betFeedsSource).not.toMatch(/className=\{styles\.card\}/);
        expect(stakeNewSource).not.toMatch(/wrapFull|wrapPopup/);
    });
});
