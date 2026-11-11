// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import React from 'react';
import { sha256 } from '@noble/hashes/sha2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
    buildMultisigSessionLink,
    buildReplyEnvelope,
    decodeMultisigEnvelope,
    decodeXcwChunks,
    encodeMultisigEnvelope,
    encodeXcwChunks,
    fingerprintSessionRef,
} from '../../../packages/core/src/uri/index.js';
import { buildUnsignedMultisigSpend } from '../../../packages/core/src/flows/multisigSpend.js';

let messaging;
const clipboardMocks = vi.hoisted(() => ({ copyText: vi.fn() }));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));
vi.mock('../../../packages/core/src/shared/clipboard.js', () => clipboardMocks);

const { isAutoLockHeld } = await import('../../../packages/core/src/shared/hooks/autoLockGuard.js');
const { MultisigSigningSession, buildSessionEnvelope } = await import(
    '../../../packages/core/src/shared/routes/MultisigSigningSession.jsx');

const PK_A = `02${'11'.repeat(32)}`;
const PK_B = `02${'22'.repeat(32)}`;
const PK_C = `02${'33'.repeat(32)}`;
const NOW = '2026-10-13T12:00:00.000Z';

function session(overrides = {}) {
    return {
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
        signatures: [],
        status: 'collecting-sigs',
        finalizedTxHex: null,
        txid: null,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function signature(pubkey) {
    return { pubkey, sig: '30'.repeat(35), contributedAt: NOW };
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

async function mountAndOpen(activeSession) {
    messaging.listMultisigSigningSessions.mockResolvedValue([activeSession]);
    messaging.getMultisigSigningSession.mockResolvedValue(activeSession);
    const view = render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);
    const sessionList = await screen.findByRole('list', { name: 'Multisig sessions' });
    fireEvent.click(within(sessionList).getByRole('button'));
    await screen.findByLabelText('Multisig signing progress');
    return view;
}

beforeEach(() => {
    messaging = {
        listMultisigSigningSessions: vi.fn(),
        getMultisigSigningSession: vi.fn(),
        contributeMultisigNonce: vi.fn().mockResolvedValue(undefined),
        contributeMultisigSignature: vi.fn().mockResolvedValue(undefined),
        aggregateMultisigSession: vi.fn().mockResolvedValue(undefined),
        cancelMultisigSigningSession: vi.fn().mockResolvedValue(undefined),
        finalizeMultisigSigningSession: vi.fn().mockResolvedValue(undefined),
        signMultisigLocally: vi.fn().mockResolvedValue(undefined),
        importMultisigSigningRequest: vi.fn().mockResolvedValue({ sessionId: 'session-1', created: true }),
    };
    clipboardMocks.copyText.mockResolvedValue({ ok: true, native: false });
    Object.defineProperty(globalThis.navigator, 'share', { configurable: true, value: undefined });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Object.defineProperty(globalThis.navigator, 'share', { configurable: true, value: undefined });
});

describe('MultisigSigningSession signing links', () => {
    it('exports a link containing the same envelope as the QR frames', async () => {
        await mountAndOpen(session());
        fireEvent.click(screen.getByRole('button', { name: 'Export signing request' }));

        const link = screen.getByLabelText('Signing link').value;
        const frames = screen.getByLabelText('Signing data to copy').value.split('\n');
        const envelope = decodeMultisigEnvelope(decodeXcwChunks(frames).psbt);
        expect(link).toBe(buildMultisigSessionLink(envelope));
    });

    it('copies through the shared non-sensitive clipboard helper', async () => {
        await mountAndOpen(session());
        fireEvent.click(screen.getByRole('button', { name: 'Export signing request' }));
        const link = screen.getByLabelText('Signing link').value;
        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

        await waitFor(() => expect(clipboardMocks.copyText).toHaveBeenCalledWith(link));
        expect(await screen.findByText('Signing link copied.')).toBeTruthy();
    });

    it('shows Share only when a share sheet exists and passes it the link', async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(globalThis.navigator, 'share', { configurable: true, value: share });
        await mountAndOpen(session());
        fireEvent.click(screen.getByRole('button', { name: 'Export signing request' }));
        const link = screen.getByLabelText('Signing link').value;
        fireEvent.click(screen.getByRole('button', { name: 'Share' }));

        await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: link })));
    });

    it('hides Share when the shell has no share sheet', async () => {
        await mountAndOpen(session());
        fireEvent.click(screen.getByRole('button', { name: 'Export signing request' }));
        expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    });

    it('silently ignores a cancelled share sheet', async () => {
        const share = vi.fn().mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
        Object.defineProperty(globalThis.navigator, 'share', { configurable: true, value: share });
        await mountAndOpen(session());
        fireEvent.click(screen.getByRole('button', { name: 'Export signing request' }));
        fireEvent.click(screen.getByRole('button', { name: 'Share' }));

        await waitFor(() => expect(share).toHaveBeenCalledOnce());
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('imports a pasted signing link and opens the returned session', async () => {
        const activeSession = session();
        messaging.listMultisigSigningSessions.mockResolvedValue([activeSession]);
        messaging.getMultisigSigningSession.mockResolvedValue(activeSession);
        const envelope = buildSessionEnvelope(activeSession);
        const link = buildMultisigSessionLink(envelope);
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);

        fireEvent.change(await screen.findByLabelText('Signing link to open'), { target: { value: link } });
        fireEvent.click(screen.getByRole('button', { name: 'Open signing link' }));

        await waitFor(() => expect(messaging.importMultisigSigningRequest).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            envelope,
        }));
        expect(await screen.findByLabelText('Multisig signing progress')).toBeTruthy();
    });

    it('imports initialLink on mount and shows a plain bad-link error', async () => {
        messaging.listMultisigSigningSessions.mockResolvedValue([]);
        render(<MultisigSigningSession
            walletId="wallet-1"
            onBack={() => {}}
            initialLink="not a signing link"
        />);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'This isn\'t a valid multisig signing link.',
        );
        expect(messaging.importMultisigSigningRequest).not.toHaveBeenCalled();
    });
});

