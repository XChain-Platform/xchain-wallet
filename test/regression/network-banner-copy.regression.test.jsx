// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: non-mainnet network banner copy and alignment.
//
//   [P1] 2026-10-13: Testnet and regtest banners keep a readable separator
//        and share the compact page gutter instead of touching the edge.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NetworkBanner } from '../../packages/core/src/shared/components/NetworkBanner.jsx';

afterEach(cleanup);

describe('regression/network-banner-copy', () => {
    it.each([
        ['testnet', 'Testnet'],
        ['regtest', 'Regtest'],
    ])('[REGRESSION P1] reads %s and Not mainnet with spaces around the dot', (activeNetwork, label) => {
        render(<NetworkBanner activeNetwork={activeNetwork} />);

        const banner = screen.getByRole('status');
        expect(banner.textContent).toBe(`${label} · Not mainnet`);
        expect(banner.querySelector('[aria-hidden="true"]')?.textContent).toBe(' · ');
    });

    it('[REGRESSION P1] aligns the banner inset with the compact page gutter', () => {
        render(<NetworkBanner activeNetwork="testnet" />);

        expect(screen.getByRole('status')).toHaveStyle({
            padding: '3px var(--xc-space-3, 12px)',
        });

        const tokens = readFileSync(join(
            process.cwd(),
            'packages/core/src/ui/tokens.css',
        ), 'utf8');
        expect(tokens).toMatch(/--xc-page-gutter:\s*var\(--xc-space-3\)/);
    });
});
