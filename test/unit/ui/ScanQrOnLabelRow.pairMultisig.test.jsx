// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The partner-code and cosigner-reply scan controls are QR icon buttons on
// their paste field's label row. The action row under the form holds only
// the form's own verbs (Pair, or Back, Clear and Submit), never a scan button.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PairPartnerWallet } from '../../../packages/core/src/shared/routes/PairPartnerWallet.jsx';
import { MultisigSigningSession } from '../../../packages/core/src/shared/routes/MultisigSigningSession.jsx';
import { buildPairingPayload, encodePairingPayload } from '../../../packages/core/src/flows/pairPartner.js';
import { encodeXcwChunks } from '../../../packages/core/src/uri/psbtQr.js';

const scanner = { onFrame: null };

vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        QrScanner: ({ onFrame }) => {
            scanner.onFrame = onFrame;
            return <div data-testid="fake-qr-scanner" />;
        },
    };
});

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct-horse-battery';
const PARTNER_CODE = encodePairingPayload(buildPairingPayload({
    walletMode: 'signer',
    label: 'Cold signer',
    keys: [{
        chainId: 'bitcoin-mainnet',
        addressType: 'p2wpkh',
        path: "m/84'/0'/0'",
        publicKey: `02${'11'.repeat(32)}`,
        chainCode: '22'.repeat(32),
        xpub: null,
    }],
}));

const PK_A = `02${'11'.repeat(32)}`;
const PK_B = `02${'22'.repeat(32)}`;
const PK_C = `02${'33'.repeat(32)}`;
const NOW = '2026-10-13T12:00:00.000Z';
const SESSION = Object.freeze({
    schemaVersion: 1,
    id: 'session-1',
    walletId: 'wallet-1',
    chainId: 'bitcoin-mainnet',
    scheme: 'p2wsh-multisig',
    threshold: 2,
    cosignerPubkeys: [PK_A, PK_B, PK_C],
    msgHash: 'aa'.repeat(32),
    psbtHex: '70736274ff',
    actionSummary: 'Send 0.01 BTC',
    nonces: [],
    aggNonce: null,
    partialSigs: [],
    aggregatedSchnorrSig: null,
    signatures: [{ pubkey: PK_A, sig: '30'.repeat(35), contributedAt: NOW }],
    status: 'collecting-sigs',
    finalizedTxHex: null,
    txid: null,
    createdAt: NOW,
    updatedAt: NOW,
});

function proxied(target) {
    return new Proxy(target, {
        get(value, prop) {
            if (prop in value) return value[prop];
            return vi.fn().mockResolvedValue({});
        },
    });
}

function mountWith(messaging, element) {
    render(
        <MessagingProvider shell="web" messaging={proxied(messaging)}>
            {element}
        </MessagingProvider>,
    );
}

function fill(labelRe, value) {
    fireEvent.change(screen.getByLabelText(labelRe), { target: { value } });
}

async function reachExchange() {
    mountWith({
        importMnemonic: vi.fn(async () => ({ wallet: { id: 'w-1' } })),
        pairingPayloadRequest: vi.fn(async () => ({
            encoded: 'XCW-PAIR:ZmFrZQ',
            payload: { keys: [{ chainId: 'bitcoin-mainnet', keyId: 'ab'.repeat(32) }] },
        })),
        pairPartnerRequest: vi.fn(async () => ({ verification: { ok: true, message: 'Paired.' } })),
    }, <PairPartnerWallet />);
    fireEvent.click(screen.getByRole('button', { name: /pair a signer/i }));
    fill(/Shared recovery phrase/i, PHRASE);
    fill(/^Password for this device$/i, PASSWORD);
    fill(/Confirm password/i, PASSWORD);
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    });
}

async function reachPasteInbox() {
    mountWith({
        listMultisigSigningSessions: vi.fn().mockResolvedValue([SESSION]),
        getMultisigSigningSession: vi.fn().mockResolvedValue(SESSION),
    }, <MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);
    const sessionList = await screen.findByRole('list', { name: 'Multisig sessions' });
    fireEvent.click(within(sessionList).getByRole('button'));
    await screen.findByLabelText('Multisig signing progress');
    fireEvent.click(screen.getByRole('button', { name: 'Import cosigner reply' }));
}

