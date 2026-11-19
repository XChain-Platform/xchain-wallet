// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { GatedPublishForm } from '../../../packages/core/src/shared/routes/GatedPublishForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const OWNER = {
    id: 'owner-1',
    address: 'bc1qgateownergateownergateownergateowner0',
    publicKey: `02${'22'.repeat(32)}`,
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const OTHER = { ...OWNER, id: 'other-1', address: 'bc1qotheraddressotheraddressotheraddress0' };
const UNKNOWN_ISSUER = "The token's issuer could not be confirmed, so this action is not available. Try again when the explorer answers.";
const WAIT = 'Wait for the wallet to verify the current owner of GATE.';

function messagingWith(overrides = {}) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OTHER, OWNER] }),
        getOwnedTokens: vi.fn().mockResolvedValue([]),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        listGatedKeys: vi.fn().mockResolvedValue([]),
        // Reaching the confirm step is the proof a tap passed the owner check.
        composeGatedPublishForConfirm: vi.fn(() => new Promise(() => {})),
        getTokenInfo: vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'GATE', creator: OWNER.address, divisibility: 8 }),
        ...overrides,
    };
}

function mount(messaging, issuerAddress = null) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <GatedPublishForm
                walletId="wallet-1"
                chainId={CHAIN}
                tick="GATE"
                issuerAddress={issuerAddress}
                onBack={vi.fn()}
            />
        </MessagingProvider>,
    );
}

async function chooseFile() {
    const fileInput = await screen.findByLabelText(/^File \(up to/);
    fireEvent.change(screen.getByLabelText('File to publish'), {
        target: { files: [new File([new Uint8Array(40)], 'note.txt', { type: 'text/plain' })] },
    });
    await waitFor(() => expect(fileInput).toHaveValue('note.txt'));
}

const publishButton = () => screen.getByRole('button', { name: 'Publish File' });

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('GatedPublishForm owner read', () => {
    it('reads the owner itself when it opens before the token page named one', async () => {
        const messaging = messagingWith();
        mount(messaging);
        await chooseFile();
        fireEvent.click(publishButton());
        await waitFor(() => expect(messaging.composeGatedPublishForConfirm).toHaveBeenCalledOnce());
        expect(screen.queryByText(UNKNOWN_ISSUER)).toBeNull();
    });

    it('moves From to an owner that answers late', async () => {
        let answer;
        mount(messagingWith({
            getTokenInfo: vi.fn(() => new Promise((resolve) => { answer = resolve; })),
        }));
        await chooseFile();
        await waitFor(() => expect(answer).toBeTypeOf('function'));
        answer({ chainId: CHAIN, tick: 'GATE', creator: OWNER.address, divisibility: 8 });
        fireEvent.click(await screen.findByRole('button', { name: /^From/, expanded: false }));
        expect(await screen.findByLabelText('From')).toHaveValue(OWNER.address);
    });

    it('answers a tap while the owner read is in flight with the wait refusal', async () => {
        const messaging = messagingWith({ getTokenInfo: vi.fn(() => new Promise(() => {})) });
        mount(messaging);
        await chooseFile();
        expect(publishButton()).toBeEnabled();
        fireEvent.click(publishButton());
        await waitFor(() => expect(screen.getAllByText(WAIT).length).toBeGreaterThan(0));
        expect(messaging.composeGatedPublishForConfirm).not.toHaveBeenCalled();
    });

    it('keeps the button enabled and refuses the tap after a failed owner read', async () => {
        const messaging = messagingWith({
            getTokenInfo: vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'GATE', loadError: true }),
        });
        mount(messaging);
        await waitFor(() => expect(screen.getAllByText(UNKNOWN_ISSUER).length).toBeGreaterThan(0));
        expect(publishButton()).toBeEnabled();
        fireEvent.click(publishButton());
        await waitFor(() => expect(screen.getAllByText(UNKNOWN_ISSUER).length).toBeGreaterThan(0));
        expect(messaging.composeGatedPublishForConfirm).not.toHaveBeenCalled();
    });

    it('asks the explorer again when a tap follows a failed owner read', async () => {
        const getTokenInfo = vi.fn()
            .mockResolvedValueOnce({ chainId: CHAIN, tick: 'GATE', loadError: true })
            .mockResolvedValue({ chainId: CHAIN, tick: 'GATE', creator: OWNER.address, divisibility: 8 });
        const messaging = messagingWith({ getTokenInfo });
        mount(messaging);
        await waitFor(() => expect(screen.getAllByText(UNKNOWN_ISSUER).length).toBeGreaterThan(0));
        await chooseFile();
        fireEvent.click(publishButton());
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledTimes(2));
        // The refused tap asks again; the next tap goes through.
        fireEvent.click(publishButton());
        await waitFor(() => expect(messaging.composeGatedPublishForConfirm).toHaveBeenCalledOnce());
    });
});
