// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

function mountAccessLists(record = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getTokenInfo: vi.fn().mockResolvedValue({
            allowList: '412',
            blockList: '413',
            creator: SOURCE.address,
            ...record,
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
    it('shows Allow list and Block list as picker fields like Token, with no grey buttons', async () => {
        mountAccessLists();

        // Each list is a field-shaped button named by its label and value,
        // with the list icon inside it, exactly as the Token field above.
        const allowField = await screen.findByRole('button', { name: /^Allow list: List #412/ });
        const blockField = screen.getByRole('button', { name: /^Block list: List #413/ });
        const tokenField = screen.getByRole('button', { name: /^Token:/ });
        // Same control kind as Token, matched by role and label; the Token
        // field's own class list gained a lead-icon class from the shared
        // field-icon geometry, so class names are not compared.
        for (const field of [allowField, blockField]) {
            expect(field.tagName).toBe(tokenField.tagName);
            expect(field.getAttribute('type')).toBe(tokenField.getAttribute('type'));
        }
        expect(allowField.querySelector('svg')).toBeTruthy();
        expect(blockField.querySelector('svg')).toBeTruthy();
        expect(screen.queryByRole('region', { name: 'Allow-list' })).toBeNull();
        expect(screen.queryByRole('region', { name: 'Block-list' })).toBeNull();

        // Help sits in each label's ? tip.
        const allowTip = screen.getByRole('button', { name: 'About Allow list' });
        const blockTip = screen.getByRole('button', { name: 'About Block list' });
        expect(allowTip).toHaveAccessibleDescription(/Only members of this allow list/);
        expect(blockTip).toHaveAccessibleDescription(/Members of this block list are denied/);

        // The old in-form buttons are gone; shared lists live in the picker.
        for (const name of [
            /Choose Allow-List/, /Change Allow-List/, /Choose Block-List/, /Change Block-List/,
            /Use a Shared Block List/,
        ]) {
            expect(screen.queryByRole('button', { name })).toBeNull();
        }
        // Regtest can detach, so each bound field carries its clear action.
        expect(screen.getByRole('button', { name: 'Remove allow-list' }).querySelector('svg')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove block-list' }).querySelector('svg')).toBeTruthy();
        expect(screen.queryByText('Remove List')).toBeNull();
    });

    it('opens the list picker from each field and shows the pick in it', async () => {
        mountAccessLists();
        fireEvent.click(await screen.findByRole('button', { name: /^Block list:/ }));
        expect(await screen.findByRole('heading', { name: 'Select Block List' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        fireEvent.click(await screen.findByRole('button', { name: /^Allow list:/ }));
        expect(await screen.findByRole('heading', { name: 'Select Allow List' })).toBeTruthy();
    });

    it('shows None set for an unbound list and None after a clear', async () => {
        mountAccessLists({ allowList: null });
        expect(await screen.findByRole('button', { name: 'Allow list: None set' })).toBeTruthy();
        fireEvent.click(await screen.findByRole('button', { name: 'Remove block-list' }));
        expect(screen.getByRole('button', { name: 'Block list: None after this update' })).toBeTruthy();
    });
});
