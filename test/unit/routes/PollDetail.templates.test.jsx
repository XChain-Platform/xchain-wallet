// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The poll page lays out its load error and its loading line inside the
// ListPage template, like every other route state, so neither sits bare in
// Screen without the template's spacing and notice order.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PollDetail } from '../../../packages/core/src/shared/routes/PollDetail.jsx';
import listPageStyles from '../../../packages/core/src/ui/ListPage.module.css';

const CHAIN = 'bitcoin-mainnet';

function messagingWith(governancePoll) {
    return {
        governancePoll,
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        governanceVotes: vi.fn().mockResolvedValue([]),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
    };
}

function renderPoll(messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PollDetail walletId="wallet-1" chainId={CHAIN} pollIndex={7} onBack={vi.fn()} />
        </MessagingProvider>,
    );
}

function expectFirstInListPage(container, element) {
    const page = element.parentElement;
    expect(page.classList.contains(listPageStyles.page), 'direct child of ListPage').toBe(true);
    expect(container.querySelector('main').firstElementChild).toBe(page);
}

afterEach(() => {
    cleanup();
});

describe('Poll page templates', () => {
    it('lays out the load error as a notice of a ListPage', async () => {
        const { container } = renderPoll(messagingWith(vi.fn().mockRejectedValue(new Error('indexer offline'))));
        const alert = await screen.findByRole('alert');
        const notice = alert.closest('[data-variant]') || alert;
        expect(notice.closest(`.${listPageStyles.page}`), 'inside ListPage').not.toBeNull();
        expectFirstInListPage(container, notice);
    });

    it('lays out the loading line inside a ListPage', () => {
        const { container } = renderPoll(messagingWith(vi.fn(() => new Promise(() => {}))));
        expectFirstInListPage(container, screen.getByText('Loading poll…'));
    });
});
