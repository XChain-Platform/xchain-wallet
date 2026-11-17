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
const { MultisigSigningSession, buildSessionEnvelope, groupSigningSessions } = await import(
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

// The session view opens on Actions (G102); who signed and who is pending
// sit under Details.
function openDetails() {
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
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
        fireEvent.click(screen.getByRole('button', { name: /^Export signing request/ }));

        const link = screen.getByLabelText('Signing link').value;
        const frames = screen.getByLabelText('Signing data to copy').value.split('\n');
        const envelope = decodeMultisigEnvelope(decodeXcwChunks(frames).psbt);
        expect(link).toBe(buildMultisigSessionLink(envelope));
    });

    it('copies through the shared non-sensitive clipboard helper', async () => {
        await mountAndOpen(session());
        fireEvent.click(screen.getByRole('button', { name: /^Export signing request/ }));
        const link = screen.getByLabelText('Signing link').value;
        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

        await waitFor(() => expect(clipboardMocks.copyText).toHaveBeenCalledWith(link));
        expect(await screen.findByText('Signing link copied.')).toBeTruthy();
    });

    it('shows Share only when a share sheet exists and passes it the link', async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(globalThis.navigator, 'share', { configurable: true, value: share });
        await mountAndOpen(session());
        fireEvent.click(screen.getByRole('button', { name: /^Export signing request/ }));
        const link = screen.getByLabelText('Signing link').value;
        fireEvent.click(screen.getByRole('button', { name: 'Share' }));

        await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: link })));
    });

    it('hides Share when the shell has no share sheet', async () => {
        await mountAndOpen(session());
        fireEvent.click(screen.getByRole('button', { name: /^Export signing request/ }));
        expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    });

    it('silently ignores a cancelled share sheet', async () => {
        const share = vi.fn().mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
        Object.defineProperty(globalThis.navigator, 'share', { configurable: true, value: share });
        await mountAndOpen(session());
        fireEvent.click(screen.getByRole('button', { name: /^Export signing request/ }));
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

        // The link field sits behind the Open a signing link header button.
        expect(screen.queryByLabelText('Signing link to open')).toBeNull();
        fireEvent.click(await screen.findByRole('button', { name: /Open a signing link/ }));
        fireEvent.change(await screen.findByLabelText('Signing link to open'), { target: { value: link } });
        fireEvent.click(screen.getByRole('button', { name: 'Open Signing Link' }));

        await waitFor(() => expect(messaging.importMultisigSigningRequest).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            envelope,
        }));
        expect(await screen.findByLabelText('Multisig signing progress')).toBeTruthy();
    });

    it('opens initialLink on the Open Signing Link page and marks a bad link on its field', async () => {
        messaging.listMultisigSigningSessions.mockResolvedValue([]);
        render(<MultisigSigningSession
            walletId="wallet-1"
            onBack={() => {}}
            initialLink="not a signing link"
        />);

        expect(await screen.findByRole('heading', { level: 1, name: 'Open Signing Link' })).toBeTruthy();
        const field = screen.getByLabelText('Signing link to open');
        expect(field).toHaveValue('not a signing link');
        await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
        const fieldError = document.getElementById(`${field.id}-error`);
        expect(fieldError).toHaveTextContent('This isn\'t a valid multisig signing link.');
        expect(messaging.importMultisigSigningRequest).not.toHaveBeenCalled();
    });
});

