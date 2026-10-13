// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

const mocks = vi.hoisted(() => ({
    confirm: vi.fn(),
    copyText: vi.fn(),
}));

vi.mock('../../../packages/core/src/shared/hooks/useConfirmAction.js', () => ({
    useConfirmAction: () => ({ phase: 'idle', confirm: mocks.confirm }),
    isConfirmOpenPhase: () => false,
}));
vi.mock('../../../packages/core/src/shared/hooks/useSignerReady.js', () => ({
    useSignerReady: () => true,
}));
vi.mock('../../../packages/core/src/shared/clipboard.js', () => ({
    copyText: mocks.copyText,
}));

import { ResumeConfirm } from '../../../packages/core/src/shared/routes/ResumeConfirm.jsx';

const TXID = 'aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899';
const FROM = 'bc1qsourceaddresswithenoughcharactersforwrapping123456789';
const TO = 'bc1qdestinationaddresswithenoughcharactersforwrapping987654';

function session() {
    return {
        id: 'resume-detail',
        createdAt: Date.now(),
        composed: {
            psbt: 'deadbeef',
            actionString: `SEND|0|XCHAIN|100|${TO}`,
            chainId: 'bitcoin-mainnet',
        },
        dispatch: {
            software: 'sendToken',
            hardware: 'sendAssetHw',
            base: {
                walletId: 'wallet-1',
                chainId: 'bitcoin-mainnet',
                from: { address: FROM },
                to: TO,
            },
            label: 'send 100 XCHAIN',
        },
    };
}

function mount() {
    const messaging = {
        clearConfirmSession: vi.fn().mockResolvedValue(undefined),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ResumeConfirm session={session()} onDone={vi.fn()} onCancel={vi.fn()} />
        </MessagingProvider>,
    );
    return messaging;
}

beforeEach(() => {
    mocks.confirm.mockReset();
    mocks.copyText.mockReset();
    mocks.copyText.mockResolvedValue({ ok: true });
});
afterEach(() => cleanup());

describe('ResumeConfirm transaction result details', () => {
    it('returns to home from the page header', async () => {
        const onDone = vi.fn();
        mocks.confirm.mockResolvedValue({ txid: TXID });
        const messaging = {
            clearConfirmSession: vi.fn().mockResolvedValue(undefined),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ResumeConfirm session={session()} onDone={onDone} onCancel={vi.fn()} />
            </MessagingProvider>,
        );

        await screen.findByRole('heading', { name: 'Broadcast pending' });
        fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));

        expect(onDone).toHaveBeenCalledWith({ txid: TXID });
    });

    it('labels a broadcast as pending and exposes readable, copyable identifiers', async () => {
        mocks.confirm.mockResolvedValue({ txid: TXID });
        mount();

        await screen.findByRole('heading', { name: 'Broadcast pending' });
        expect(screen.getByText('Pending confirmation')).toBeTruthy();
        expect(screen.getByText('Send')).toBeTruthy();
        expect(screen.queryByText('SEND')).toBeNull();
        expect(screen.getByText(FROM)).toBeTruthy();
        expect(screen.getByText(TO)).toBeTruthy();
        expect(screen.getByText(TXID)).toBeTruthy();

        for (const [name, value] of [
            ['Copy from address', FROM],
            ['Copy to address', TO],
            ['Copy transaction ID', TXID],
        ]) {
            fireEvent.click(screen.getByRole('button', { name }));
            await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith(value));
        }

        const explorer = screen.getByRole('link', { name: /View on explorer/i });
        expect(explorer.getAttribute('href')).toMatch(new RegExp(`/BTC/tx/${TXID}$`));
        expect(explorer.getAttribute('target')).toBe('_blank');
        expect(explorer.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('does not claim a queued transaction was broadcast or link it to an explorer', async () => {
        mocks.confirm.mockResolvedValue({ txid: TXID, queued: true });
        mount();

        await screen.findByRole('heading', { name: 'Waiting to broadcast' });
        expect(screen.getByText('Signed, waiting to broadcast')).toBeTruthy();
        expect(screen.queryByText('Pending confirmation')).toBeNull();
        expect(screen.queryByRole('link', { name: /View on explorer/i })).toBeNull();
    });
});
