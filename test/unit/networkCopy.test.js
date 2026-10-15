// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.


import { describe, expect, it } from 'vitest';

import { t } from '../../packages/core/src/i18n/index.js';

describe('network wording on the swap, composer and dispenser screens', () => {
    it('names the give and get sides as networks on the swap success screen', () => {
        expect(t('crossChainSwap.success.giveTxLabel')).toBe('Give network transaction');
        expect(t('crossChainSwap.success.hint')).toMatch(/give network.*get network/);
        expect(t('crossChainSwap.success.hint')).not.toMatch(/\bchain\b/i);
    });

    it('counts the composer summary in networks with correct plurals', () => {
        expect(t('parallelComposer.summary', { actions: 1, networks: 1 })).toBe('1 action across 1 network');
        expect(t('parallelComposer.summary', { actions: 3, networks: 2 })).toBe('3 actions across 2 networks');
        expect(t('parallelComposer.noRollback')).not.toMatch(/\bchains?\b/i);
    });

    it('labels the dispenser load-more button by network', () => {
        expect(t('dispenserExplorer.loadMoreFor', { name: t('send.rbf.thisChain') }))
            .toBe('Load more results for this network');
    });
});