/** Asserts the scan control is an icon-only button on the field's label row. */
function expectOnLabelRow(scan, textarea) {
    const label = document.querySelector(`label[for="${textarea.id}"]`);
    expect(label).not.toBeNull();
    expect(scan.textContent.trim()).toBe('');
    expect(scan.querySelector('svg')).not.toBeNull();
    expect(label.parentElement.contains(scan)).toBe(true);
    expect(label.contains(scan)).toBe(false);
    expect(textarea.parentElement.contains(scan)).toBe(true);
}

function buttonNames(container) {
    return within(container).getAllByRole('button').map((b) => b.getAttribute('aria-label') || b.textContent.trim());
}

afterEach(() => {
    cleanup();
    scanner.onFrame = null;
    vi.restoreAllMocks();
});

describe('Pair partner wallet: scan sits on the code field label row', () => {
    it('renders an icon-only scan button beside the field label and keeps it out of the action row', async () => {
        await reachExchange();
        const textarea = screen.getByRole('textbox', { name: /Paste the other wallet's code/i });
        const scan = screen.getByRole('button', { name: "Scan the other wallet's QR" });
        expectOnLabelRow(scan, textarea);

        const pair = screen.getByRole('button', { name: 'Pair a signer' });
        expect(pair.parentElement.contains(scan)).toBe(false);
        expect(buttonNames(pair.parentElement)).toEqual(['Pair a signer']);
    });

    it('toggles the scanner, flips the accessible name and resets the frame collector', async () => {
        await reachExchange();
        expect(screen.queryByTestId('fake-qr-scanner')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: "Scan the other wallet's QR" }));
        expect(screen.getByTestId('fake-qr-scanner')).toBeTruthy();

        const frames = encodeXcwChunks(new TextEncoder().encode(PARTNER_CODE), { chunkBytes: 64 });
        expect(frames.length).toBeGreaterThan(1);
        act(() => { scanner.onFrame(frames[0]); });
        expect(screen.getByText(`Pairing frames received: 1 of ${frames.length}`)).toBeTruthy();

        const stop = screen.getByRole('button', { name: 'Stop scanning' });
        expect(stop.textContent.trim()).toBe('');
        fireEvent.click(stop);
        expect(screen.queryByTestId('fake-qr-scanner')).toBeNull();

        // A re-opened scanner starts from nothing.
        fireEvent.click(screen.getByRole('button', { name: "Scan the other wallet's QR" }));
        expect(screen.getByTestId('fake-qr-scanner')).toBeTruthy();
        expect(screen.queryByText(/Pairing frames received:/)).toBeNull();
    });
});

describe('Multisig cosigner reply: scan sits on the reply field label row', () => {
    it('renders an icon-only scan button beside the field label and keeps it out of the action row', async () => {
        await reachPasteInbox();
        const textarea = screen.getByRole('textbox', { name: 'Cosigner reply chunks' });
        const scan = screen.getByRole('button', { name: 'Scan with camera' });
        expectOnLabelRow(scan, textarea);

        const submit = screen.getByRole('button', { name: 'Submit chunks' });
        expect(submit.parentElement.contains(scan)).toBe(false);
        expect(buttonNames(submit.parentElement)).toEqual([
            'Back to tracker',
            'Clear received reply',
            'Submit chunks',
        ]);
    });

    it('toggles the scanner and flips the accessible name', async () => {
        await reachPasteInbox();
        expect(screen.queryByTestId('fake-qr-scanner')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Scan with camera' }));
        expect(screen.getByTestId('fake-qr-scanner')).toBeTruthy();
        const stop = screen.getByRole('button', { name: 'Stop scanner' });
        expect(stop.textContent.trim()).toBe('');
        fireEvent.click(stop);
        expect(screen.queryByTestId('fake-qr-scanner')).toBeNull();
        expect(screen.getByRole('button', { name: 'Scan with camera' })).toBeTruthy();
    });
});
