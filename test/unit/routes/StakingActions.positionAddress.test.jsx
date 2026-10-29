// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A stake's detail page acts for the address that owns the stake. With two
// addresses on a chain, Claim, Unstake, Delegate and Revoke from the second
// address's detail must read and compose for that address, not for whichever
// address is the chain's active one.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakingActionForm } from '../../../packages/core/src/shared/routes/StakingActionForm.jsx';
import { DelegationActionForm } from '../../../packages/core/src/shared/routes/DelegationActionForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const ACTIVE = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const OWNER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const KEY = 'c'.repeat(64);

afterEach(cleanup);

function messagingFor(extra = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [
                { id: 'active', address: ACTIVE, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' },
                { id: 'owner', address: OWNER, publicKey: '02cd', derivationPath: "m/84'/0'/0'/0/1", source: 'hd' },
            ],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: 'active', address: ACTIVE } }),
        getRewardsForAddress: vi.fn(async ({ address }) => (address === OWNER ? [{ id: 1, amount: '9' }] : [])),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
        getDelegationsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        composeForConfirm: vi.fn(() => new Promise(() => {})),
        ...extra,
    };
    return new Proxy(target, {
        get: (object, property) => (property in object ? object[property] : () => Promise.resolve({})),
    });
}

describe('validator actions opened from a stake detail', () => {
    it('claims the owner address rewards, and composes from it', async () => {
        const messaging = messagingFor();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <StakingActionForm mode="claim-rewards" walletId="w" chainId={CHAIN} initialFromAddress={OWNER} onBack={() => {}} />
            </MessagingProvider>,
        );

        expect(await screen.findByText('9 XCHAIN available')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByLabelText('Amount (XCHAIN)')).toHaveValue('9'));
        expect(messaging.getRewardsForAddress).toHaveBeenCalledWith({ chainId: CHAIN, address: OWNER });
        fireEvent.click(screen.getByRole('button', { name: 'Claim rewards' }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(messaging.composeForConfirm.mock.calls[0][0].from.address).toBe(OWNER);
    });

    it('falls back to the active address when the position address is not the wallet\'s', async () => {
        const messaging = messagingFor();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <StakingActionForm mode="claim-rewards" walletId="w" chainId={CHAIN} initialFromAddress="bc1qnotmine" onBack={() => {}} />
            </MessagingProvider>,
        );

        await waitFor(() => expect(messaging.getRewardsForAddress).toHaveBeenCalledWith({ chainId: CHAIN, address: ACTIVE }));
    });

    it('revokes from the owner address and reads its delegations', async () => {
        const messaging = messagingFor();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <DelegationActionForm mode="revoke" walletId="w" chainId={CHAIN} initialFromAddress={OWNER} onBack={() => {}} />
            </MessagingProvider>,
        );

        await waitFor(() => expect(messaging.getDelegationsForAddress).toHaveBeenCalledWith({ chainId: CHAIN, address: OWNER }));
        const input = await screen.findByLabelText('Signing pubkey to revoke');
        fireEvent.change(input, { target: { value: KEY } });
        fireEvent.submit(input.closest('form'));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(messaging.composeForConfirm.mock.calls[0][0].from.address).toBe(OWNER);
    });
});