describe('MultisigSigningSession Open Signing Link page', () => {
    async function openLinkPage() {
        messaging.listMultisigSigningSessions.mockResolvedValue([session()]);
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);
        await screen.findByRole('list', { name: 'Multisig sessions' });
        fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Open a signing link' }));
        return screen.findByRole('heading', { level: 1, name: 'Open Signing Link' });
    }

    it('keeps the link field off the sessions list', async () => {
        messaging.listMultisigSigningSessions.mockResolvedValue([session()]);
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);
        await screen.findByRole('list', { name: 'Multisig sessions' });
        expect(screen.queryByLabelText('Signing link to open')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Open Signing Link' })).toBeNull();
    });

    it('opens its own page from the header button, with Back, the field and the action', async () => {
        await openLinkPage();

        // The list is gone: this is a page of its own, not a block under it.
        expect(screen.queryByRole('list', { name: 'Multisig sessions' })).toBeNull();
        expect(screen.getByLabelText('Signing link to open')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Scan a signing link' })).toBeTruthy();
        const open = screen.getByRole('button', { name: 'Open Signing Link' });
        expect(open).toHaveAttribute('type', 'submit');
        expect(open).not.toBeDisabled();
        expect(within(screen.getByRole('banner')).getByRole('button', { name: /back/i })).toBeTruthy();
    });

    it('Back returns to the sessions list', async () => {
        await openLinkPage();
        fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: /back/i }));

        expect(await screen.findByRole('list', { name: 'Multisig sessions' })).toBeTruthy();
        expect(screen.queryByLabelText('Signing link to open')).toBeNull();
        expect(screen.getByRole('heading', { level: 1, name: 'Multisig Sessions' })).toBeTruthy();
    });

    it('marks an empty field and an invalid link on the field, under the form error notice', async () => {
        await openLinkPage();
        const field = screen.getByLabelText('Signing link to open');

        fireEvent.click(screen.getByRole('button', { name: 'Open Signing Link' }));
        await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
        expect(document.getElementById(`${field.id}-error`)).toHaveTextContent('Paste or scan a signing link to open.');
        expect(document.querySelector('[data-form-errors]')).toHaveTextContent('Paste or scan a signing link to open.');

        fireEvent.change(field, { target: { value: 'xchain://multisig-sign' } });
        // Changing the field clears its mark until the next press.
        await waitFor(() => expect(field).not.toHaveAttribute('aria-invalid', 'true'));
        fireEvent.click(screen.getByRole('button', { name: 'Open Signing Link' }));
        await waitFor(() => expect(document.getElementById(`${field.id}-error`))
            .toHaveTextContent('This signing link doesn\'t contain a signing request.'));
        expect(field).toHaveAttribute('aria-invalid', 'true');
        expect(messaging.importMultisigSigningRequest).not.toHaveBeenCalled();
    });

    it('shows a failed open as the form error, not the field, and stays on the page', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        const activeSession = session();
        const link = buildMultisigSessionLink(buildSessionEnvelope(activeSession));
        // The host answers without a session: a failure of the open, not of the link.
        messaging.importMultisigSigningRequest.mockResolvedValue({});
        await openLinkPage();

        const field = screen.getByLabelText('Signing link to open');
        fireEvent.change(field, { target: { value: link } });
        fireEvent.click(screen.getByRole('button', { name: 'Open Signing Link' }));

        await waitFor(() => expect(document.querySelector('[data-form-errors]'))
            .toHaveTextContent('This signing link couldn\'t be opened.'));
        expect(field).not.toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('heading', { level: 1, name: 'Open Signing Link' })).toBeTruthy();
        expect(logged).toHaveBeenCalled();
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
        openDetails();
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
        openDetails();
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
        expect(screen.queryByRole('button', { name: /import/i })).toBeNull();
        openDetails();
        expect(within(screen.getByRole('list', { name: 'Cosigners who have not signed' }))
            .getByText(PK_C)).toBeTruthy();
        expect(screen.queryByText('All cosigners have contributed.')).toBeNull();
    });

    it('lists a cosigner once when persisted configuration contains a duplicate key', async () => {
        await mountAndOpen(session({
            cosignerPubkeys: [PK_A, PK_A, PK_B],
            signatures: [signature(PK_A)],
        }));

        openDetails();
        const signed = within(screen.getByRole('list', { name: 'Signed cosigners' }));
        expect(signed.getAllByText(PK_A)).toHaveLength(1);
        expect(screen.getByLabelText('Signatures remaining')).toHaveTextContent(
            '1 more signature required.',
        );
        expect(within(screen.getByRole('list', { name: 'Pending cosigners' })).getByText(PK_B)).toBeTruthy();
    });
});

