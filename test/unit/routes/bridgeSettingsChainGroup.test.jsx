// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Bridge settings listed "Destination chains" and each chain checkbox as
// separate form rows, so the label sat a form gap plus its own 12px margin
// above the first chain (28px) and the chains were spaced like unrelated
// fields. They are now one labelled group with the label gap inside it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import styles from '../../../packages/core/src/shared/routes/IssueTokenForm.module.css';

const DOGE = 'dogecoin-mainnet';
const DOGE_ADDRESS = {
    id: 'a-doge', address: 'DExampleDogeAddressxxxxxxxxxxxxxxxx', publicKey: '02bb', derivationPath: "m/44'/3'/0'/0/0", source: 'hd',
};
const WAIT = { timeout: 4000 };

function mountAdmin(tokenInfo) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [DOGE]: [DOGE_ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getTokenInfo: vi.fn().mockResolvedValue(tokenInfo),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
    };
    const messaging = new Proxy(base, {
        get(t, p) {
            if (p in t) return t[p];
            if (typeof p !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            t[p] = stub;
            return stub;
        },
    });
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenAdminForm, {
            walletId: 'w',
            mode: 'bridge-settings',
            initialChainId: DOGE,
            initialTick: 'FUFU',
            onBack() {},
        }),
    ));
    return messaging;
}

afterEach(() => { cleanup(); vi.clearAllMocks(); __clearTokenInfoCache(); });

function ruleBody(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? null;
}

describe('Bridge settings destination networks', () => {
    it('renders the networks as one group named by its label', async () => {
        mountAdmin({ chainId: DOGE, tick: 'FUFU', locks: {} });
        const group = await screen.findByRole('group', { name: 'Destination networks' }, WAIT);
        expect(group).toHaveClass(styles.checkGroup);
        expect(within(group).getByLabelText('Bitcoin')).toBeTruthy();
        expect(within(group).getByLabelText('Litecoin')).toBeTruthy();
    });

    it('spaces the group on the label gap and drops the label margin inside it', () => {
        const css = readFileSync('packages/core/src/shared/routes/IssueTokenForm.module.css', 'utf8');
        expect(ruleBody(css, '.checkGroup')).toMatch(/gap:\s*var\(--xc-label-gap\)/);
        expect(ruleBody(css, '.checkGroup > .pickerLabel')).toMatch(/margin-bottom:\s*0/);
    });
});
