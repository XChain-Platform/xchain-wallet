// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Operator ruling 2026-11-14: every "View on <explorer>" row shows that
// site's own bundled logo, so people click what they recognise. The logo
// files ship in the wallet (no remote image loads) and each source URL is
// recorded beside the file list in branding.js.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ActionDetail } from '../../../packages/core/src/shared/routes/ActionDetail.jsx';
import {
    EXPLORER_LOGO_FILES,
    explorerLogoUrl,
} from '../../../packages/core/src/branding/branding.js';

const CHAIN = 'bitcoin-mainnet';
const OURS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const THEIRS = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const TX_HASH = 'aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899';

function renderDetail() {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        getActionByIndex: vi.fn().mockResolvedValue(null),
        verifyAction: vi.fn().mockResolvedValue({ status: 'verified', reason: null }),
    };
    const entry = {
        key: `${CHAIN}:1255:${OURS}`,
        chainId: CHAIN,
        address: OURS,
        actionIndex: '1255',
        action: 'SEND',
        blockIndex: 7707,
        timestamp: Date.now() - 10000,
        txHash: TX_HASH,
        source: THEIRS,
        raw: { source: THEIRS, destination: OURS },
        link: null,
    };
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(ActionDetail, { entry, walletId: 'w1', onBack: () => {} }),
        ),
    );
}

afterEach(() => { cleanup(); });

describe('explorer row logos', () => {
    it('ships a bundled file for every explorer the wallet links to', () => {
        for (const [id, file] of Object.entries(EXPLORER_LOGO_FILES)) {
            expect(existsSync(`packages/core/src/branding/images/${file}`), id).toBe(true);
            expect(explorerLogoUrl(id)).toMatch(/\/[^/]+\.png$/);
        }
        expect(explorerLogoUrl('nonexistent')).toBeNull();
        expect(explorerLogoUrl('__proto__')).toBeNull();
    });

    it('records the source of every third-party logo in branding.js', () => {
        const source = readFileSync('packages/core/src/branding/branding.js', 'utf8');
        for (const id of ['mempool', 'blockstream', 'litecoinspace', 'blockchair', 'blockcypher']) {
            expect(source, id).toMatch(new RegExp(`${id}\\s+https://`));
        }
    });

    it('draws each Action detail explorer row with its own logo and no remote image', () => {
        const { container } = renderDetail();
        fireEvent.click(screen.getByRole('tab', { name: 'Actions' }));
        const rows = screen.getAllByRole('link', { name: /^View on/ });
        const expected = ['xchain', 'mempool', 'blockstream'];
        expect(rows).toHaveLength(expected.length);
        rows.forEach((row, index) => {
            const logo = row.querySelector('img[data-explorer-logo]');
            expect(logo, row.textContent).toBeTruthy();
            expect(logo.getAttribute('data-explorer-logo')).toBe(expected[index]);
            expect(logo.getAttribute('src')).toBe(explorerLogoUrl(expected[index]));
            expect(logo.getAttribute('src')).not.toMatch(/^https?:\/\//);
        });
        expect(within(container).queryAllByRole('img', { hidden: true }).every(
            (img) => !/^https?:\/\//.test(img.getAttribute('src') || ''),
        )).toBe(true);
    });
});