describe('MultisigSigningSession contribution display', () => {
    it('shows decoded payment, change, and fee before the sharing controls', async () => {
        const script = `52${[PK_A, PK_B, PK_C].map((key) => `21${key}`).join('')}53ae`;
        const scriptBytes = Uint8Array.from(script.match(/../g).map((byte) => Number.parseInt(byte, 16)));
        const inputScript = `0020${Buffer.from(sha256(scriptBytes)).toString('hex')}`;
        const { psbtHex } = buildUnsignedMultisigSpend({
            scheme: 'p2wsh-multisig',
            script,
            utxo: { txid: '99'.repeat(32), vout: 1, value: 100000n, scriptPubKeyHex: inputScript },
            outputs: [
                { value: 90000n, scriptPubKeyHex: `76a914${'44'.repeat(20)}88ac` },
                { value: 5000n, scriptPubKeyHex: inputScript },
            ],
        });
        await mountAndOpen(session({ psbtHex }));

        const summary = screen.getByTestId('multisig-spend-summary');
        expect(summary).toHaveTextContent('0.0009 BTC');
        expect(summary).toHaveTextContent('Change back to this multisig');
        expect(summary).toHaveTextContent('Network fee: 0.00005 BTC');
    });

    it('wraps every cosigner public key inside the page', async () => {
        await mountAndOpen(session({ signatures: [signature(PK_A)] }));
        const keys = [
            ...within(screen.getByRole('list', { name: 'Signed cosigners' })).getAllByText(PK_A),
            ...within(screen.getByRole('list', { name: 'Pending cosigners' })).getAllByText(PK_B),
        ];
        expect(keys).toHaveLength(2);
        for (const key of keys) expect(key.className).toMatch(/cosignerKey/);
        const css = readFileSync('packages/core/src/shared/routes/IssueTokenForm.module.css', 'utf8');
        expect(css).toMatch(/\.cosignerKey \{[^}]*overflow-wrap: anywhere/);
    });

    it('starts with the session list without repeating its interaction as lead copy', async () => {
        messaging.listMultisigSigningSessions.mockResolvedValue([session()]);
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);

        expect(await screen.findByRole('list', { name: 'Multisig sessions' })).toBeTruthy();
        expect(screen.queryByText('Pick a session to inspect its contribution state.')).toBeNull();
    });

    it('identifies each signer and states how many signatures remain', async () => {
        await mountAndOpen(session({ signatures: [signature(PK_A)] }));

        expect(screen.getByLabelText('Signatures remaining')).toHaveTextContent(
            '1 more signature required.',
        );
        expect(within(screen.getByRole('list', { name: 'Signed cosigners' })).getByText(PK_A)).toBeTruthy();
        const pending = within(screen.getByRole('list', { name: 'Pending cosigners' }));
        expect(pending.getByText(PK_B)).toBeTruthy();
        expect(pending.getByText(PK_C)).toBeTruthy();
    });

    it('does not claim every cosigner signed when an n-of-m threshold is met', async () => {
        await mountAndOpen(session({
            status: 'ready-to-finalize',
            signatures: [signature(PK_A), signature(PK_B)],
        }));

        expect(screen.getByText('Required signatures collected.')).toBeTruthy();
        expect(screen.getByText(/must be finalized before it can be broadcast/i)).toBeTruthy();
        expect(within(screen.getByRole('list', { name: 'Cosigners who have not signed' }))
            .getByText(PK_C)).toBeTruthy();
        expect(screen.queryByText('All cosigners have contributed.')).toBeNull();
        expect(screen.queryByRole('button', { name: /import/i })).toBeNull();
    });

    it('lists a cosigner once when persisted configuration contains a duplicate key', async () => {
        await mountAndOpen(session({
            cosignerPubkeys: [PK_A, PK_A, PK_B],
            signatures: [signature(PK_A)],
        }));

        const signed = within(screen.getByRole('list', { name: 'Signed cosigners' }));
        expect(signed.getAllByText(PK_A)).toHaveLength(1);
        expect(screen.getByLabelText('Signatures remaining')).toHaveTextContent(
            '1 more signature required.',
        );
        expect(within(screen.getByRole('list', { name: 'Pending cosigners' })).getByText(PK_B)).toBeTruthy();
    });
});

