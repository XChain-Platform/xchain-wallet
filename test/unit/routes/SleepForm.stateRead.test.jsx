// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Pause token form reads the picked token's state and offers only the
// action that applies: Pause token for an active token, Resume token for a
// paused one. There is no status line. While the read loads the submit is
// disabled and loading; when it fails the standard error notice shows and the
// submit stays disabled. A read that fails is never shown as "active".

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SleepForm } from '../../../packages/core/src/shared/routes/SleepForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { tokenInfoCacheKey, writeTokenInfoCache } from '../../../packages/core/src/shared/utils/tokenInfoCache.js';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ onSelect }) => (
        <section aria-label="Token picker">
            <button type="button" onClick={() => onSelect({ chainId: CHAIN, tick: 'GATE' })}>Choose GATE</button>
            <button type="button" onClick={() => onSelect({ chainId: CHAIN, tick: 'OLD' })}>Choose OLD</button>
        </section>
    ),
}));

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function build(sleepState) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getTokenInfo: vi.fn(({ tick }) => Promise.resolve({
            chainId: CHAIN, tick: String(tick).toUpperCase(), creator: ADDRESS.address, locks: {},
        })),
        composeForConfirm: vi.fn().mockResolvedValue({ psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1 }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        sleepState,
        sleepAction: vi.fn().mockResolvedValue({ txid: 'sleep-txid' }),
    };
    const messaging = new Proxy(target, {
        get(t, prop) { return prop in t ? t[prop] : vi.fn().mockResolvedValue({}); },
    });
    return { messaging, target };
}

function mount(sleepState, props = { initialChainId: CHAIN, initialTick: 'gate' }) {
    const built = build(sleepState);
    render(
        <MessagingProvider shell="web" messaging={built.messaging}>
            <SleepForm walletId="w" mode="tick" onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
    return built;
}

async function approve() {
    const button = await screen.findByRole('button', { name: 'Approve' });
    await waitFor(() => expect(button).toBeEnabled());
    await act(async () => { fireEvent.click(button); });
}

const STATUS_TEXT = /Active, not paused|Paused indefinitely|Checking current state|Current state unavailable/;

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('SleepForm token state decides the action', () => {
    it('asks the explorer again when a tap finds the owner still unread', async () => {
        writeTokenInfoCache(tokenInfoCacheKey(CHAIN, 'gate'), null);
        const { target } = mount(vi.fn().mockResolvedValue({ resumeBlock: null }));
        const pause = await screen.findByRole('button', { name: /^Pause token$/i });
        fireEvent.click(screen.getByRole('button', { name: /^Pause setting/ }));
        fireEvent.click(screen.getByRole('option', { name: 'Pause indefinitely' }));
        fireEvent.click(pause);
        await waitFor(() => expect(screen.getAllByText(
            'Wait for the wallet to verify the current owner of gate.',
        ).length).toBeGreaterThan(0));
        await waitFor(() => expect(target.getTokenInfo).toHaveBeenCalledTimes(1));
        fireEvent.click(pause);
        expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    });

    it('offers only Pause for an active token, with no status line', async () => {
        mount(vi.fn().mockResolvedValue({ resumeBlock: null }));
        const pause = await screen.findByRole('button', { name: /^Pause token$/i });
        await waitFor(() => expect(pause).toBeEnabled());
        expect(screen.queryByRole('button', { name: /^Resume token$/i })).toBeNull();
        expect(screen.getByRole('heading', { name: 'Pause Token' })).toBeInTheDocument();
        expect(screen.queryByText(STATUS_TEXT)).toBeNull();
    });

    it('offers only Resume for a paused token, with no status line', async () => {
        mount(vi.fn().mockResolvedValue({ resumeBlock: -1 }));
        const resume = await screen.findByRole('button', { name: /^Resume token$/i });
        await waitFor(() => expect(resume).toBeEnabled());
        expect(screen.queryByRole('button', { name: /^Pause token$/i })).toBeNull();
        expect(screen.getByRole('heading', { name: 'Resume Token' })).toBeInTheDocument();
        expect(screen.queryByText(STATUS_TEXT)).toBeNull();
    });

    it('disables the submit with its loading state while the read is pending', async () => {
        mount(vi.fn(() => new Promise(() => {})));
        const button = await screen.findByRole('button', { name: /^Pause token$/i });
        expect(button).toBeDisabled();
        expect(screen.queryByText(STATUS_TEXT)).toBeNull();
    });

    it('shows the standard error notice and keeps the submit disabled when the read fails', async () => {
        mount(vi.fn().mockRejectedValue(new Error('explorer 500')));
        const notice = await screen.findByText(/Could not read the token's current state/);
        expect(notice.closest('[role="alert"]')).not.toBeNull();
        expect(screen.getByRole('button', { name: /^Pause token$/i })).toBeEnabled();
        expect(screen.queryByText(STATUS_TEXT)).toBeNull();
    });

    it('sends a pause for an active token', async () => {
        const { target } = mount(vi.fn().mockResolvedValue({ resumeBlock: null }));
        await screen.findByRole('button', { name: /^Pause token$/i });
        fireEvent.click(screen.getByRole('button', { name: /^Pause setting/ }));
        fireEvent.click(screen.getByRole('option', { name: 'Pause indefinitely' }));
        fireEvent.click(screen.getByRole('button', { name: /^Pause token$/i }));
        await approve();
        await waitFor(() => expect(target.sleepAction).toHaveBeenCalledTimes(1));
        expect(target.sleepAction.mock.calls[0][0].params).toEqual(
            expect.objectContaining({ VERSION: '1', RESUME_BLOCK: '-1' }),
        );
    });

    it('sends a resume for a paused token', async () => {
        const { target } = mount(vi.fn().mockResolvedValue({ resumeBlock: -1 }));
        const resume = await screen.findByRole('button', { name: /^Resume token$/i });
        await waitFor(() => expect(resume).toBeEnabled());
        fireEvent.click(resume);
        await approve();
        await waitFor(() => expect(target.sleepAction).toHaveBeenCalledTimes(1));
        expect(target.sleepAction.mock.calls[0][0].params).toEqual(
            expect.objectContaining({ VERSION: '1', RESUME_BLOCK: '0' }),
        );
    });

    it('updates the button when the token is switched', async () => {
        const sleepState = vi.fn(({ query }) => Promise.resolve(
            String(query).toUpperCase() === 'OLD' ? { resumeBlock: -1 } : { resumeBlock: null },
        ));
        mount(sleepState, { initialChainId: CHAIN });
        fireEvent.click(await screen.findByRole('button', { name: 'Token: Select a token' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Choose GATE' }));
        const pause = await screen.findByRole('button', { name: /^Pause token$/i });
        await waitFor(() => expect(pause).toBeEnabled());

        fireEvent.click(screen.getByRole('button', { name: /^Token: GATE/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Choose OLD' }));
        const resume = await screen.findByRole('button', { name: /^Resume token$/i });
        await waitFor(() => expect(resume).toBeEnabled());
        expect(screen.queryByRole('button', { name: /^Pause token$/i })).toBeNull();
    });
});