describe('MultisigSigningSession reply transport', () => {
    it('reports empty reply chunks on the field and sends nothing', async () => {
        await mountAndOpen(session());
        fireEvent.click(screen.getByRole('button', { name: /^Import cosigner reply/ }));

        const submit = screen.getByRole('button', { name: 'Submit Chunks' });
        expect(submit).not.toBeDisabled();
        fireEvent.click(submit);

        await waitFor(() => expect(document.querySelector('[data-form-errors]'))
            .toHaveTextContent('Paste or scan the cosigner reply chunks.'));
        expect(screen.getByLabelText('Cosigner reply chunks')).toHaveAttribute('aria-invalid', 'true');
        expect(messaging.contributeMultisigSignature).not.toHaveBeenCalled();
    });

    it('reports an empty local-signing password and does not sign', async () => {
        await mountAndOpen(session());
        fireEvent.click(screen.getByRole('button', { name: /^Sign with my key/ }));

        const submit = screen.getByRole('button', { name: 'Sign with My Key' });
        expect(submit).not.toBeDisabled();
        fireEvent.click(submit);

        await waitFor(() => expect(document.querySelector('[data-form-errors]'))
            .toHaveTextContent('Enter your wallet password to sign.'));
        expect(screen.getByLabelText('Wallet password')).toHaveAttribute('aria-invalid', 'true');
        expect(messaging.signMultisigLocally).not.toHaveBeenCalled();
    });

    it('rejects a cosigner signature from a different session with clear copy', async () => {
        const activeSession = session({ signatures: [signature(PK_A)] });
        await mountAndOpen(activeSession);
        fireEvent.click(screen.getByRole('button', { name: /^Import cosigner reply/ }));

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
        fireEvent.click(screen.getByRole('button', { name: 'Submit Chunks' }));

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

        expect(screen.getByRole('button', { name: /^Export signing request/ })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /^Export signing request/ }));
        expect(screen.getByLabelText('Signing data to copy').value).toMatch(/^XCW:/);
        fireEvent.click(screen.getByRole('button', { name: 'Back to Tracker' }));
        fireEvent.click(screen.getByRole('button', { name: /^Import partial signature/ }));
        expect(screen.getByText(/partial signature, checks that it belongs to this session and step/i)).toBeTruthy();
    });

    it('imports a partial signature only when it matches the active session', async () => {
        const activeSession = session({
            scheme: 'taproot-musig2',
            status: 'collecting-sigs',
            aggNonce: '44'.repeat(66),
        });
        await mountAndOpen(activeSession);
        fireEvent.click(screen.getByRole('button', { name: /^Import partial signature/ }));

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
        fireEvent.click(screen.getByRole('button', { name: 'Submit Chunks' }));

        await waitFor(() => expect(messaging.contributeMultisigSignature).toHaveBeenCalledWith({
            sessionId: activeSession.id,
            pubkey: PK_B,
            signatureHex: partialSig,
        }));
        expect(await screen.findByText(/step 2 signature from .* accepted/i)).toBeTruthy();
    });
});

describe('MultisigSigningSession broadcast readiness', () => {
    it('refuses finalization with a notice until distinct cosigners meet the threshold', async () => {
        await mountAndOpen(session({
            status: 'ready-to-finalize',
            signatures: [signature(PK_A), signature(PK_A)],
        }));

        expect(screen.getByLabelText('Multisig signing progress')).toHaveTextContent('1 of 2');
        expect(screen.getByLabelText('Signatures remaining')).toHaveTextContent(
            '1 more signature required.',
        );
        const finalize = screen.getByRole('button', { name: 'Finalize Transaction' });
        expect(finalize).not.toBeDisabled();
        fireEvent.click(finalize);
        await waitFor(() => expect(document.querySelector('[data-form-errors]'))
            .toHaveTextContent('Collect enough distinct cosigner signatures before finalizing.'));
        expect(messaging.finalizeMultisigSigningSession).not.toHaveBeenCalled();
    });

    it('does not refresh a finalized session after the tracker unmounts', async () => {
        const finalizeRequest = deferred();
        messaging.finalizeMultisigSigningSession.mockReturnValue(finalizeRequest.promise);
        const view = await mountAndOpen(session({
            status: 'ready-to-finalize',
            signatures: [signature(PK_A), signature(PK_B)],
        }));

        fireEvent.click(screen.getByRole('button', { name: 'Finalize Transaction' }));
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

        fireEvent.click(screen.getByRole('button', { name: 'Finalize Transaction' }));
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
        expect(screen.getByRole('button', { name: /^Export signed transaction/ })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /import/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Sign with my key/i })).toBeNull();
    });
});

