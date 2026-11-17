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

// Tab forward until `element` has focus, failing after `limit` stops.
async function tabTo(user, element, limit = 15) {
    for (let i = 0; i < limit && document.activeElement !== element; i += 1) await user.tab();
    expect(document.activeElement).toBe(element);
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

        // The filter icon sits in the header, then the whole row is one tab stop.
        await expectTab(user, screen.getByRole('button', { name: 'Filter payments due' }));
        await expectTab(user, screen.getByRole('button', { name: /^Buying tokens, Pay 0\.5 / }));
        await user.keyboard('{Enter}');
        expect(onPay).toHaveBeenCalledWith({
            chainId: CHAIN_ID,
            address: ADDRESS,
            orderMatchActionIndex: '42',
        });
    });

    it('renames an account and reaches Back and Save from the focused field', async () => {
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

        // One flat form: Back leads the page, then the field's help tip, the
        // field, the look controls (colour, shape, image), and Save Changes
        // closes the form. No section headers sit in between.
        await user.tab({ shift: true });
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'About Account name' }));
        await user.tab({ shift: true });
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back to previous screen' }));
        await user.keyboard('{Enter}');
        expect(onBack).toHaveBeenCalledOnce();

        await expectTab(user, screen.getByRole('button', { name: 'About Account name' }));
        await expectTab(user, name);
        // The look controls come next, all inside the one flat form.
        const flatForm = document.querySelector('[data-flat-look-form]');
        const save = screen.getByRole('button', { name: 'Save Changes' });
        for (let step = 0; step < 20 && document.activeElement !== save; step += 1) {
            await user.tab();
            if (document.activeElement !== save) {
                expect(flatForm.contains(document.activeElement)).toBe(true);
            }
        }
        expect(document.activeElement).toBe(save);
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

        await expectTab(user, screen.getByRole('button', { name: 'About Or paste it here' }));
        const paste = screen.getByLabelText('Or paste it here');
        await expectTab(user, paste);
        await user.type(ADDRESS);
        expect(paste).toHaveValue(ADDRESS);

        await expectTab(user, screen.getByRole('button', { name: 'Use Pasted Text' }));
        await user.keyboard('{Enter}');
        expect(onClassified).toHaveBeenCalledWith({
            kind: 'send',
            address: ADDRESS,
            chainId: CHAIN_ID,
        });
    });

    it('operates every Stake detail action row in order from the keyboard', async () => {
        const user = userEvent.setup();
        const actions = {
            onBack: vi.fn(),
            onClaimRewards: vi.fn(),
            onUnstake: vi.fn(),
            onDelegate: vi.fn(),
            onRevokeDelegation: vi.fn(),
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

        await screen.findByRole('button', { name: /^Claim\b/ });
        await expectTab(user, screen.getByRole('button', { name: 'Back to staking' }));
        await user.keyboard('{Enter}');
        expect(actions.onBack).toHaveBeenCalledOnce();

        // The Actions tab is the selected one, and its action rows follow it
        // in the approved order. Add stake has no handler here, so it is a
        // disabled row: still a tab stop that says why, and Enter does nothing.
        const actionsTab = screen.getByRole('tab', { name: 'Actions' });
        expect(actionsTab).toHaveAttribute('aria-selected', 'true');
        await tabTo(user, actionsTab);
        const addStake = screen.getByRole('button', { name: /^Add stake\b/ });
        await expectTab(user, addStake);
        expect(addStake).toHaveAttribute('aria-disabled', 'true');
        await user.keyboard('{Enter}');
        for (const [name, callback] of [
            ['Unstake', actions.onUnstake],
            ['Claim', actions.onClaimRewards],
            ['Delegate', actions.onDelegate],
            ['Revoke', actions.onRevokeDelegation],
        ]) {
            await expectTab(user, screen.getByRole('button', { name: new RegExp(`^${name}\\b`) }));
            await user.keyboard('{Enter}');
            expect(callback).toHaveBeenCalledOnce();
        }

        // The view tabs are the shared Tabs: one roving tab stop on the
        // selected tab, and the arrow keys move and select.
        actionsTab.focus();
        for (const tabName of ['Rewards', 'Details']) {
            await user.keyboard('{ArrowRight}');
            expect(document.activeElement).toBe(screen.getByRole('tab', { name: tabName }));
            expect(screen.getByRole('tab', { name: tabName })).toHaveAttribute('aria-selected', 'true');
        }
    });
});
