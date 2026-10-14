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

vi.mock('../../../packages/extension/src/approval/messaging.js', () => mocks);

const { ConnectApproval } = await import(
    '../../../packages/extension/src/approval/kinds/ConnectApproval.jsx'
);

const chain = BUNDLED_DESCRIPTORS[0];

function mount(payload) {
    return render(
        <ConnectApproval id="coverage-connect" payload={payload} onReject={() => {}} />,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.resolveApproval.mockResolvedValue({ resolved: true });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ConnectApproval validation branches', () => {
    it.each([
        [{}, 'missing origin'],
        [{ origin: '' }, 'empty origin'],
        [{ origin: 'data:text/plain,hello' }, 'opaque origin'],
        [{ origin: 'https://dapp.test', requestedChains: 'bitcoin' }, 'non-list chains'],
        [{ origin: 'https://dapp.test', requestedChains: [''] }, 'empty chain id'],
    ])('blocks %s (%s)', (payload) => {
        mount(payload);

        expect(screen.getByRole('alert')).toHaveTextContent(
            'This connection request is missing or invalid.',
        );
        expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    });

    it('adds an unselected chain and uses an account id as its label', () => {
        mount({
            origin: 'https://dapp.test',
            accountOptions: [{ id: 'account-without-name' }],
        });
        const chainBox = screen.getByLabelText(
            `Allow ${chain.displayName} ${chain.networkKind}`,
        );

        expect(chainBox).not.toBeChecked();
        expect(screen.getByLabelText('Share account-without-name')).toBeTruthy();
        fireEvent.click(chainBox);

        expect(chainBox).toBeChecked();
        expect(screen.getByRole('button', { name: 'Connect' })).not.toBeDisabled();
    });
});