describe('MultisigSigningSession sessions list', () => {
    const listedTitles = () => within(screen.getByRole('list', { name: 'Multisig sessions' }))
        .getAllByRole('button')
        .map((row) => row.querySelector('[class*="title"]').textContent);

    it('sorts sessions into the Ready, Waiting and Done tabs, opening on Ready', async () => {
        messaging.listMultisigSigningSessions.mockResolvedValue([
            session({ id: 'wait', actionSummary: 'Send 0.25 BTC to bc1qdestination', signatures: [signature(PK_A)], localPubkeys: [PK_A] }),
            session({ id: 'mine', actionSummary: 'Send 2 BTC', signatures: [signature(PK_A)], localPubkeys: [PK_B], updatedAt: '2026-10-13T13:00:00.000Z' }),
            session({ id: 'ready', actionSummary: 'Send 0.5 BTC', status: 'finalized', finalizedTxHex: '00' }),
            session({ id: 'sent', actionSummary: 'Send 0.1 BTC', status: 'broadcast' }),
            session({ id: 'gone', actionSummary: 'Send 5 BTC', status: 'cancelled' }),
        ]);
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);

        await screen.findByRole('list', { name: 'Multisig sessions' });
        const tablist = screen.getByRole('tablist', { name: 'Session views' });
        const tabs = within(tablist).getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Ready', 'Waiting', 'Done']);
        expect(within(tablist).getByRole('tab', { name: 'Ready' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tabpanel', { name: 'Ready' })).toBeTruthy();

        // Ready: waiting on your signature (newest first), then ready to send.
        expect(listedTitles()).toEqual(['Send 2 BTC', 'Send 0.5 BTC']);
        expect(screen.getByText('Send now')).toBeTruthy();

        // Waiting: you signed, the other cosigners have not. The destination
        // stays on the session page; the row shows the action.
        fireEvent.click(within(tablist).getByRole('tab', { name: 'Waiting' }));
        expect(within(tablist).getByRole('tab', { name: 'Waiting' })).toHaveAttribute('aria-selected', 'true');
        expect(listedTitles()).toEqual(['Send 0.25 BTC']);
        const waiting = screen.getByRole('list', { name: 'Multisig sessions' });
        expect(within(waiting).getByText('1 of 2')).toBeTruthy();
        expect(within(waiting).getByText(/^2 of 3 SegWit · /)).toBeTruthy();

        // Done: sent and cancelled, listed in full with no fold.
        fireEvent.click(within(tablist).getByRole('tab', { name: 'Done' }));
        expect(listedTitles().sort()).toEqual(['Send 0.1 BTC', 'Send 5 BTC']);
        const done = screen.getByRole('list', { name: 'Multisig sessions' });
        expect(within(done).getByText('Sent')).toBeTruthy();
        expect(within(done).getByText('Cancelled')).toBeTruthy();
        expect(document.querySelector('[aria-expanded]')).toBeNull();
        expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    });

    it('opens on the first tab with sessions when Ready has none', async () => {
        messaging.listMultisigSigningSessions.mockResolvedValue([
            session({ id: 'sent', actionSummary: 'Send 0.1 BTC', status: 'broadcast' }),
        ]);
        const view = render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);
        await screen.findByRole('list', { name: 'Multisig sessions' });
        expect(screen.getByRole('tab', { name: 'Done' })).toHaveAttribute('aria-selected', 'true');
        expect(listedTitles()).toEqual(['Send 0.1 BTC']);
        view.unmount();

        // A session that names no key of this wallet waits on the others.
        messaging.listMultisigSigningSessions.mockResolvedValue([
            session({ id: 'wait', actionSummary: 'Send 0.25 BTC', signatures: [signature(PK_A)] }),
            session({ id: 'sent', actionSummary: 'Send 0.1 BTC', status: 'broadcast' }),
        ]);
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);
        await screen.findByRole('list', { name: 'Multisig sessions' });
        expect(screen.getByRole('tab', { name: 'Waiting' })).toHaveAttribute('aria-selected', 'true');
        expect(listedTitles()).toEqual(['Send 0.25 BTC']);
    });

    it('gives each empty tab its own line', async () => {
        messaging.listMultisigSigningSessions.mockResolvedValue([
            session({ id: 'sent', actionSummary: 'Send 0.1 BTC', status: 'broadcast' }),
        ]);
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);
        await screen.findByRole('list', { name: 'Multisig sessions' });

        fireEvent.click(screen.getByRole('tab', { name: 'Ready' }));
        expect(screen.queryByRole('list', { name: 'Multisig sessions' })).toBeNull();
        expect(screen.getByText('Nothing to sign or send')).toBeTruthy();
        expect(screen.getByText(/need your signature, or are signed and ready to send/)).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: 'Waiting' }));
        expect(screen.getByText('Not waiting on anyone')).toBeTruthy();
        expect(screen.getByText(/waiting on other cosigners/)).toBeTruthy();
        expect(screen.queryByText('Nothing to sign or send')).toBeNull();
        // The page-wide empty state is only for a wallet with no sessions.
        expect(screen.queryByText('No Signing Sessions')).toBeNull();
    });

    it('shows the Done tab empty line when nothing has finished', async () => {
        messaging.listMultisigSigningSessions.mockResolvedValue([session({ id: 'wait' })]);
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);
        await screen.findByRole('list', { name: 'Multisig sessions' });
        fireEvent.click(screen.getByRole('tab', { name: 'Done' }));
        expect(screen.getByText('No finished sessions')).toBeTruthy();
        expect(screen.getByText('Sent and cancelled sessions appear here.')).toBeTruthy();
    });

    it('puts a session in Ready when this wallet\'s key has not answered the current step', () => {
        const nonce = (pubkey) => ({ pubkey, publicNonce: '66'.repeat(66), contributedAt: NOW });
        const ids = (group) => group.map((s) => s.id);
        const grouped = groupSigningSessions([
            // Taproot step 1: you replied, so it waits on the others.
            session({ id: 'step1-replied', scheme: 'taproot-musig2', status: 'collecting-nonces', nonces: [nonce(PK_A)], localPubkeys: [PK_A] }),
            // Taproot step 1: you have not replied.
            session({ id: 'step1-yours', scheme: 'taproot-musig2', status: 'collecting-nonces', nonces: [nonce(PK_A)], localPubkeys: [PK_B] }),
            // Taproot step 2: your partial signature is still missing.
            session({ id: 'step2-yours', scheme: 'taproot-musig2', status: 'collecting-sigs', aggNonce: '44'.repeat(66), partialSigs: [signature(PK_B)], localPubkeys: [PK_A] }),
            session({ id: 'to-finalize', status: 'ready-to-finalize', signatures: [signature(PK_A), signature(PK_B)] }),
            session({ id: 'unmarked', signatures: [] }),
            session({ id: 'cancelled', status: 'cancelled' }),
        ]);
        expect(ids(grouped.ready).sort()).toEqual(['step1-yours', 'step2-yours', 'to-finalize']);
        expect(ids(grouped.waiting).sort()).toEqual(['step1-replied', 'unmarked']);
        expect(ids(grouped.done)).toEqual(['cancelled']);
    });

    it('draws each session as a standard ListRow, with its chevron, inside one list card', async () => {
        messaging.listMultisigSigningSessions.mockResolvedValue([
            session({ id: 'a', actionSummary: 'Send 0.25 BTC', signatures: [signature(PK_A)] }),
            session({ id: 'b', actionSummary: 'Send 0.5 BTC', signatures: [signature(PK_B)] }),
        ]);
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);

        const list = await screen.findByRole('list', { name: 'Multisig sessions' });
        expect(list.className).toMatch(/(^|[\s_])list(_|\s|$)/);
        const items = within(list).getAllByRole('listitem');
        expect(items).toHaveLength(2);
        for (const item of items) {
            const row = within(item).getByRole('button');
            // ListRow's row: network icon, title, subtitle, status pill, chevron.
            expect(row.className).toMatch(/(^|[\s_])row(_|\s|$)/);
            expect(row.querySelector('[class*="leading"]')).toBeTruthy();
            expect(row.querySelector('[class*="title"]').textContent).toMatch(/^Send /);
            expect(row.querySelector('[class*="subtitle"]').textContent).toMatch(/^2 of 3 SegWit · /);
            expect(row.querySelector('[class*="trailing"]').textContent).toBe('1 of 2');
            const chevron = row.querySelector('[class*="chevron"]');
            expect(chevron).toHaveAttribute('aria-hidden', 'true');
            expect(chevron.querySelector('svg')).toBeTruthy();
        }

        // The card is the shared flush card, rows split by divider lines.
        const css = readFileSync('packages/core/src/shared/routes/MultisigSigningSession.module.css', 'utf8');
        expect(css).toMatch(/\.list \{[^}]*composes: flush from '\.\.\/\.\.\/ui\/Card\.module\.css'/);
        expect(css).toMatch(/\.list > li \+ li \{[^}]*border-top/);
        expect(css).not.toMatch(/doneToggle|groupHeading/);
    });

    it('keeps the picked tab when the user returns from a session', async () => {
        const sent = session({ id: 'sent', actionSummary: 'Send 0.1 BTC', status: 'broadcast' });
        messaging.listMultisigSigningSessions.mockResolvedValue([
            session({ id: 'wait', actionSummary: 'Send 0.25 BTC', signatures: [signature(PK_A)] }),
            sent,
        ]);
        messaging.getMultisigSigningSession.mockResolvedValue(sent);
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);
        await screen.findByRole('list', { name: 'Multisig sessions' });
        // Waiting is the default here; Done is the user's pick.
        expect(screen.getByRole('tab', { name: 'Waiting' })).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByRole('tab', { name: 'Done' }));
        fireEvent.click(within(screen.getByRole('list', { name: 'Multisig sessions' })).getByRole('button'));
        await screen.findByLabelText('Multisig signing progress');
        fireEvent.click(screen.getByRole('button', { name: 'Back to Sessions' }));
        expect(await screen.findByRole('tab', { name: 'Done' })).toHaveAttribute('aria-selected', 'true');
        expect(listedTitles()).toEqual(['Send 0.1 BTC']);
    });

    it('starts a session from the plus: pick the multisig, then Send, then the send form', async () => {
        const multisig = {
            multisigConfigId: 'ms-1', address: 'bc1qmultisigaddress', scheme: 'p2wsh-multisig',
            threshold: 2, cosignerCount: 3, overCeiling: false,
        };
        const started = session({ id: 'new-session', actionSummary: 'Send 0.001 BTC to bc1qdest' });
        messaging.listMultisigSigningSessions.mockResolvedValue([]);
        messaging.getMultisigSigningSession.mockResolvedValue(started);
        messaging.getAddressesByChain = vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [{ id: 'a' }] });
        messaging.listMultisigReceiveAddresses = vi.fn().mockResolvedValue([
            multisig,
            { ...multisig, multisigConfigId: 'ms-2', address: null, overCeiling: true },
        ]);
        messaging.startMultisigSend = vi.fn().mockResolvedValue({ id: 'new-session' });
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);

        fireEvent.click(await screen.findByRole('button', { name: 'Start a Signing Session' }));
        const multisigs = await screen.findByRole('list', { name: 'Multisigs on this network' });
        expect(messaging.listMultisigReceiveAddresses).toHaveBeenCalledWith({ walletId: 'wallet-1', chainId: 'bitcoin-mainnet' });
        // A multisig with no spendable address is listed but cannot be picked.
        expect(within(multisigs).getAllByRole('button')).toHaveLength(1);
        fireEvent.click(within(multisigs).getByRole('button'));

        fireEvent.click(within(await screen.findByRole('list', { name: 'Actions' })).getByRole('button', { name: /Send/ }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Send from Multisig' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Start Signing' })).toBeTruthy();
    });

    it('puts Open a signing link and Start a signing session in the header, with no body row', async () => {
        messaging.listMultisigSigningSessions.mockResolvedValue([session()]);
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);
        await screen.findByRole('list', { name: 'Multisig sessions' });
        const header = screen.getByRole('banner');
        const open = within(header).getByRole('button', { name: 'Open a signing link' });
        const start = within(header).getByRole('button', { name: 'Start a Signing Session' });
        expect(open.querySelector('svg')).toBeTruthy();
        expect(start.querySelector('svg')).toBeTruthy();
        // Exactly one control with that name, and none in the body.
        expect(screen.getAllByRole('button', { name: /Open a signing link/ })).toHaveLength(1);
        expect(screen.queryByText('Paste or scan.')).toBeNull();
        fireEvent.click(open);
        expect(await screen.findByLabelText('Signing link to open')).toBeTruthy();
        const css = readFileSync('packages/core/src/shared/routes/MultisigSigningSession.module.css', 'utf8');
        expect(css).not.toMatch(/openLinkRow/);
    });

    it('names both header buttons in the empty state', async () => {
        messaging.listMultisigSigningSessions.mockResolvedValue([]);
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);
        expect(await screen.findByText(/plus button.*link button/)).toBeTruthy();
    });
});

