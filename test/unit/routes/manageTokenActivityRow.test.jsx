// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-80 / : Manage Token's Activity tab labelled every row "Event".
// The explorer's /history/<tick>/token rows carry the action type under
// `action`; the panel read `type` / `action_type` / `kind` and fell through
// to its 'EVENT' default, so an ISSUE and a mint-settings edit were
// indistinguishable on screen. The fixture below is the real payload.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ManageToken } from '../../../packages/core/src/shared/routes/ManageToken.jsx';

afterEach(() => cleanup());

const CHAIN = 'bitcoin-regtest';

// Two real rows from /RBTC/api/history/S18PROBE/token, trimmed to the keys
// the panel reads.
const ROWS = Object.freeze([
    {
        action: 'ISSUE',
        action_index: '1071',
        block_index: '6234',
        status: 'valid',
        timestamp: '1785186698',
        tx_hash: 'e5549444bb0f589d7b177258b135e2c673dd872234df83329c8f1d976fa7ee6c',
    },
    {
        action: 'ISSUE',
        action_index: '1070',
        block_index: '6231',
        status: 'valid',
        timestamp: '1785184192',
        tx_hash: '6134c97532936c9daad29eaeafd3b6d90e6c9b874f093ef094025956698d29f3',
    },
]);

async function renderActivityTab(rows) {
    const messaging = {
        getHistoryForToken: async () => ({ data: rows }),
        getTokenInfo: async () => ({}),
        getHoldersForToken: async () => ({ data: [] }),
        getWalletBalances: async () => ({}),
    };
    const { container } = render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(ManageToken, {
                walletId: 'w1', chainId: CHAIN, tick: 'S18PROBE', onBack() {},
            }),
        ),
    );
    const tab = await screen.findByRole('tab', { name: /activity/i });
    fireEvent.click(tab);
    await waitFor(() => {
        if (!container.querySelector('li')) throw new Error('activity rows not rendered yet');
    });
    return { container };
}

// Assert on the row's LEADING label rather than searching the whole string:
// textContent concatenates label and timestamp with no separator ("Event7/27/
// 2026, 2:11:38 PM"), so a /\bEvent\b/ search silently never matches and the
// test passes against the broken code. That false pass happened while writing
// this file and is the reason these assertions are anchored.
function labels(container) {
    return [...container.querySelectorAll('li')].map((li) => li.textContent.trim());
}

describe('ManageToken Activity rows', () => {
    it('labels a row from the `action` key the explorer actually sends', async () => {
        const { container } = await renderActivityTab(ROWS);
        expect(labels(container)[0]).toMatch(/^Issue/);
        expect(labels(container)[0]).not.toMatch(/^Event/);
    });

    it('shows the block height alongside the timestamp', async () => {
        const { container } = await renderActivityTab(ROWS);
        expect(labels(container)[0]).toMatch(/6,234/);
    });

    it('still falls back to the generic label when no action key is present', async () => {
        const { container } = await renderActivityTab([{ action_index: '9', timestamp: '1785186698' }]);
        expect(labels(container)[0]).toMatch(/^Event/);
    });
});
