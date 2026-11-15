// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
//
// The "Activity in current window" row counts only entries inside the rolling
// limit in force now. The stored list can still hold older entries, or the
// entries of a limit since removed, and those are not activity in a window.

import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoSignerAccountDetail } from '../../../packages/core/src/shared/routes/CoSignerAccountDetail.jsx';

const HOUR = 3600 * 1000;

function mountAccount(policy, ages) {
    const now = Date.now();
    const messaging = {
        getSettings: () => Promise.resolve({}),
        getCoSignerAccount: () => Promise.resolve({
            id: 'acct-1',
            walletId: 'wallet-1',
            name: 'Treasury agent',
            chainId: 'bitcoin-regtest',
            aggregateAddress: 'bcrt1qfundingaddress',
            enabled: true,
            policy,
            allowedOutputs: [],
            window: { version: 1, entries: ages.map((age) => ({ t: now - age })) },
        }),
    };
    return render(
        <MessagingProvider shell="extension" messaging={messaging}>
            <CoSignerAccountDetail accountId="acct-1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

describe('CoSignerAccountDetail activity in current window', () => {
    it('counts only the entries inside the limit hours', async () => {
        mountAccount({ allowedActions: ['SEND'], maxPerWindow: { hours: 24, maxActions: 3 } },
            [HOUR, 2 * HOUR, 30 * HOUR]);

        await waitFor(() => expect(screen.getByText('2 action(s)')).toBeTruthy());
    });

    it('reads zero when the stored entries outlive a removed limit', async () => {
        mountAccount({ allowedActions: ['SEND'] }, [HOUR, 2 * HOUR]);

        await waitFor(() => expect(screen.getByText('0 action(s)')).toBeTruthy());
    });
});