describe('MultisigSigningSession actions (G101, G102)', () => {
    it('opens on Actions, first and chosen, with the session actions as one action list', async () => {
        await mountAndOpen(session());

        const tabs = screen.getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Actions', 'Details']);
        expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
        const list = screen.getByRole('list', { name: 'Actions' });
        const rows = within(list).getAllByRole('button');
        expect(rows.map((row) => row.textContent)).toEqual([
            expect.stringMatching(/^Export signing requestShow the QR and link/),
            expect.stringMatching(/^Import cosigner replyScan or paste/),
            expect.stringMatching(/^Sign with my keyAdd this wallet's signature/),
            expect.stringMatching(/^Cancel sessionClose this session/),
        ]);
        // Cancel is the red row; the others keep the default tone.
        expect(within(list).getByRole('button', { name: /^Cancel session/ })).toHaveAttribute('data-tone', 'danger');
        expect(within(list).getByRole('button', { name: /^Export signing request/ })).toHaveAttribute('data-tone', 'default');
        // Back to the list stays the page's step-back button, not a row.
        expect(within(list).queryByRole('button', { name: /Back to Sessions/i })).toBeNull();
        expect(screen.getByRole('button', { name: 'Back to Sessions' })).toBeTruthy();
    });

    it('runs each row through its handler: the step views open, Cancel cancels', async () => {
        await mountAndOpen(session());

        fireEvent.click(screen.getByRole('button', { name: /^Export signing request/ }));
        expect(screen.getByLabelText('Signing data to copy')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Back to Tracker' }));

        fireEvent.click(screen.getByRole('button', { name: /^Import cosigner reply/ }));
        expect(screen.getByLabelText('Cosigner reply chunks')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Back to Tracker' }));

        fireEvent.click(screen.getByRole('button', { name: /^Sign with my key/ }));
        expect(screen.getByLabelText('Wallet password')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Back to Tracker' }));

        fireEvent.click(screen.getByRole('button', { name: /^Cancel session/ }));
        await waitFor(() => expect(messaging.cancelMultisigSigningSession)
            .toHaveBeenCalledWith({ sessionId: 'session-1' }));
    });

    it('keeps Finalize as the one green main button above the list', async () => {
        await mountAndOpen(session({
            status: 'ready-to-finalize',
            signatures: [signature(PK_A), signature(PK_B)],
        }));

        const finalize = screen.getByRole('button', { name: 'Finalize Transaction' });
        const list = screen.getByRole('list', { name: 'Actions' });
        expect(within(list).queryByRole('button', { name: /Finalize/ })).toBeNull();
        expect(finalize.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('keeps the plain layout, without the toggle, when a session has no actions left', async () => {
        const cancelled = session({ status: 'cancelled' });
        messaging.listMultisigSigningSessions.mockResolvedValue([cancelled]);
        messaging.getMultisigSigningSession.mockResolvedValue(cancelled);
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} initialSessionId="session-1" />);
        await screen.findByLabelText('Multisig signing progress');

        expect(screen.queryByRole('tab')).toBeNull();
        expect(screen.queryByRole('list', { name: 'Actions' })).toBeNull();
        expect(screen.getByRole('list', { name: 'Pending cosigners' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Back to Sessions' })).toBeTruthy();
    });
});
