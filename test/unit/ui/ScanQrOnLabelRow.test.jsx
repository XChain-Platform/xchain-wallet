// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The transaction scan control is a plain QR icon inside the paste field,
// never a filled button on the label row or in the row below it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PsbtSignForm } from '../../../packages/core/src/shared/routes/PsbtSignForm.jsx';
import { Textarea } from '../../../packages/core/src/ui/Textarea.jsx';

vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        QrScanner: () => <div data-testid="fake-psbt-scanner" />,
    };
});

const BTC = 'bitcoin-regtest';
const ADDRESSES = Object.freeze({
    [BTC]: [{
        id: 'btc-address',
        address: 'bcrt1qexampleexampleexampleexampleexample',
        publicKey: '02aa',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
    }],
});

function messagingFor() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
    };
    return new Proxy(target, {
        get(value, prop) {
            if (prop in value) return value[prop];
            return vi.fn().mockResolvedValue({});
        },
    });
}

function mount() {
    render(
        <MessagingProvider shell="web" messaging={messagingFor()}>
            <PsbtSignForm walletId="wallet" onBack={() => {}} />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
});

describe('Scan transaction sits inside the paste field', () => {
    it('renders an icon-only scan button inside the control and outside the label row', async () => {
        mount();
        const textarea = await screen.findByRole('textbox', { name: 'Unsigned transaction code' });
        const label = document.querySelector(`label[for="${textarea.id}"]`);
        expect(label).not.toBeNull();
        expect(label.textContent).toContain('Unsigned transaction code');

        const scan = screen.getByRole('button', { name: 'Scan transaction' });
        expect(scan.textContent.trim()).toBe('');
        expect(scan.querySelector('svg')).not.toBeNull();
        expect(label.contains(scan)).toBe(false);
        expect(textarea.parentElement.contains(scan)).toBe(true);
        expect(textarea.compareDocumentPosition(scan) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
        expect(scan).toHaveAttribute('aria-pressed', 'false');
        // Not in the row below the box, which keeps the file browse action.
        const browse = screen.getByRole('button', { name: /Browse for \.psbt file/ });
        expect(browse.parentElement.contains(scan)).toBe(false);
    });

    it('toggles the scanner and flips the accessible name', async () => {
        mount();
        await screen.findByRole('textbox', { name: 'Unsigned transaction code' });
        expect(screen.queryByTestId('fake-psbt-scanner')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Scan transaction' }));
        await waitFor(() => expect(screen.getByTestId('fake-psbt-scanner')).toBeTruthy());
        const close = screen.getByRole('button', { name: 'Close scanner' });
        expect(close.textContent.trim()).toBe('');
        expect(close).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(close);
        await waitFor(() => expect(screen.queryByTestId('fake-psbt-scanner')).toBeNull());
        expect(screen.getByRole('button', { name: 'Scan transaction' })).toBeTruthy();
    });
});

describe('Textarea fieldAction slot', () => {
    it('renders the slot inside the control and leaves the bottom actions strip absent', () => {
        render(
            <Textarea
                label="Notes"
                value=""
                onChange={() => {}}
                fieldAction={<button type="button" aria-label="Scan notes" />}
            />,
        );
        const textarea = screen.getByRole('textbox', { name: 'Notes' });
        const label = document.querySelector(`label[for="${textarea.id}"]`);
        const action = screen.getByRole('button', { name: 'Scan notes' });
        expect(label.contains(action)).toBe(false);
        expect(textarea.parentElement.contains(action)).toBe(true);
        expect(textarea.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
        expect(textarea.style.resize).toBe('vertical');
    });
});
