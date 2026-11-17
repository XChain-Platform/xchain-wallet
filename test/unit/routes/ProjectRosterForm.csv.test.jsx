// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ProjectRosterForm } from '../../../packages/core/src/shared/routes/ProjectRosterForm.jsx';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, chainIdFilter, onSelect }) => (
        <section aria-label={title}>
            <input aria-label="Token to pick" id="csv-pick-tick" />
            <button
                type="button"
                onClick={() => onSelect({
                    chainId: chainIdFilter,
                    tick: document.getElementById('csv-pick-tick').value,
                })}
            >
                Pick token
            </button>
        </section>
    ),
}));

const CHAIN = 'dogecoin-testnet';
const OWNER = {
    id: 'owner-address',
    address: 'DProjectOwnerAddress',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/3'/0'/0/0",
    source: 'hd',
};

function messagingWith(overrides = {}) {
    return {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: OWNER.id } }),
        getGenesisForToken: vi.fn().mockResolvedValue({ action_index: 77 }),
        getProjectForToken: vi.fn().mockResolvedValue(null),
        getActionFormats: vi.fn().mockResolvedValue(null),
        getTokenInfo: vi.fn().mockResolvedValue({
            creator: OWNER.address,
            totalSupply: '1',
            canonicalTick: 'TOKEN',
        }),
        ...overrides,
    };
}

function mount(messaging = messagingWith()) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ProjectRosterForm
                walletId="wallet-1"
                chainId={CHAIN}
                tick="PROJ"
                issuerAddress={OWNER.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return messaging;
}

async function ready() {
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());
    return screen.getByRole('textbox', { name: /^Tokens/ });
}

async function upload(text, name = 'tokens.csv') {
    fireEvent.change(screen.getByLabelText('Upload tickers file'), {
        target: { files: [new File([text], name, { type: 'text/csv' })] },
    });
    await waitFor(() => expect(screen.getByLabelText('Tickers file (CSV or TXT)')).toHaveValue(name));
}

function addToken(tick) {
    fireEvent.click(screen.getByRole('button', { name: 'Add Token' }));
    fireEvent.change(screen.getByLabelText('Token to pick'), { target: { value: tick } });
    fireEvent.click(screen.getByRole('button', { name: 'Pick token' }));
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ProjectRosterForm CSV import', () => {
    it('adds CSV tokens with the same field placement and preview as token-list creation', async () => {
        mount();
        const box = await ready();
        await upload('AAA,BBB\nCCC');

        expect(box).toHaveValue('AAA,BBB\nCCC');
        const fileField = screen.getByLabelText('Tickers file (CSV or TXT)').closest('[data-file-field]');
        expect(fileField.previousElementSibling).toContainElement(box);
        expect(screen.getByRole('button', { name: 'Add Token' }).parentElement.previousElementSibling).toBe(fileField);

        const preview = screen.getByRole('list', { name: 'Token order' });
        expect(within(preview).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
            expect.stringContaining('AAA'),
            expect.stringContaining('BBB'),
            expect.stringContaining('CCC'),
        ]);
    });

    it('skips CSV duplicates against picked and uploaded tokens', async () => {
        mount();
        await ready();
        addToken('AAA');
        await upload('aaa,BBB,BBB');

        expect(screen.getByText(/2 valid token names · 2 duplicates ignored/)).toBeTruthy();
        const preview = screen.getByRole('list', { name: 'Token order' });
        expect(within(preview).getAllByRole('listitem')).toHaveLength(2);

        fireEvent.click(screen.getByRole('button', { name: 'Create and Link' }));
        const reviewed = await screen.findByRole('list', { name: 'Tokens' });
        const reviewedRows = within(reviewed).getAllByRole('listitem');
        expect(reviewedRows).toHaveLength(2);
        expect(reviewedRows[0]).toHaveTextContent('AAA');
        expect(reviewedRows[1]).toHaveTextContent('BBB');
    });

    it('shows the shared per-row parser error and blocks review for bad CSV rows', async () => {
        mount();
        await ready();
        await upload('GOOD\nbad token');

        expect(screen.getByText(/1 valid token name · 1 invalid/)).toBeTruthy();
        expect(screen.getByText('Not a token name: bad token')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Create and Link' }));
        expect((await screen.findAllByText("These don't look like token names: bad token")).length).toBe(2);
        expect(screen.queryByRole('form', { name: 'Review official token list' })).toBeNull();
        expect(screen.getByRole('textbox', { name: /^Tokens/ })).toHaveAttribute('aria-invalid', 'true');
    });

    it('enforces the shared 8,192-byte LIST limit before review', async () => {
        mount();
        await ready();
        const longTicks = Array.from(
            { length: 34 },
            (_, index) => `${String(index).padStart(3, '0')}${'A'.repeat(247)}`,
        );
        await upload(longTicks.join('\n'), 'large.csv');
        fireEvent.click(screen.getByRole('button', { name: 'Create and Link' }));

        expect((await screen.findAllByText(/This list has 34 tokens \(8,\d{3} bytes\), but one action holds 8,192 bytes, which fits 32 of them\. Remove 2 tokens\./))).toHaveLength(2);
        expect(screen.queryByRole('form', { name: 'Review official token list' })).toBeNull();
    });

    it('keeps Add Token working beside the CSV path', async () => {
        mount();
        await ready();
        addToken('PICKED');

        expect(screen.getByRole('textbox', { name: /^Tokens/ })).toHaveValue('PICKED');
        expect(screen.getByRole('list', { name: 'Token order' })).toHaveTextContent('PICKED');
    });
});