describe('MultisigSigningSession reply transport', () => {
    it('rejects a cosigner signature from a different session with clear copy', async () => {
        const activeSession = session({ signatures: [signature(PK_A)] });
        await mountAndOpen(activeSession);
        fireEvent.click(screen.getByRole('button', { name: 'Import cosigner reply' }));

        const otherRef = {
            chainId: activeSession.chainId,
            scheme: activeSession.scheme,
            threshold: activeSession.threshold,
            cosignerPubkeys: activeSession.cosignerPubkeys,
            msgHash: 'bb'.repeat(32),
            psbtHex: activeSession.psbtHex,
        };
        const reply = buildReplyEnvelope({
            kind: 'multisig-classical-reply',
            fingerprint: fingerprintSessionRef(otherRef),
            contribution: { pubkey: PK_B, sig: '30'.repeat(35) },
        });
        const chunks = encodeXcwChunks(encodeMultisigEnvelope(reply));
        fireEvent.change(screen.getByLabelText('Cosigner reply chunks'), {
            target: { value: chunks.join('\n') },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit chunks' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'This cosigner reply belongs to a different signing session.',
        );
        expect(messaging.contributeMultisigSignature).not.toHaveBeenCalled();
    });

    it('labels MuSig2 partial-signature export and import actions', async () => {
        await mountAndOpen(session({
            scheme: 'taproot-musig2',
            status: 'collecting-sigs',
            aggNonce: '44'.repeat(66),
            partialSigs: [signature(PK_A)],
        }));

        expect(screen.getByRole('button', { name: 'Export signing request' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Export signing request' }));
        expect(screen.getByLabelText('Signing data to copy').value).toMatch(/^XCW:/);
        fireEvent.click(screen.getByRole('button', { name: 'Back to tracker' }));
        fireEvent.click(screen.getByRole('button', { name: 'Import partial signature' }));
        expect(screen.getByText(/partial signature, checks that it belongs to this session and step/i)).toBeTruthy();
    });

    it('imports a partial signature only when it matches the active session', async () => {
        const activeSession = session({
            scheme: 'taproot-musig2',
            status: 'collecting-sigs',
            aggNonce: '44'.repeat(66),
        });
        await mountAndOpen(activeSession);
        fireEvent.click(screen.getByRole('button', { name: 'Import partial signature' }));

        const activeRef = {
            chainId: activeSession.chainId,
            scheme: activeSession.scheme,
            threshold: activeSession.threshold,
            cosignerPubkeys: activeSession.cosignerPubkeys,
            msgHash: activeSession.msgHash,
            psbtHex: activeSession.psbtHex,
        };
        const partialSig = '55'.repeat(32);
        const reply = buildReplyEnvelope({
            kind: 'multisig-round-2-reply',
            fingerprint: fingerprintSessionRef(activeRef),
            contribution: { pubkey: PK_B, sig: partialSig },
        });
        const chunks = encodeXcwChunks(encodeMultisigEnvelope(reply));
        fireEvent.change(screen.getByLabelText('Cosigner reply chunks'), {
            target: { value: chunks.join('\n') },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit chunks' }));

        await waitFor(() => expect(messaging.contributeMultisigSignature).toHaveBeenCalledWith({
            sessionId: activeSession.id,
            pubkey: PK_B,
            signatureHex: partialSig,
        }));
        expect(await screen.findByText(/step 2 signature from .* accepted/i)).toBeTruthy();
    });
});

describe('MultisigSigningSession broadcast readiness', () => {
    it('keeps finalization disabled until distinct cosigners meet the threshold', async () => {
        await mountAndOpen(session({
            status: 'ready-to-finalize',
            signatures: [signature(PK_A), signature(PK_A)],
        }));

        expect(screen.getByLabelText('Multisig signing progress')).toHaveTextContent('1 of 2');
        expect(screen.getByLabelText('Signatures remaining')).toHaveTextContent(
            '1 more signature required.',
        );
        const finalize = screen.getByRole('button', { name: 'Finalize transaction' });
        expect(finalize).toBeDisabled();
        fireEvent.click(finalize);
        expect(messaging.finalizeMultisigSigningSession).not.toHaveBeenCalled();
    });

    it('does not refresh a finalized session after the tracker unmounts', async () => {
        const finalizeRequest = deferred();
        messaging.finalizeMultisigSigningSession.mockReturnValue(finalizeRequest.promise);
        const view = await mountAndOpen(session({
            status: 'ready-to-finalize',
            signatures: [signature(PK_A), signature(PK_B)],
        }));

        fireEvent.click(screen.getByRole('button', { name: 'Finalize transaction' }));
        expect(messaging.finalizeMultisigSigningSession).toHaveBeenCalledTimes(1);
        view.unmount();
        await act(async () => {
            finalizeRequest.resolve(undefined);
            await finalizeRequest.promise;
        });

        expect(messaging.getMultisigSigningSession).toHaveBeenCalledTimes(1);
        expect(messaging.listMultisigSigningSessions).toHaveBeenCalledTimes(1);
    });

    it('holds auto-lock until finalization settles', async () => {
        const finalizeRequest = deferred();
        messaging.finalizeMultisigSigningSession.mockReturnValue(finalizeRequest.promise);
        await mountAndOpen(session({
            status: 'ready-to-finalize',
            signatures: [signature(PK_A), signature(PK_B)],
        }));

        fireEvent.click(screen.getByRole('button', { name: 'Finalize transaction' }));
        expect(isAutoLockHeld()).toBe(true);
        await act(async () => {
            finalizeRequest.resolve(undefined);
            await finalizeRequest.promise;
        });
        expect(isAutoLockHeld()).toBe(false);
    });

    it('marks a finalized transaction ready and hides contribution actions', async () => {
        await mountAndOpen(session({
            status: 'finalized',
            signatures: [signature(PK_A), signature(PK_B)],
            finalizedTxHex: '00',
        }));

        expect(screen.getByText('This signed transaction is ready to broadcast.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Export signed transaction' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /import/i })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Sign with my key' })).toBeNull();
    });
});
