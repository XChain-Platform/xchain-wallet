// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A market that will not load says so in the wallet's voice, not the
// explorer's.
//
// `messaging.betFeed` forwards the SDK explorer client's own error, which is
// written for a log and names the HTTP status and the request URL:
//
//   Explorer returned HTTP 502 for /RBTC/api/betfeeds?index=1169
//
// Both load paths in BetFeedDetail copied `err.message` straight into the
// error banner, so that string was the screen a bettor met. It also has to
// stay a READ sentence: explorerReadFailure deliberately omits the "nothing
// was signed or sent" line the submit copy carries, because someone who was
// only LOOKING at a market never started a transaction to be reassured about.
//
// Both the mount effect and the post-bet `reload` are pinned, because they are
// two catches and a form swept on one and not the other still ships wire
// wording on the other.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, act as domAct } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const RAW_502 = 'Explorer returned HTTP 502 for /RBTC/api/betfeeds?index=1169';

const FEED = Object.freeze({
    action_index: '1169',
    source: 'bc1qoracleoracleoracleoracleoracleoraclex',
    label: 'Will it ship?',
    outcomes: 'Yes,No',
    tick: 'XCHAIN',
    fee: '0',
    deadline: Math.floor(Date.now() / 1000) + 86400,
    expire_at: Math.floor(Date.now() / 1000) + 172800,
    feed_status: 'open',
    pools: [],
    timeline: [{ status: 'open', block_index: 4217 }],
});

/** An SDK explorer failure as it arrives after the messaging boundary. */
function explorerError(message) {
    const err = new Error(message);
    err.name = 'SDKExplorerError';
    return err;
}

function harness(betFeed) {
    const target = { betFeed, bets: () => Promise.resolve({ data: [] }) };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
}

const drain = async (rounds = 16) => {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

async function openMarket(messaging) {
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(BetFeedDetail, {
                    walletId: 'w', chainId: CHAIN, feedIndex: '1169', onBack() {},
                }),
            ),
        );
        await drain();
    });
    return utils;
}

describe('BetFeedDetail: a failed market load', () => {
    it('does not put the explorer HTTP status and request URL on screen', async () => {
        const utils = await openMarket(harness(() => Promise.reject(explorerError(RAW_502))));
        const shown = utils.container.textContent || '';
        expect(shown).not.toContain(RAW_502);
        expect(shown).not.toContain('/RBTC/api/');
        expect(shown).toContain("Couldn't load this market.");
        expect(shown).toContain('temporarily unavailable (error 502)');
    });

    it('keeps the read voice: a reader was never told a transaction was at risk', async () => {
        const utils = await openMarket(harness(() => Promise.reject(explorerError(RAW_502))));
        // explorerReadFailure's whole reason for existing beside the submit
        // mapper: this sentence answers a question a reader did not ask.
        expect(utils.container.textContent || '').not.toContain('nothing was spent');
    });

    it('explains a timed-out read as the service being slow, not the user being offline', async () => {
        const utils = await openMarket(harness(
            () => Promise.reject(explorerError('Explorer request timed out: /RBTC/api/betfeeds?index=1169')),
        ));
        const shown = utils.container.textContent || '';
        expect(shown).toContain('did not answer in time');
        expect(shown).not.toContain('Check your connection');
    });

    it('opens in the house voice even for a fault it cannot classify', async () => {
        // The unclassified tail keeps the raw text as trailing detail on
        // purpose (humanizeError preserves it rather than losing it); what
        // changed is that the sentence now OPENS by saying what failed.
        const utils = await openMarket(harness(() => Promise.reject(new Error('some other fault'))));
        expect(utils.container.textContent || '').toContain("Couldn't load this market. some other fault");
    });

    it('renders the market when the read succeeds, so the banner is not always on', async () => {
        const utils = await openMarket(harness(() => Promise.resolve({ data: [FEED] })));
        const shown = utils.container.textContent || '';
        expect(shown).toContain('Will it ship?');
        expect(shown).not.toContain("Couldn't load this market.");
    });

    // The mount effect and `reload` are two separate catches on the same read,
    // and reload is reached only after a placed bet, which no unit render can
    // drive. Pin it structurally instead: a form swept on one path and not the
    // other still ships wire wording on the other.
    it('routes BOTH betFeed catches through the same translation', () => {
        // Resolved from the vitest root rather than import.meta.url: this file
        // runs under jsdom, where import.meta.url is an http URL.
        const src = readFileSync(
            join(process.cwd(), 'packages/core/src/shared/routes/BetFeedDetail.jsx'),
            'utf8',
        );
        const catches = src.match(/\.catch\([\s\S]{0,80}?loadFailed\(err\)/g) || [];
        expect(catches.length, 'both the mount effect and reload translate their failure').toBe(2);
        expect(src).not.toContain("err?.message || 'Failed to load the market.'");
    });
});
