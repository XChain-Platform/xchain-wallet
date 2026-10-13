// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pin that market and contract load failures say what did not load, in the read
// voice, with no explorer request URL and no function-prefixed precondition text;
// plain copy a flow wrote for a person still passes through.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { render, act as domAct } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OrderbookPanel } from '../../../packages/core/src/shared/components/OrderbookPanel.jsx';
import { readFailureMessage } from '../../../packages/core/src/shared/utils/readFailureMessage.js';

/** An SDK explorer failure as it arrives after the messaging boundary. */
function explorerError(message) {
    const err = new Error(message);
    err.name = 'SDKExplorerError';
    return err;
}

describe('readFailureMessage', () => {
    it('turns an explorer 502 into a read sentence with no request URL', () => {
        const text = readFailureMessage(explorerError('Explorer returned HTTP 502 for /RBTC/api/orderbook?x=1'), 'load the order book');
        expect(text).toMatch(/^Couldn't load the order book\. /);
        expect(text).toContain('temporarily unavailable (error 502)');
        expect(text).not.toContain('/RBTC/api/');
        expect(text).not.toContain('nothing was spent');
    });

    it('explains a timed-out read as the service being slow', () => {
        const text = readFailureMessage(explorerError('Explorer request timed out: /RBTC/api/matches'), 'load recent trades');
        expect(text).toContain('did not answer in time');
        expect(text).not.toContain('Check your connection');
        expect(text).not.toContain('/RBTC/api/');
    });

    it('replaces a function-prefixed precondition with a generic sentence', () => {
        expect(readFailureMessage(new Error('getOrderbook: tick1 is required'), 'load the order book'))
            .toBe("Couldn't load the order book. Something went wrong. Try again.");
    });

    it('keeps plain text a flow wrote for a person', () => {
        expect(readFailureMessage(new Error('some other fault'), 'load the order book'))
            .toBe("Couldn't load the order book. some other fault");
    });
});

describe('the order book panel on a failed load', () => {
    it('shows the read sentence, not the explorer URL', async () => {
        const messaging = {
            getOrderbook: () => Promise.reject(explorerError('Explorer returned HTTP 502 for /RBTC/api/orderbook/XCHAIN/BTC')),
        };
        let utils;
        await domAct(async () => {
            utils = render(React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(OrderbookPanel, { chainId: 'bitcoin-mainnet', tick1: 'XCHAIN', tick2: 'BTC' }),
            ));
            for (let i = 0; i < 16; i += 1) await Promise.resolve();
        });
        const shown = utils.container.textContent || '';
        expect(shown).toContain("Couldn't load the order book.");
        expect(shown).not.toContain('/RBTC/api/');
        expect(shown).not.toContain('Explorer returned');
        utils.unmount();
    });
});

describe('market and contract screens route every load failure through it', () => {
    const FILES = [
        'packages/core/src/shared/components/OrderbookPanel.jsx',
        'packages/core/src/shared/components/OpenOrdersPanel.jsx',
        'packages/core/src/shared/components/RecentTradesPanel.jsx',
        'packages/core/src/shared/components/TradeHistoryPanel.jsx',
        'packages/core/src/shared/components/MarketChart.jsx',
        'packages/core/src/shared/routes/MarketView.jsx',
        'packages/core/src/shared/routes/ContractDetail.jsx',
    ];

    it.each(FILES)('%s shows no raw error message', (rel) => {
        // Resolved from the vitest root: import.meta.url is an http URL under jsdom.
        const src = readFileSync(join(process.cwd(), rel), 'utf8');
        expect(src).not.toMatch(/\?\.message \|\| String\((?:e|err)\)/);
        expect(src).toContain('readFailureMessage(');
    });
});

describe('token, dispenser and stake screens word explorer load failures through it', () => {
    // Each pattern is the raw explorer-read fallback that used to reach the screen.
    const SITES = [
        ['packages/core/src/shared/routes/TokenDetail.jsx', /set(?:Holders|Gated)Error\(err\?\.message/],
        ['packages/core/src/shared/routes/ManageToken.jsx', /set(?:Holders|Listings|Orders|Swaps|Activity)Error\(err\?\.message/],
        ['packages/core/src/shared/routes/DispenserDetail.jsx', /setLoadError\(err\?\.message/],
        ['packages/core/src/shared/routes/StakeDetail.jsx', /setLoadError\(err\?\.message/],
        ['packages/core/src/shared/routes/DividendForm.jsx', /error: err\?\.message \|\| 'Failed to load holders\.'/],
    ];

    it.each(SITES)('%s shows no raw explorer error', (rel, rawFallback) => {
        const src = readFileSync(join(process.cwd(), rel), 'utf8');
        expect(src).not.toMatch(rawFallback);
        expect(src).toContain('readFailureMessage(');
    });
});
