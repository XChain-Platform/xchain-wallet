// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Behavioural test for the §20.5 two-phone pairing lane, "Use another phone
// as a signer" in Settings, Advanced.
//
// Drives the real component through role -> seed -> exchange -> done and
// asserts the wiring that the flow-level unit test cannot see: that the
// shared phrase is ADDED to the open vault under its own password, that the
// picked role reaches the host on every pairing request (the payload's mode
// is what the partner's complement check reads), that the added walletId is
// threaded through, and that a failed pairing surfaces the host's reason
// instead of silently advancing.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import React from 'react';
import { PairPartnerWallet } from '../../../packages/core/src/shared/routes/PairPartnerWallet.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import {
    buildPairingPayload,
    encodePairingPayload,
} from '../../../packages/core/src/flows/pairPartner.js';
import { encodeXcwChunks } from '../../../packages/core/src/uri/psbtQr.js';
import { setNativeQrScanner } from '../../../packages/core/src/ui/nativeQrScanner.js';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const LEGACY_PHRASE = 'explode gaze wolf admit nice charm except three any guitar into color';
const PASSWORD = 'correct-horse-battery';
const PAGE_TITLE = 'Phone Signer';
const WATCHER_ROLE = /^Sign on another phone/;
const SIGNER_ROLE = /^Make this phone the signer/;
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

function mkMessaging(overrides = {}) {
    return {
        addImportedWallet: vi.fn(async () => ({ wallet: { id: 'w-1' } })),
        importMnemonic: vi.fn(async () => ({ wallet: { id: 'w-first-run' } })),
        pairingPayloadRequest: vi.fn(async () => ({
            encoded: 'XCW-PAIR:ZmFrZQ',
            payload: { keys: [{ chainId: 'bitcoin-mainnet', keyId: 'ab'.repeat(32) }] },
        })),
        pairPartnerRequest: vi.fn(async () => ({
            verification: {
                ok: true,
                message: 'Paired. Both wallets come from the same recovery phrase and agree on 1 network.',
                sharedChainIds: ['bitcoin-mainnet'],
            },
        })),
        ...overrides,
    };
}

function mount(messaging, props = {}) {
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(PairPartnerWallet, props),
        ),
    );
}

function fill(labelRe, value) {
    fireEvent.change(screen.getByLabelText(labelRe, { selector: 'input, textarea' }), { target: { value } });
}

// Fills the phrase step: the shared phrase and the open vault's password.
function fillSeed(phrase = PHRASE) {
    fill(/Shared recovery phrase/i, phrase);
    fill(/^Wallet password$/i, PASSWORD);
}

// Walk role -> seed -> exchange. Returns once the exchange stage's own
// payload fetch has settled.
async function reachExchange(messaging, roleButtonRe = WATCHER_ROLE) {
    mount(messaging);
    fireEvent.click(screen.getByRole('button', { name: roleButtonRe }));
    fillSeed();
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    });
}

beforeEach(() => {
    globalThis.localStorage?.clear?.();
});

afterEach(() => {
    cleanup();
    setNativeQrScanner(null);
    vi.restoreAllMocks();
});

function fakeNativeScanner() {
    const state = { onValue: null, stop: vi.fn() };
    const scanner = {
        start: vi.fn(async (onValue) => {
            state.onValue = onValue;
            return state.stop;
        }),
    };
    setNativeQrScanner(scanner);
    return state;
}

async function openPartnerScanner() {
    fireEvent.click(screen.getByRole('button', { name: /Scan the other wallet's QR/i }));
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Scan with Camera/ }));
    });
}

