// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const TICK = 'POLICY';
const SOURCE = Object.freeze({
    id: 'addr-1',
    address: 'mkHS9ne12qx9pS9VojpwU5xtRd4T7X7ZUt',
    publicKey: '02aa',
    derivationPath: "m/84'/1'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function mountAccessLists(chainId) {
    const composeForConfirm = vi.fn().mockRejectedValue(new Error('stop after capture'));
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [chainId]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [chainId]: { id: SOURCE.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getTokenInfo: vi.fn().mockResolvedValue({ allowList: '412', blockList: null }),
        getListByActionIndex: vi.fn().mockResolvedValue({ members: [] }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        composeForConfirm,
    };
    const messaging = new Proxy(target, {
        get(obj, prop) {
            if (prop in obj) return obj[prop];
            return () => Promise.resolve({ rows: [] });
        },
        has: (obj, prop) => prop in obj,
    });
    const rendered = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenAdminForm
                walletId="w"
                mode="access-lists"
                initialChainId={chainId}
                initialTick={TICK}
                initialFromAddress={SOURCE.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return { ...rendered, composeForConfirm };
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('token policy list detach', () => {
    it('offers removal on regtest and composes the zero sentinel', async () => {
        const { container, composeForConfirm } = mountAccessLists('bitcoin-regtest');

        await waitFor(() => expect(container.querySelector('[aria-label="Remove allow-list"]')).toBeTruthy());
        fireEvent.click(container.querySelector('[aria-label="Remove allow-list"]'));
        await waitFor(() => expect(container.textContent).toContain('None after this update'));

        fireEvent.click(container.querySelector('button[type="submit"]'));
        await waitFor(() => expect(composeForConfirm).toHaveBeenCalled());
        expect(composeForConfirm.mock.calls[0][0].actionData.params).toMatchObject({
            VERSION: '5',
            TICK,
            ALLOW_LIST: '0',
        });
        expect(composeForConfirm.mock.calls[0][0].actionData.params).not.toHaveProperty('BLOCK_LIST');
    });

    it('does not offer removal outside regtest', async () => {
        const { container } = mountAccessLists('bitcoin-mainnet');

        await waitFor(() => expect(container.textContent).toContain('List #412'));
        expect(container.querySelector('[aria-label="Remove allow-list"]')).toBeNull();
        expect(container.textContent).not.toContain('Remove list');
    });
});
