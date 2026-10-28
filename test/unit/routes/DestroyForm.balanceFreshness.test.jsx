// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A destroy burns tokens for good, so the balance it is judged against must be
// one the wallet read and could parse, and it must still cover the amount at
// the moment Approve is pressed. These drives cover the balance the form shows
// at Review and the one it re-reads just before signing.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DestroyForm } from '../../../packages/core/src/shared/routes/DestroyForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = {
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

const balancesWith = (tokens) => ({
    [CHAIN]: [{
        address: SOURCE.address,
        balances: {
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens,
        },
        error: null,
    }],
});

function mountDestroy({ balances }) {
    const state = { balances };
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'ART', divisibility: 0, locks: {} }),
        getWalletBalances: vi.fn((...args) => (typeof state.balances === 'function'
            ? state.balances(...args)
            : Promise.resolve(state.balances))),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'DESTROY|0|ART|2', version: 1,
            releaseEncoderInputsToken: 'release-1',
            simulation: { deltas: [{ tick: 'ART', before: '2', after: '0' }] },
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        checkInputLiveness: vi.fn().mockResolvedValue({ verdict: 'live' }),
        releaseEncoderInputs: vi.fn().mockResolvedValue({ released: 1 }),
        reserve: vi.fn().mockResolvedValue({ ok: true }),
        releaseReservation: vi.fn().mockResolvedValue({ ok: true }),
        destroyToken: vi.fn().mockResolvedValue({ txid: 'ab'.repeat(32) }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <DestroyForm
                walletId="w"
                initialChainId={CHAIN}
                initialTick="ART"
                initialFromAddress={SOURCE.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return { messaging, state };
}

async function reviewAmount(value) {
    fireEvent.change(await screen.findByLabelText(/^Amount/), { target: { value } });
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Destroy$/ }));
    });
}

async function approveOnConfirm() {
    fireEvent.change(await screen.findByLabelText('Type "DESTROY" to confirm'), { target: { value: 'DESTROY' } });
    const approve = await screen.findByTestId('confirm-approve');
    await waitFor(() => expect(approve).not.toBeDisabled());
    await act(async () => { fireEvent.click(approve); });
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('DestroyForm balance freshness', () => {
    it('bypasses a balance cached under two seconds old and refuses when the token is gone', async () => {
        const held = balancesWith([{ tick: 'ART', quantity: '2', divisibility: 0 }]);
        const gone = balancesWith([]);
        const cacheAgeMs = 1500;
        const { messaging } = mountDestroy({
            balances: (_walletId, _accountId, _chainId, opts) => Promise.resolve(
                opts?.fresh || cacheAgeMs >= 2000 ? gone : held,
            ),
        });
        expect(await screen.findByText('2 ART available')).toBeInTheDocument();
        await reviewAmount('2');
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));

        await approveOnConfirm();

        await waitFor(() => expect(screen.getByText(
            'This address holds 0 ART now, less than the 2 ART this destroy burns. Nothing was signed. Review the amount and try again.',
        )).toBeInTheDocument());
        expect(messaging.getWalletBalances).toHaveBeenCalledWith(
            'w', undefined, CHAIN, { fresh: true },
        );
        expect(messaging.destroyToken).not.toHaveBeenCalled();
    });

    it('refuses at Approve when the balance dropped below the amount after Review', async () => {
        const { messaging, state } = mountDestroy({ balances: balancesWith([{ tick: 'ART', quantity: '2', divisibility: 0 }]) });
        expect(await screen.findByText('2 ART available')).toBeInTheDocument();
        await reviewAmount('2');
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));

        state.balances = balancesWith([{ tick: 'ART', quantity: '1', divisibility: 0 }]);
        await approveOnConfirm();

        await waitFor(() => expect(screen.getByText(
            'This address holds 1 ART now, less than the 2 ART this destroy burns. Nothing was signed. Review the amount and try again.',
        )).toBeInTheDocument());
        expect(messaging.destroyToken).not.toHaveBeenCalled();
        // A refusal signs nothing, so the composed coins and the held balance go back.
        expect(messaging.releaseEncoderInputs).toHaveBeenCalledWith({ token: 'release-1' });
        await waitFor(() => expect(messaging.releaseReservation).toHaveBeenCalled());
        // Max and the footer offer the balance that refused the burn, not the old one.
        expect(await screen.findByText('1 ART available')).toBeInTheDocument();
        expect(screen.queryByText('2 ART available')).toBeNull();
    });

    it('refuses at Approve when the balance cannot be read again', async () => {
        const { messaging, state } = mountDestroy({ balances: balancesWith([{ tick: 'ART', quantity: '2', divisibility: 0 }]) });
        expect(await screen.findByText('2 ART available')).toBeInTheDocument();
        await reviewAmount('2');
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));

        state.balances = () => Promise.reject(new Error('explorer unreachable'));
        await approveOnConfirm();

        await waitFor(() => expect(screen.getByText(
            "Couldn't read this address's ART balance, so nothing was signed. Check your connection and try again.",
        )).toBeInTheDocument());
        expect(messaging.destroyToken).not.toHaveBeenCalled();
    });

    it('signs when the balance read at Approve still covers the amount', async () => {
        const { messaging } = mountDestroy({ balances: balancesWith([{ tick: 'ART', quantity: '2', divisibility: 0 }]) });
        expect(await screen.findByText('2 ART available')).toBeInTheDocument();
        await reviewAmount('2');
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        await approveOnConfirm();
        await waitFor(() => expect(messaging.destroyToken).toHaveBeenCalledTimes(1));
    });

    it('does not compose against a balance read that failed', async () => {
        const { messaging } = mountDestroy({
            balances: { [CHAIN]: [{ address: SOURCE.address, balances: null, error: 'explorer unreachable' }] },
        });
        await reviewAmount('5');
        expect(await screen.findByText(
            "Couldn't read this address's ART balance, so nothing was signed. Check your connection and try again.",
        )).toBeInTheDocument();
        expect(screen.queryByText(/holds only 0 ART/)).toBeNull();
        expect(screen.queryByText('0 ART available')).toBeNull();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('does not compose against a balance the explorer reported malformed', async () => {
        const { messaging } = mountDestroy({ balances: balancesWith([{ tick: 'ART', quantity: '1e3', divisibility: 0 }]) });
        await reviewAmount('5');
        expect(await screen.findByText(
            "Couldn't read this address's ART balance, so nothing was signed. Check your connection and try again.",
        )).toBeInTheDocument();
        expect(screen.queryByText(/ART available/)).toBeNull();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('reads the balance before composing when Destroy is pressed before the first read lands', async () => {
        // A slow explorer: every read takes longer than the user takes to press Destroy.
        const { messaging } = mountDestroy({
            balances: () => new Promise((r) => {
                setTimeout(() => r(balancesWith([{ tick: 'ART', quantity: '2', divisibility: 0 }])), 1500);
            }),
        });
        await reviewAmount('5');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(await screen.findByText(
            'This address holds only 2 ART. Enter an amount at or below that balance.',
            {},
            { timeout: 4000 },
        )).toBeInTheDocument();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});