describe('PairPartnerWallet: role stage', () => {
    it('opens with the overview and keeps each role description with its button', () => {
        mount(mkMessaging());
        // G01: the step count is the header subtitle, before the overview.
        const step = screen.getByText('Step 1 of 4');
        expect(step).toHaveAttribute('aria-current', 'step');
        const overview = screen.getByText('You are pairing this phone with a second phone that keeps the keys offline.');
        expect(step.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const overviewNotice = overview.closest('[data-tone="info"]');
        expect(overviewNotice).toHaveTextContent('How Pairing Works');

        const watcher = screen.getByRole('button', { name: WATCHER_ROLE });
        expect(watcher).toHaveTextContent(
            'This phone stays online. It holds no keys that can sign, builds transactions, and shows balances.',
        );
        const signer = screen.getByRole('button', { name: SIGNER_ROLE });
        expect(signer).toHaveTextContent(
            'This phone stays offline. It holds the recovery phrase and signs transactions the other phone builds.',
        );
        expect(screen.getByRole('list', { name: 'Phone signer roles' })).toContainElement(watcher);
        expect(within(watcher.closest('li')).queryAllByRole('button')).toHaveLength(1);
        expect(screen.getByText(/Write the recovery phrase down once/)).toBeInTheDocument();
    });

    it('uses no offline signer, watcher or watch-only wording', () => {
        const { container } = mount(mkMessaging());
        expect(container.textContent).not.toMatch(/offline signer|watcher|watch-only/i);
        fireEvent.click(screen.getByRole('button', { name: SIGNER_ROLE }));
        expect(container.textContent).not.toMatch(/offline signer|watcher|watch-only/i);
    });

    it('renders every forward action as a successful icon button', async () => {
        const messaging = mkMessaging();
        mount(messaging);

        fireEvent.click(screen.getByRole('button', { name: WATCHER_ROLE }));
        const continueButton = screen.getByRole('button', { name: 'Continue' });
        expect(continueButton).toHaveClass(buttonStyles.success);
        expect(continueButton.querySelector('svg')).not.toBeNull();

        fillSeed();
        await act(async () => {
            fireEvent.click(continueButton);
        });

        const pairButton = screen.getByRole('button', { name: 'Pair the Signer Phone' });
        expect(pairButton).toHaveClass(buttonStyles.success);
        expect(pairButton.querySelector('svg')).not.toBeNull();
        fill(/Paste the other wallet's code/i, PARTNER_CODE);
        await act(async () => {
            fireEvent.click(pairButton);
        });

        const finishButton = screen.getByRole('button', { name: 'Finish' });
        expect(finishButton).toHaveClass(buttonStyles.success);
        expect(finishButton.querySelector('svg')).not.toBeNull();
    });

    it('offers both halves of the pair', () => {
        mount(mkMessaging());
        expect(screen.getByRole('button', { name: WATCHER_ROLE })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: SIGNER_ROLE })).toBeInTheDocument();
    });

    it('uses a short Title Case page title', () => {
        mount(mkMessaging());
        expect(screen.getByRole('heading', { name: PAGE_TITLE })).toBeInTheDocument();
        expect(screen.queryByText(/Pair an offline signer/i)).toBeNull();
    });

    it('keeps the page title after a role is picked and names the partner on the pair button', async () => {
        await reachExchange(mkMessaging(), SIGNER_ROLE);
        expect(screen.getByRole('heading', { name: PAGE_TITLE })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Pair the Other Phone' })).toBeInTheDocument();
        expect(screen.getByText("Other phone's code")).toBeInTheDocument();
    });

    it('reports progress through the pairing steps', () => {
        mount(mkMessaging());
        expect(screen.getByText('Step 1 of 4')).toHaveAttribute('aria-current', 'step');
        fireEvent.click(screen.getByRole('button', { name: WATCHER_ROLE }));
        expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
    });

    it('skips seed entry for an existing wallet with a preselected role', async () => {
        const messaging = mkMessaging();
        await act(async () => {
            mount(messaging, { walletId: 'w-existing', initialMode: 'watcher' });
        });
        expect(screen.queryByLabelText(/Shared recovery phrase/i)).not.toBeInTheDocument();
        expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
        expect(messaging.pairingPayloadRequest).toHaveBeenCalledWith(
            expect.objectContaining({ walletId: 'w-existing', walletMode: 'watcher' }),
        );
    });
});

describe('PairPartnerWallet: seed stage', () => {
    it('asks for the open wallet password once, with no new password or confirm field', () => {
        mount(mkMessaging());
        fireEvent.click(screen.getByRole('button', { name: WATCHER_ROLE }));
        expect(screen.getByRole('note')).toHaveTextContent('Shared Phrase');
        expect(screen.getByLabelText(/^Wallet password$/i)).toHaveAttribute('type', 'password');
        expect(screen.queryByLabelText(/Confirm password/i)).toBeNull();
        expect(screen.queryByLabelText(/Password for this device/i)).toBeNull();
    });

    it('rejects a phrase with the wrong word count before touching the host', () => {
        const messaging = mkMessaging();
        mount(messaging);
        fireEvent.click(screen.getByRole('button', { name: WATCHER_ROLE }));
        fillSeed('abandon abandon about');
        fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
        expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent(/got 3/);
        expect(messaging.addImportedWallet).not.toHaveBeenCalled();
    });

    it('asks for the wallet password before touching the host', () => {
        const messaging = mkMessaging();
        mount(messaging);
        fireEvent.click(screen.getByRole('button', { name: WATCHER_ROLE }));
        fill(/Shared recovery phrase/i, PHRASE);
        fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
        expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent('Enter your wallet password.');
        expect(messaging.addImportedWallet).not.toHaveBeenCalled();
    });

    it('refuses a phrase that only the legacy format accepts', () => {
        const messaging = mkMessaging();
        mount(messaging);
        fireEvent.click(screen.getByRole('button', { name: WATCHER_ROLE }));
        fillSeed(LEGACY_PHRASE);

        fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

        expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent(/Choose FreeWallet/);
        expect(messaging.addImportedWallet).not.toHaveBeenCalled();
    });

    it('adds the shared phrase to the open vault and requests this wallet\'s pairing code', async () => {
        const messaging = mkMessaging();
        await reachExchange(messaging);

        expect(messaging.addImportedWallet).toHaveBeenCalledWith(
            // §20: the picked role is the new wallet's own mode.
            expect.objectContaining({ mnemonic: PHRASE, password: PASSWORD, format: 'bip39', walletMode: 'watcher' }),
        );
        // The vault is open, so the first-run import is never used.
        expect(messaging.importMnemonic).not.toHaveBeenCalled();
        // The role rides along on the request: the host persists walletMode
        // in the same call that reads the keys, so a payload can never
        // advertise a mode the wallet is not in.
        expect(messaging.pairingPayloadRequest).toHaveBeenCalledWith(
            expect.objectContaining({ walletId: 'w-1', walletMode: 'watcher', password: PASSWORD }),
        );
    });

    it('adds the signer half in signer mode', async () => {
        const messaging = mkMessaging();
        await reachExchange(messaging, SIGNER_ROLE);
        expect(messaging.addImportedWallet).toHaveBeenCalledWith(
            expect.objectContaining({ walletMode: 'signer' }),
        );
    });

    it('reports a shell that cannot add a wallet', async () => {
        const messaging = mkMessaging({ addImportedWallet: undefined });
        await reachExchange(messaging);
        expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent('Adding a wallet is not available in this shell.');
        expect(messaging.importMnemonic).not.toHaveBeenCalled();
        expect(messaging.pairingPayloadRequest).not.toHaveBeenCalled();
    });

    it('surfaces an add failure instead of advancing', async () => {
        const messaging = mkMessaging({
            addImportedWallet: vi.fn(async () => { throw new Error('vault is busy'); }),
        });
        await reachExchange(messaging);
        expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent(/vault is busy/);
        expect(messaging.pairingPayloadRequest).not.toHaveBeenCalled();
    });

    it('explains a refused concurrent add', async () => {
        const messaging = mkMessaging({
            addImportedWallet: vi.fn(async () => {
                throw Object.assign(new Error('stale write'), { name: 'VaultConflictError' });
            }),
        });
        await reachExchange(messaging);
        expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent(
            'This wallet changed in another window. Nothing was lost. Reload to see the latest, then try again.',
        );
        expect(messaging.pairingPayloadRequest).not.toHaveBeenCalled();
    });

    it('hides a flow-prefixed precondition behind the add failure copy', async () => {
        const messaging = mkMessaging({
            addImportedWallet: vi.fn(async () => { throw new Error('importMnemonic: password is required'); }),
        });
        await reachExchange(messaging);
        expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent('Could not add the recovery phrase as a wallet.');
        expect(screen.getByRole('alert', { name: 'Form errors' })).not.toHaveTextContent(/importMnemonic:/);
    });

    it.each(['', '    '])('adds under the default name when the name field holds %j', async (typed) => {
        const messaging = mkMessaging();
        mount(messaging);
        fireEvent.click(screen.getByRole('button', { name: WATCHER_ROLE }));
        fill(/^Wallet name$/i, typed);
        fillSeed();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
        });
        expect(messaging.addImportedWallet).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Paired Wallet' }),
        );
        expect(messaging.pairingPayloadRequest).toHaveBeenCalledWith(
            expect.objectContaining({ label: 'Paired Wallet' }),
        );
    });

    it.each([
        ['an invisible name', '​​​', 'Wallet name must include a visible character.'],
        ['an over-long name', 'N'.repeat(65), 'Wallet name must be 64 characters or fewer.'],
    ])('refuses %s before adding the shared phrase', async (_label, typed, message) => {
        const messaging = mkMessaging();
        mount(messaging);
        fireEvent.click(screen.getByRole('button', { name: WATCHER_ROLE }));
        fill(/^Wallet name$/i, typed);
        fillSeed();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
        });
        expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent(message);
        expect(messaging.addImportedWallet).not.toHaveBeenCalled();
    });

    it('adds a name of exactly 64 characters', async () => {
        const messaging = mkMessaging();
        mount(messaging);
        fireEvent.click(screen.getByRole('button', { name: WATCHER_ROLE }));
        fill(/^Wallet name$/i, 'N'.repeat(64));
        fillSeed();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
        });
        expect(messaging.addImportedWallet).toHaveBeenCalledWith(expect.objectContaining({ name: 'N'.repeat(64) }));
    });

    it('refuses to continue when the shell returns no wallet id', async () => {
        const messaging = mkMessaging({ addImportedWallet: vi.fn(async () => ({})) });
        await reachExchange(messaging);
        expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent(/no wallet id/i);
        expect(messaging.pairingPayloadRequest).not.toHaveBeenCalled();
    });
});

