// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';
const SOURCE = Object.freeze({
    id: 'addr-1',
    address: 'mkHS9ne12qx9pS9VojpwU5xtRd4T7X7ZUt',
    publicKey: '02aa',
    derivationPath: "m/84'/1'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function mountAccessLists() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getTokenInfo: vi.fn().mockResolvedValue({
            allowList: '412',
            blockList: '413',
            creator: SOURCE.address,
        }),
        getListByActionIndex: vi.fn().mockResolvedValue({ members: [] }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
    };
    const messaging = new Proxy(target, {
        get(obj, prop) {
            if (prop in obj) return obj[prop];
            return () => Promise.resolve({ rows: [] });
        },
        has: (obj, prop) => prop in obj,
    });

    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenAdminForm
                walletId="w"
                mode="access-lists"
                initialChainId={CHAIN}
                initialTick="POLICY"
                initialFromAddress={SOURCE.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('TokenAdminForm access-lists screen', () => {
    it('puts guidance in named help tips and gives every section button an icon', async () => {
        mountAccessLists();

        const allowSection = await screen.findByRole('region', { name: 'Allow-list' });
        const blockSection = screen.getByRole('region', { name: 'Block-list' });
        await waitFor(() => expect(within(allowSection).getByText('List #412')).toBeTruthy());

        expect(screen.queryByText(/^Restrict who can interact/)).toBeNull();
        expect(screen.queryByText(/^A list can be replaced here/)).toBeNull();
        expect(screen.queryByText(/^Choose Remove list to detach/)).toBeNull();
        const allowTip = within(allowSection).getByRole('button', { name: 'About the allow-list' });
        const blockTip = within(blockSection).getByRole('button', { name: 'About the block-list' });
        expect(allowTip).toHaveAccessibleDescription(/Only members of this allow-list/);
        expect(blockTip).toHaveAccessibleDescription(/Members of this block-list are denied/);

        const actionButtons = [
            within(allowSection).getByRole('button', { name: 'Change allow-list' }),
            within(allowSection).getByRole('button', { name: 'Remove allow-list' }),
            within(blockSection).getByRole('button', { name: 'Change block-list' }),
            within(blockSection).getByRole('button', { name: 'Use a shared block list' }),
            within(blockSection).getByRole('button', { name: 'Remove block-list' }),
        ];
        for (const button of actionButtons) {
            expect(button.querySelector('svg')).toBeTruthy();
        }
    });
});
