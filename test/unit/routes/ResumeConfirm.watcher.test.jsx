// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act as domAct, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ResumeConfirm } from '../../../packages/core/src/shared/routes/ResumeConfirm.jsx';

const session = Object.freeze({
    id: 'confirm-1',
    composed: {
        chainId: 'bitcoin-mainnet',
        psbt: '70736274ff00',
        encoding: 'op_return',
    },
    dispatch: {
        base: {
            walletId: 'w',
            from: {
                address: 'bc1qexampleexampleexampleexampleexampleex',
                source: 'hd',
            },
        },
    },
});

async function drain(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

describe('ResumeConfirm in watcher mode', () => {
    it('exports the stored unsigned PSBT without asking for a password or signing', async () => {
        const messaging = {
            getSettings: vi.fn(async () => ({ walletMode: 'watcher' })),
            signerReady: vi.fn(async () => ({ ready: false })),
            clearConfirmSession: vi.fn(async () => undefined),
            preflight: vi.fn(),
        };
        let utils;
        await domAct(async () => {
            utils = render(
                <MessagingProvider shell="web" messaging={messaging}>
                    <ResumeConfirm session={session} onDone={() => {}} onCancel={() => {}} />
                </MessagingProvider>,
            );
            await drain();
        });

        expect(utils.getByLabelText('Unsigned transaction hex').value).toBe(session.composed.psbt);
        expect(utils.getByRole('heading', { level: 1, name: 'Unsigned transaction' })).toBeTruthy();
        expect(utils.queryByLabelText(/Password/i)).toBeNull();
        expect(messaging.preflight).not.toHaveBeenCalled();
    });
});
