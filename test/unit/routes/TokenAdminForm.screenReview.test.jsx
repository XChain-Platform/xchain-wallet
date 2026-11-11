// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Lock token, Mint settings and Callback settings as the screen review ruled
// them: Lock token's flags are the Issue form's lock switches (a lock icon
// when on, an unlock icon when off) under a green Lock token action with no
// top permanence notice; every mode's From label has its help tip; and
// Callback settings' Payout per unit follows the callback token's format,
// with the old static explainer lines gone.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ onSelect }) => (
        <div>
            <button type="button" onClick={() => onSelect({ chainId: 'bitcoin-mainnet', tick: 'EIGHT' })}>Pick EIGHT</button>
            <button type="button" onClick={() => onSelect({ chainId: 'bitcoin-mainnet', tick: 'WHOLE' })}>Pick WHOLE</button>
        </div>
    ),
}));

const CHAIN = 'bitcoin-mainnet';
const SOURCE = {
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

const DIVISIBILITY = { TOKEN: 0, EIGHT: 8, WHOLE: 0 };

function mount(mode) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn(({ tick }) => Promise.resolve({
            chainId: CHAIN,
            tick,
            creator: SOURCE.address,
            divisibility: DIVISIBILITY[tick] ?? 0,
            locks: {},
        })),
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue({});
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenAdminForm
                walletId="w"
                mode={mode}
                initialChainId={CHAIN}
                initialTick="TOKEN"
                initialFromAddress={SOURCE.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return target;
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('Lock token', () => {
    it('shows seven lock switches whose icon flips from unlock to lock', async () => {
        mount('lock');
        const switches = await screen.findAllByRole('switch');
        expect(switches).toHaveLength(7);
        const row = (el) => el.closest('[data-lock-flag]');
        const first = switches[0];
        expect(row(first).querySelector('svg')).not.toBeNull();
        const before = row(first).querySelector('span[aria-hidden="true"]').innerHTML;
        fireEvent.click(first);
        await waitFor(() => expect(first).toBeChecked());
        const after = row(first).querySelector('span[aria-hidden="true"]').innerHTML;
        expect(after).not.toBe(before);
    });

    it('has no top permanence notice and a Lock token action that is not the danger style', async () => {
        mount('lock');
        await screen.findAllByRole('switch');
        expect(document.body.textContent).not.toMatch(/Locking is permanent\. Each flag below/);
        const submit = screen.getByRole('button', { name: /Lock token/ });
        expect(submit.className).not.toMatch(/danger/);
        expect(screen.getByRole('textbox', { name: /^Type LOCK to confirm/ })).toBeInTheDocument();
    });
});

describe('From help tips', () => {
    for (const mode of ['lock', 'mint-settings', 'callback-settings']) {
        it(`gives From its help tip on ${mode}`, async () => {
            mount(mode);
            expect(await screen.findByRole('button', { name: 'About From' })).toBeInTheDocument();
        });
    }
});

describe('Callback settings', () => {
    async function pickCallbackToken(tick) {
        fireEvent.click(await screen.findByRole('button', { name: /^Callback token:/ }));
        fireEvent.click(await screen.findByRole('button', { name: `Pick ${tick}` }));
    }

    it('drops the static explainer lines', async () => {
        mount('callback-settings');
        await screen.findByRole('button', { name: 'About From' });
        expect(document.body.textContent).not.toContain('A callback lets you later recall');
        expect(document.body.textContent).not.toContain('Values you leave blank keep their current setting');
        expect(screen.getByRole('button', { name: 'About Payout per unit' })).toBeInTheDocument();
    });

    it('pads Payout per unit to an 8-place callback token', async () => {
        mount('callback-settings');
        await pickCallbackToken('EIGHT');
        const payout = await screen.findByLabelText(/^Payout per unit/);
        fireEvent.change(payout, { target: { value: '1' } });
        fireEvent.blur(payout);
        await waitFor(() => expect(payout.value).toBe('1.00000000'));
    });

    it('re-formats when the callback token changes and refuses extra digits with a field error', async () => {
        mount('callback-settings');
        // The token picker replaces the form while open, so the field is
        // looked up again after each pick.
        const payout = () => screen.findByLabelText(/^Payout per unit/);
        fireEvent.change(await payout(), { target: { value: '2' } });
        await pickCallbackToken('EIGHT');
        await waitFor(async () => expect((await payout()).value).toBe('2.00000000'));
        fireEvent.change(await payout(), { target: { value: '1.5' } });
        await pickCallbackToken('WHOLE');
        expect(await screen.findByText(/Payout per unit must be a whole number because WHOLE is indivisible\./))
            .toBeInTheDocument();
        expect((await payout()).value).toBe('1.5');
    });

    it('drops only the padding when the callback token turns whole-number', async () => {
        mount('callback-settings');
        const payout = () => screen.findByLabelText(/^Payout per unit/);
        fireEvent.change(await payout(), { target: { value: '2' } });
        await pickCallbackToken('EIGHT');
        await waitFor(async () => expect((await payout()).value).toBe('2.00000000'));
        await pickCallbackToken('WHOLE');
        await waitFor(async () => expect((await payout()).value).toBe('2'));
        expect(document.body.textContent).not.toMatch(/Payout per unit must be a whole number/);
    });

    it('says what a working callback needs only while it is partly filled', async () => {
        mount('callback-settings');
        const payout = await screen.findByLabelText(/^Payout per unit/);
        expect(document.body.textContent).not.toContain('A working callback needs all three fields set.');
        fireEvent.change(payout, { target: { value: '3' } });
        expect(await screen.findByText('A working callback needs all three fields set.')).toBeInTheDocument();
    });
});
