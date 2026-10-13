// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { userEvent } from '../../helpers/userEvent.js';

const obligationState = vi.hoisted(() => ({
    obligations: [],
    refresh: null,
}));

vi.mock('../../../packages/core/src/shared/hooks/useCoinpayObligations.js', () => ({
    useCoinpayObligations: () => ({
        obligations: obligationState.obligations,
        scanning: false,
        error: null,
        refresh: obligationState.refresh,
    }),
}));

vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, QrScanner: () => null };
});

import { ObligationsView } from '../../../packages/core/src/shared/routes/ObligationsView.jsx';
import { RenameAccountForm } from '../../../packages/core/src/shared/routes/RenameAccountForm.jsx';
import { ScanRoute } from '../../../packages/core/src/shared/routes/ScanRoute.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';

const CHAIN_ID = 'bitcoin-mainnet';
const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

function withMessaging(child, messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            {child}
        </MessagingProvider>,
    );
}

async function expectTab(user, element) {
    await user.tab();
    expect(document.activeElement).toBe(element);
}

async function tabToStakeMore(user) {
    for (const name of ['Back to staking', 'Claim', 'Unstake', 'Delegate', 'More']) {
        await expectTab(user, screen.getByRole('button', { name }));
    }
}

beforeEach(() => {
    obligationState.obligations = [];
    obligationState.refresh = vi.fn();
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('N through S route keyboard flows', () => {
    it('reaches every Payments due action in reading order and activates it', async () => {
        const user = userEvent.setup();
        const onBack = vi.fn();
        const onPay = vi.fn();
        obligationState.obligations = [{
            chainId: CHAIN_ID,
            address: ADDRESS,
            payeeAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
            orderMatchActionIndex: '42',
            coinAmount: '0.5',
            expiration: null,
        }];
        withMessaging(
            <ObligationsView walletId="wallet-1" onPay={onPay} onBack={onBack} />,
            { getAutopayStatus: vi.fn().mockResolvedValue(null) },
        );

        await expectTab(user, screen.getByRole('button', { name: 'Back to previous screen' }));
        await user.keyboard('{Enter}');
        expect(onBack).toHaveBeenCalledOnce();

        await expectTab(user, screen.getByRole('button', { name: 'Refresh payments' }));
        await user.keyboard('{Enter}');
        expect(obligationState.refresh).toHaveBeenCalledOnce();

        await expectTab(user, screen.getByRole('button', { name: 'Pay now' }));
        await user.keyboard('{Enter}');
        expect(onPay).toHaveBeenCalledWith({
            chainId: CHAIN_ID,
            address: ADDRESS,
            orderMatchActionIndex: '42',
        });
    });

    it('renames an account and reaches both header actions from the focused field', async () => {
        const user = userEvent.setup();
        const onBack = vi.fn();
        const onRenamed = vi.fn();
        const messaging = {
            listAccounts: vi.fn().mockResolvedValue([]),
            renameAccount: vi.fn().mockResolvedValue({
                account: { id: 'account-1', name: 'Savings' },
            }),
        };
        withMessaging(
            <RenameAccountForm
                accountId="account-1"
                walletId="wallet-1"
                initialName="Primary"
                onBack={onBack}
                onRenamed={onRenamed}
            />,
            messaging,
        );

        const name = screen.getByLabelText('Account name');
        await waitFor(() => expect(document.activeElement).toBe(name));
        await user.type('Savings');
        expect(name).toHaveValue('Savings');

        await expectTab(user, screen.getByRole('button', { name: 'Back to previous screen' }));
        await user.keyboard('{Enter}');
        expect(onBack).toHaveBeenCalledOnce();

        await expectTab(user, screen.getByRole('button', { name: 'Save' }));
        await user.keyboard('{Enter}');
        await waitFor(() => expect(onRenamed).toHaveBeenCalledWith({
            id: 'account-1',
            name: 'Savings',
        }));
        expect(messaging.renameAccount).toHaveBeenCalledWith({
            accountId: 'account-1',
            name: 'Savings',
        });
    });

    it('pastes a Scan payment address and submits without pointer input', async () => {
        const user = userEvent.setup();
        const onBack = vi.fn();
        const onClassified = vi.fn();
        render(<ScanRoute onBack={onBack} onClassified={onClassified} />);

        await expectTab(user, screen.getByRole('button', { name: 'Back to previous screen' }));
        await user.keyboard('{Enter}');
        expect(onBack).toHaveBeenCalledOnce();

        const paste = screen.getByLabelText('Or paste it here');
        await expectTab(user, paste);
        await user.type(ADDRESS);
        expect(paste).toHaveValue(ADDRESS);

        await expectTab(user, screen.getByRole('button', { name: 'Use pasted text' }));
        await user.keyboard('{Enter}');
        expect(onClassified).toHaveBeenCalledWith({
            kind: 'send',
            address: ADDRESS,
            chainId: CHAIN_ID,
        });
    });

    it('operates every Stake detail action and returns focus when Escape closes More', async () => {
        const user = userEvent.setup();
        const actions = {
            onBack: vi.fn(),
            onClaimRewards: vi.fn(),
            onUnstake: vi.fn(),
            onDelegate: vi.fn(),
            onRevokeDelegation: vi.fn(),
            onOpenOperatorDashboard: vi.fn(),
        };
        const messaging = {
            getStakesForAddress: vi.fn().mockResolvedValue([
                { action_index: '1', amount: '10', asset: 'XCHAIN', status: 'active' },
            ]),
            getDelegationsForAddress: vi.fn().mockResolvedValue([
                { delegation_id: '1', signing_pubkey: '02abc', status: 'active' },
            ]),
            getRewardsForAddress: vi.fn().mockResolvedValue([
                { action_index: '2', amount: '5', status: 'valid' },
            ]),
            getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        };
        withMessaging(
            <StakeDetail
                walletId="wallet-1"
                kind="validator"
                chainId={CHAIN_ID}
                address={ADDRESS}
                {...actions}
            />,
            messaging,
        );

        await screen.findByRole('button', { name: 'Claim' });
        const orderedActions = [
            ['Back to staking', actions.onBack],
            ['Claim', actions.onClaimRewards],
            ['Unstake', actions.onUnstake],
            ['Delegate', actions.onDelegate],
        ];
        for (const [name, callback] of orderedActions) {
            await expectTab(user, screen.getByRole('button', { name }));
            await user.keyboard('{Enter}');
            expect(callback).toHaveBeenCalledOnce();
        }

        const more = screen.getByRole('button', { name: 'More' });
        await expectTab(user, more);
        await user.keyboard('{Enter}');
        expect(more).toHaveAttribute('aria-expanded', 'true');

        await expectTab(user, screen.getByRole('menuitem', { name: 'Revoke delegation' }));
        await expectTab(user, screen.getByRole('menuitem', { name: 'Operator view' }));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(more);

        await user.keyboard('{Enter}');
        await expectTab(user, screen.getByRole('menuitem', { name: 'Revoke delegation' }));
        await user.keyboard('{Enter}');
        expect(actions.onRevokeDelegation).toHaveBeenCalledOnce();

        await tabToStakeMore(user);
        await user.keyboard('{Enter}');
        await expectTab(user, screen.getByRole('menuitem', { name: 'Revoke delegation' }));
        await expectTab(user, screen.getByRole('menuitem', { name: 'Operator view' }));
        await user.keyboard('{Enter}');
        expect(actions.onOpenOperatorDashboard).toHaveBeenCalledOnce();

        await tabToStakeMore(user);
        for (const tabName of ['Rewards', 'Delegation', 'Details']) {
            await expectTab(user, screen.getByRole('tab', { name: tabName }));
            await user.keyboard('{Enter}');
            expect(screen.getByRole('tab', { name: tabName })).toHaveAttribute('aria-selected', 'true');
        }
    });
});
