// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const approvalMessaging = vi.hoisted(() => ({
    getSettings: vi.fn(async () => ({})),
    resolveApproval: vi.fn(async () => ({ approved: true })),
}));

vi.mock('../../../packages/extension/src/approval/messaging.js', () => ({
    getSettings: (...args) => approvalMessaging.getSettings(...args),
    resolveApproval: (...args) => approvalMessaging.resolveApproval(...args),
}));

const { ConnectApproval } = await import(
    '../../../packages/extension/src/approval/kinds/ConnectApproval.jsx'
);

const CHAIN = BUNDLED_DESCRIPTORS[0];

beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
        matches: false,
        media: '(max-width: 599px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    })));
});

afterEach(() => {
    cleanup();
    approvalMessaging.getSettings.mockClear();
    approvalMessaging.resolveApproval.mockClear();
    vi.unstubAllGlobals();
});

describe('extension approval accessibility', () => {
    it('scans a loaded extension connection approval', async () => {
        const { container } = render(
            <ConnectApproval
                id="approval-a11y"
                payload={{
                    origin: 'https://dapp.example',
                    appName: 'Accessibility dApp',
                    requestedChains: [CHAIN.id],
                    accountOptions: [
                        { id: 'account-1', name: 'Primary account' },
                        { id: 'account-2', name: 'Savings account' },
                    ],
                }}
                onReject={() => {}}
            />,
        );

        await screen.findByLabelText(`Allow ${CHAIN.displayName} ${CHAIN.networkKind}`);
        await screen.findByRole('button', { name: 'Approve' });
        await expectNoSeriousAxeViolations(container);
    });
});
