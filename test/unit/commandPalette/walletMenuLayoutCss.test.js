// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
    'packages/core/src/shared/commandPalette/CommandPalette.module.css',
    'utf8',
);

describe('wallet menu CSS layout contracts', () => {
    it('packs the phone groups into two independent visual columns', () => {
        expect(source).toMatch(
            /\.walletGrid\s*\{[^}]*grid-template-areas:\s*'wallet trade'\s*'wallet manage'\s*'people manage'/s,
        );
    });

    it('lets the wide menu panel use its content height up to the viewport cap', () => {
        expect(source).toMatch(
            /@container wallet-menu \(min-width: 640px\)[\s\S]*?\.panel\.menuPanel\s*\{[^}]*align-self:\s*flex-start;[^}]*block-size:\s*auto;[^}]*max-block-size:\s*calc\(/,
        );
    });

    it('uses only the shared focus-visible ring on the search box', () => {
        expect(source).toMatch(/\.input:focus\s*\{[^}]*box-shadow:\s*none;/s);
        expect(source).not.toMatch(/\.input:focus\s*\{[^}]*0 0 0 3px var\(--xc-focus-ring\)/s);
    });
});
