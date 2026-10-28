// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

const VALID_PAYLOAD = {
    origin: 'https://dapp.test',
    requestedChains: [chain.id],
    accountOptions: [{ id: 'account-1', name: 'Account 1' }],
};

function mount(...args) {
    const payload = args.length === 0 ? VALID_PAYLOAD : args[0];
    return render(
        <ConnectApproval
            id="connect-failure"
            payload={payload}
            onReject={() => {}}
        />,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ConnectApproval failure handling', () => {
    it.each([
        ['missing', undefined],
        ['unparseable', '{not-json'],
        ['malformed', { origin: 'not a URL', requestedChains: [chain.id] }],
    ])('blocks a %s request payload with plain copy', (_label, payload) => {
        mount(payload);

        expect(screen.getByRole('alert')).toHaveTextContent(
            'This connection request is missing or invalid.',
        );
        expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
        expect(mocks.resolveApproval).not.toHaveBeenCalled();
    });

    it('permanently blocks a request the broker reports as expired', async () => {
        mocks.getSettings.mockResolvedValue({});
        const expired = new Error('approval.fetch: unknown id');
        expired.name = 'ApprovalNotFoundError';
        mocks.resolveApproval.mockRejectedValue(expired);
        const close = vi.spyOn(window, 'close').mockImplementation(() => {});
        mount();

        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'This connection request has expired.',
        );
        expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
        expect(close).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        expect(mocks.resolveApproval).toHaveBeenCalledOnce();
        expect(mocks.resolveApproval).toHaveBeenCalledWith('connect-failure', {
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

        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Could not connect this site.',
        );
    });
});
