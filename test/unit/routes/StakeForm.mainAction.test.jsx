// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Stake form's forward actions (U63): the form submit names its action
// with an icon in every wallet mode (never a generic Preview), and the
// result step's Done is the green success action.
//
// Queries go through `container`: this form renders a large tree, and a
// failed role lookup spends minutes building testing-library's role dump.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

const confirmResult = { current: null };

vi.mock('../../../packages/core/src/shared/hooks/useConfirmAction.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useConfirmAction: () => ({
            confirm: async () => confirmResult.current,
            approve() {},
            reject() {},
            acknowledge() {},
            phase: 'idle',
            composing: false,
            composed: null,
            report: null,
            error: null,
            acknowledged: new Set(),
            source: null,
            canApprove: false,
        }),
    };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeForm } from '../../../packages/core/src/shared/routes/StakeForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'addr-1',
    address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function mountStake(walletMode = 'full') {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({ [CHAIN]: [] }),
        getStakesForAddress: () => Promise.resolve([]),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({ rows: [] });
        },
        has: (t, prop) => prop in t,
    });
    const { container } = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <StakeForm walletId="w" chainId={CHAIN} onBack={() => {}} />
        </MessagingProvider>,
    );
    return container;
}

async function readySubmit(container) {
    let button = null;
    await waitFor(() => {
        button = container.querySelector('button[type="submit"]');
        expect(button).not.toBeNull();
        expect(button.disabled).toBe(false);
    });
    return button;
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    confirmResult.current = null;
});

describe('StakeForm main actions', () => {
    it('names the submit Stake, with an icon, in the success style', async () => {
        const submit = await readySubmit(mountStake('full'));
        expect(submit.textContent).toBe('Stake');
        expect(submit.querySelector('svg')).not.toBeNull();
        expect(submit.className).toMatch(/success/);
    });

    it('names the watch-only submit Review stake, never Preview', async () => {
        const container = mountStake('watcher');
        await waitFor(() => expect(container.querySelector('button[type="submit"]')?.textContent).toBe('Review stake'));
        const submit = container.querySelector('button[type="submit"]');
        expect(submit.querySelector('svg')).not.toBeNull();
        expect(container.textContent).not.toContain('Preview');
    });

    it('makes the result Done the success action', async () => {
        confirmResult.current = { txid: 'stake-txid' };
        const container = mountStake('full');
        await readySubmit(container);
        const labelFor = (text) => {
            const label = Array.from(container.querySelectorAll('label')).find((node) => node.textContent.includes(text));
            return container.querySelector(`#${CSS.escape(label.getAttribute('for'))}`);
        };
        fireEvent.change(labelFor('Amount'), { target: { value: '25' } });
        fireEvent.change(labelFor('Signing public key'), { target: { value: 'a'.repeat(64) } });
        fireEvent.click(container.querySelector('button[type="submit"]'));
        await waitFor(() => expect(container.textContent).toContain('Stake broadcast'));
        const done = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Done');
        expect(done.className).toMatch(/success/);
    });
});
