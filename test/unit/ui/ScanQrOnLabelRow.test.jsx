// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The transaction scan control is a QR icon button on the field's label row,
// never a text button inside the paste box or in the row below it.

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

/** True when node a comes before node b in document order. */
function precedes(a, b) {
    return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

afterEach(() => {
    cleanup();
});

describe('Scan transaction sits on the paste field label row', () => {
    it('renders an icon-only scan button beside the label, outside the box and the row below', async () => {
        mount();
        const textarea = await screen.findByRole('textbox', { name: 'Unsigned transaction code' });
        const label = document.querySelector(`label[for="${textarea.id}"]`);
        expect(label).not.toBeNull();
        expect(label.textContent).toContain('Unsigned transaction code');

        const scan = screen.getByRole('button', { name: 'Scan transaction' });
        expect(scan.textContent.trim()).toBe('');
        expect(scan.querySelector('svg')).not.toBeNull();
        expect(label.parentElement.contains(scan)).toBe(true);
        expect(label.contains(scan)).toBe(false);

        // Not drawn inside the box or under it: the control precedes the
        // textarea in document order and no in-box actions wrapper exists.
        expect(precedes(scan, textarea)).toBe(true);
        expect(textarea.parentElement.contains(label)).toBe(true);
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
        fireEvent.click(close);
        await waitFor(() => expect(screen.queryByTestId('fake-psbt-scanner')).toBeNull());
        expect(screen.getByRole('button', { name: 'Scan transaction' })).toBeTruthy();
    });
});

describe('Textarea labelAction slot', () => {
    it('renders the slot on the label row and leaves the box without an actions strip', () => {
        render(
            <Textarea
                label="Notes"
                value=""
                onChange={() => {}}
                labelAction={<button type="button" aria-label="Scan notes" />}
            />,
        );
        const textarea = screen.getByRole('textbox', { name: 'Notes' });
        const label = document.querySelector(`label[for="${textarea.id}"]`);
        const action = screen.getByRole('button', { name: 'Scan notes' });
        expect(label.parentElement.contains(action)).toBe(true);
        expect(label.contains(action)).toBe(false);
        // No in-box actions wrapper: the textarea sits directly in the field
        // column beside the label row, and the slot precedes it.
        expect(textarea.parentElement.contains(label)).toBe(true);
        expect(precedes(action, textarea)).toBe(true);
        expect(textarea.style.resize).toBe('vertical');
    });
});
