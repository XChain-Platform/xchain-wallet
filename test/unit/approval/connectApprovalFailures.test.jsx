// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';

const mocks = vi.hoisted(() => ({
    getSettings: vi.fn(),
    resolveApproval: vi.fn(),
}));

vi.mock('../../../packages/extension/src/approval/messaging.js', () => ({
    getSettings: mocks.getSettings,
    resolveApproval: mocks.resolveApproval,
}));

const { ConnectApproval } = await import(
    '../../../packages/extension/src/approval/kinds/ConnectApproval.jsx'
);

const chain = BUNDLED_DESCRIPTORS[0];

function mount() {
    return render(
        <ConnectApproval
            id="connect-failure"
            payload={{
                origin: 'https://dapp.test',
                requestedChains: [chain.id],
                accountOptions: [{ id: 'account-1', name: 'Account 1' }],
            }}
            onReject={() => {}}
        />,
    );
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mocks.getSettings.mockResolvedValue({});
});

describe('ConnectApproval failure handling', () => {
    it('shows a broker refusal and permits the same exact grant to be retried', async () => {
        mocks.getSettings.mockResolvedValue({});
        mocks.resolveApproval
            .mockRejectedValueOnce(new Error('This connection request expired.'))
            .mockResolvedValueOnce({ resolved: true });
        const close = vi.spyOn(window, 'close').mockImplementation(() => {});
        mount();

        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'This connection request expired.',
        );
        expect(screen.getByRole('button', { name: 'Connect' })).not.toBeDisabled();
        expect(close).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
        await waitFor(() => expect(close).toHaveBeenCalledOnce());

        expect(mocks.resolveApproval).toHaveBeenNthCalledWith(2, 'connect-failure', {
            approved: true,
            chains: [chain.id],
            accounts: ['account-1'],
            canSignMessage: false,
            canSignAction: {},
        });
    });

    it('uses safe copy when a refusal has no message', async () => {
        mocks.getSettings.mockResolvedValue({});
        mocks.resolveApproval.mockRejectedValue(null);
        mount();

        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Could not connect this site.',
        );
    });
});