describe('PairPartnerWallet: exchange stage', () => {
    it('shows this wallet\'s code for the partner to scan', async () => {
        await reachExchange(mkMessaging());
        const codeBox = screen.getByText('XCW-PAIR:ZmFrZQ');
        expect(codeBox).toBeInTheDocument();
        expect(codeBox).toContainElement(screen.getByRole('button', { name: 'Copy Pairing Code' }));
        const notice = screen.getByRole('note');
        expect(notice).toHaveTextContent('Public Codes');
        expect(notice.compareDocumentPosition(codeBox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Pairing codes contain public keys only/ })).toBeNull();
        expect(screen.getByText("Signer phone's code")).toBeInTheDocument();
    });

    // A default wallet has three mainnet chains and a ~1900-character
    // pairing code, which is past what one QR frame can carry. The lane used to
    // answer that by drawing NO QR and telling the user to copy text - between
    // two phones, which is the one thing that has no shared clipboard. It now chunks.
    it('chunks a long code across frames instead of dropping the QR', async () => {
        const long = `XCW-PAIR:${'A'.repeat(1900)}`;
        await reachExchange(mkMessaging({
            pairingPayloadRequest: vi.fn(async () => ({
                encoded: long,
                payload: { keys: [{ chainId: 'bitcoin-mainnet', keyId: 'ab'.repeat(32) }] },
            })),
        }));
        expect(screen.queryByText(/too many chains switched on/i)).not.toBeInTheDocument();
        // The count is stated because a user has to know to hold still; the
        // regex also proves more than one frame was produced.
        const note = screen.getByText(/cycles through \d+ frames/i);
        expect(note).toBeInTheDocument();
        expect(Number(/cycles through (\d+) frames/i.exec(note.textContent)[1])).toBeGreaterThan(1);
    });

    it('leaves a short code as a single still frame', async () => {
        await reachExchange(mkMessaging());
        expect(screen.queryByText(/cycles through/i)).not.toBeInTheDocument();
    });

    it('requires a partner code before calling the host', async () => {
        const messaging = mkMessaging();
        await reachExchange(messaging);
        fireEvent.click(screen.getByRole('button', { name: 'Pair the Signer Phone' }));
        expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent(/Paste or scan/i);
        expect(messaging.pairPartnerRequest).not.toHaveBeenCalled();
    });

    it('rejects malformed pasted input before calling the host', async () => {
        const messaging = mkMessaging();
        await reachExchange(messaging);
        fill(/Paste the other wallet's code/i, 'https://example.test/not-a-pairing-code');
        fireEvent.click(screen.getByRole('button', { name: 'Pair the Signer Phone' }));
        expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent(/invalid or incomplete/i);
        expect(screen.getByLabelText(/Paste the other wallet's code/i, { selector: 'textarea' })).toHaveAttribute('aria-invalid', 'true');
        expect(messaging.pairPartnerRequest).not.toHaveBeenCalled();
    });

    it('keeps scanning after an unrelated code and accepts a valid code', async () => {
        const state = fakeNativeScanner();
        await reachExchange(mkMessaging());
        await openPartnerScanner();

        act(() => { state.onValue('https://example.test/not-a-pairing-code'); });
        expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent(/invalid or incomplete/i);
        expect(screen.getByRole('button', { name: /Scan with Camera/ })).toBeInTheDocument();

        act(() => { state.onValue(PARTNER_CODE); });
        expect(screen.getByLabelText(/Paste the other wallet's code/i, { selector: 'textarea' })).toHaveValue(PARTNER_CODE);
        expect(screen.queryByText(/invalid or incomplete/i)).not.toBeInTheDocument();
    });

    it('updates multi-frame scan progress and fills the verified result', async () => {
        const state = fakeNativeScanner();
        const frames = encodeXcwChunks(new TextEncoder().encode(PARTNER_CODE), { chunkBytes: 64 });
        await reachExchange(mkMessaging());
        await openPartnerScanner();

        act(() => { state.onValue(frames[0]); });
        expect(screen.getByText(`Pairing frames received: 1 of ${frames.length}`)).toBeInTheDocument();

        for (const frame of frames.slice(1)) {
            act(() => { state.onValue(frame); });
        }
        expect(screen.getByLabelText(/Paste the other wallet's code/i, { selector: 'textarea' })).toHaveValue(PARTNER_CODE);
        expect(screen.queryByText(/Pairing frames received:/i)).not.toBeInTheDocument();
    });

    it('accepts a complete multi-frame capture pasted as lines', async () => {
        const messaging = mkMessaging();
        const frames = encodeXcwChunks(new TextEncoder().encode(PARTNER_CODE), { chunkBytes: 64 });
        await reachExchange(messaging);
        fill(/Paste the other wallet's code/i, frames.join('\n'));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Pair the Signer Phone' }));
        });
        expect(messaging.pairPartnerRequest).toHaveBeenCalledWith(
            expect.objectContaining({ partner: PARTNER_CODE }),
        );
    });

    it('reports how many pasted frames are missing', async () => {
        const messaging = mkMessaging();
        const frames = encodeXcwChunks(new TextEncoder().encode(PARTNER_CODE), { chunkBytes: 64 });
        await reachExchange(messaging);
        fill(/Paste the other wallet's code/i, frames[0]);
        fireEvent.click(screen.getByRole('button', { name: 'Pair the Signer Phone' }));
        expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent(`received 1 of ${frames.length} frames`);
        expect(messaging.pairPartnerRequest).not.toHaveBeenCalled();
    });

    it('pairs and reports which chains matched', async () => {
        const messaging = mkMessaging();
        await reachExchange(messaging);
        fill(/Paste the other wallet's code/i, `  ${PARTNER_CODE}  `);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Pair the Signer Phone' }));
        });
        expect(messaging.pairPartnerRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                walletId: 'w-1',
                walletMode: 'watcher',
                partner: PARTNER_CODE,
            }),
        );
        expect(screen.getByRole('status')).toHaveTextContent('Phones Paired');
        expect(screen.getByRole('status')).toHaveTextContent(/same recovery phrase/i);
        expect(screen.getByText(/Matching networks: bitcoin-mainnet/)).toBeInTheDocument();
    });

    it('surfaces a seed mismatch from the host and stays on the exchange stage', async () => {
        const messaging = mkMessaging({
            pairPartnerRequest: vi.fn(async () => {
                throw new Error('pairPartner: These two wallets were made from different recovery phrases');
            }),
        });
        await reachExchange(messaging);
        fill(/Paste the other wallet's code/i, PARTNER_CODE);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Pair the Signer Phone' }));
        });
        expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent(/different recovery phrases/);
        expect(screen.getByRole('button', { name: 'Pair the Signer Phone' })).toBeInTheDocument();
    });

    it('shows a refusal without the flow name in front of it', async () => {
        const messaging = mkMessaging({
            pairPartnerRequest: vi.fn(async () => {
                throw new Error('pairPartner: These two wallets were made from different recovery phrases');
            }),
        });
        await reachExchange(messaging);
        fill(/Paste the other wallet's code/i, PARTNER_CODE);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Pair the Signer Phone' }));
        });
        expect(screen.getByRole('alert', { name: 'Form errors' })).not.toHaveTextContent(/pairPartner:/);
    });

    it('replaces a nested builder name in a pairing refusal with the house sentence', async () => {
        const messaging = mkMessaging({
            pairPartnerRequest: vi.fn(async () => {
                throw new Error('pairPartner: collectPairingKeys: none of the requested chains resolved a derivation path');
            }),
        });
        await reachExchange(messaging);
        fill(/Paste the other wallet's code/i, PARTNER_CODE);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Pair the Signer Phone' }));
        });
        expect(screen.getByRole('alert')).toHaveTextContent('The two wallets could not be paired.');
        expect(screen.getByRole('alert')).not.toHaveTextContent(/collectPairingKeys|derivation path/);
    });

    it('lands through onPaired when Back leaves after the phrase was added', async () => {
        const messaging = mkMessaging();
        const onBack = vi.fn();
        const onPaired = vi.fn();
        mount(messaging, { onBack, onPaired });
        fireEvent.click(screen.getByRole('button', { name: WATCHER_ROLE }));
        fillSeed();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
        });
        fireEvent.click(screen.getByRole('button', { name: /back/i }));
        expect(onPaired).toHaveBeenCalledOnce();
        expect(onBack).not.toHaveBeenCalled();
    });

    it('fires onPaired from the confirmation screen', async () => {
        const messaging = mkMessaging();
        const onPaired = vi.fn();
        mount(messaging, { onPaired });
        fireEvent.click(screen.getByRole('button', { name: WATCHER_ROLE }));
        fillSeed();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
        });
        fill(/Paste the other wallet's code/i, PARTNER_CODE);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Pair the Signer Phone' }));
        });
        fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
        expect(onPaired).toHaveBeenCalled();
    });

    it('steps Back from the phrase step to the role step and clears the typed secrets', () => {
        const onBack = vi.fn();
        mount(mkMessaging(), { onBack });
        fireEvent.click(screen.getByRole('button', { name: WATCHER_ROLE }));
        fillSeed();
        fireEvent.click(screen.getByRole('button', { name: /back/i }));

        expect(onBack).not.toHaveBeenCalled();
        expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: SIGNER_ROLE }));
        expect(screen.getByLabelText(/Shared recovery phrase/i, { selector: 'textarea' })).toHaveValue('');
        expect(screen.getByLabelText(/^Wallet password$/i)).toHaveValue('');
        fireEvent.click(screen.getByRole('button', { name: /back/i }));
        fireEvent.click(screen.getByRole('button', { name: /back/i }));
        expect(onBack).toHaveBeenCalledOnce();
    });

    it('returns through onBack when no completion callback is provided', async () => {
        const messaging = mkMessaging();
        const onBack = vi.fn();
        mount(messaging, { onBack });
        fireEvent.click(screen.getByRole('button', { name: WATCHER_ROLE }));
        fillSeed();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
        });
        fill(/Paste the other wallet's code/i, PARTNER_CODE);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Pair the Signer Phone' }));
        });
        fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
        expect(onBack).toHaveBeenCalledOnce();
    });

    it('reports a shell with no pairing support rather than hanging', async () => {
        const messaging = mkMessaging({ pairingPayloadRequest: undefined });
        await reachExchange(messaging);
        expect(screen.getByRole('alert')).toHaveTextContent(/not available in this shell/i);
    });
});
