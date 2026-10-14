// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Behavioural test for the §20.5 watcher <-> signer pairing lane.
//
// Drives the real component through role -> seed -> exchange -> done and
// asserts the wiring that the flow-level unit test cannot see: that the
// picked role reaches the host on every pairing request (the payload's
// mode is what the partner's complement check reads), that the imported
// walletId is threaded through, and that a failed pairing surfaces the
// host's reason instead of silently advancing.
//
// Also pins the Onboarding entry point: the fourth lane only renders when
// the shell wires `onPairPartner`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import { PairPartnerWallet } from '../../../packages/core/src/shared/routes/PairPartnerWallet.jsx';
import { Onboarding } from '../../../packages/core/src/shared/routes/Onboarding.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';
import {
    buildPairingPayload,
    encodePairingPayload,
} from '../../../packages/core/src/flows/pairPartner.js';
import { encodeXcwChunks } from '../../../packages/core/src/uri/psbtQr.js';
import { setNativeQrScanner } from '../../../packages/core/src/ui/nativeQrScanner.js';

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

function mkMessaging(overrides = {}) {
    return {
        importMnemonic: vi.fn(async () => ({ wallet: { id: 'w-1' } })),
        pairingPayloadRequest: vi.fn(async () => ({
            encoded: 'XCW-PAIR:ZmFrZQ',
            payload: { keys: [{ chainId: 'bitcoin-mainnet', keyId: 'ab'.repeat(32) }] },
        })),
        pairPartnerRequest: vi.fn(async () => ({
            verification: {
                ok: true,
                message: 'Paired. Both wallets come from the same recovery phrase and agree on 1 chain.',
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
    fireEvent.change(screen.getByLabelText(labelRe), { target: { value } });
}

// Walk role -> seed -> exchange. Returns once the exchange stage's own
// payload fetch has settled.
async function reachExchange(messaging, roleButtonRe = /pair a signer/i) {
    mount(messaging);
    fireEvent.click(screen.getByRole('button', { name: roleButtonRe }));
    fill(/Shared recovery phrase/i, PHRASE);
    fill(/^Password for this device$/i, PASSWORD);
    fill(/Confirm password/i, PASSWORD);
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
        fireEvent.click(screen.getByRole('button', { name: /Scan with camera/i }));
    });
}

describe('PairPartnerWallet: role stage', () => {
    it('offers both halves of the pair', () => {
        mount(mkMessaging());
        expect(screen.getByRole('button', { name: /This device watches\. Pair a signer/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /This device signs\. Pair a watcher/i })).toBeInTheDocument();
    });

    it('titles the screen for the picked role', () => {
        mount(mkMessaging());
        fireEvent.click(screen.getByRole('button', { name: /pair a watcher/i }));
        expect(screen.getByText('Pair a watcher')).toBeInTheDocument();
    });

    it('reports progress through the pairing steps', () => {
        mount(mkMessaging());
        expect(screen.getByText('Step 1 of 4')).toHaveAttribute('aria-current', 'step');
        fireEvent.click(screen.getByRole('button', { name: /pair a signer/i }));
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
    it('rejects a phrase with the wrong word count before touching the host', () => {
        const messaging = mkMessaging();
        mount(messaging);
        fireEvent.click(screen.getByRole('button', { name: /pair a signer/i }));
        fill(/Shared recovery phrase/i, 'abandon abandon about');
        fill(/^Password for this device$/i, PASSWORD);
        fill(/Confirm password/i, PASSWORD);
        fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
        expect(screen.getByRole('alert')).toHaveTextContent(/got 3/);
        expect(messaging.importMnemonic).not.toHaveBeenCalled();
    });

    it('rejects mismatched passwords before touching the host', () => {
        const messaging = mkMessaging();
        mount(messaging);
        fireEvent.click(screen.getByRole('button', { name: /pair a signer/i }));
        fill(/Shared recovery phrase/i, PHRASE);
        fill(/^Password for this device$/i, PASSWORD);
        fill(/Confirm password/i, 'something-else');
        fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
        expect(screen.getByRole('alert')).toHaveTextContent(/do not match/i);
        expect(messaging.importMnemonic).not.toHaveBeenCalled();
    });

    it('imports the shared phrase and requests this wallet\'s pairing code', async () => {
        const messaging = mkMessaging();
        await reachExchange(messaging);

        expect(messaging.importMnemonic).toHaveBeenCalledWith(
            expect.objectContaining({ mnemonic: PHRASE, password: PASSWORD }),
        );
        // The role rides along on the request: the host persists walletMode
        // in the same call that reads the keys, so a payload can never
        // advertise a mode the wallet is not in.
        expect(messaging.pairingPayloadRequest).toHaveBeenCalledWith(
            expect.objectContaining({ walletId: 'w-1', walletMode: 'watcher' }),
        );
    });

    it('surfaces an import failure instead of advancing', async () => {
        const messaging = mkMessaging({
            importMnemonic: vi.fn(async () => { throw new Error('vault is busy'); }),
        });
        await reachExchange(messaging);
        expect(screen.getByRole('alert')).toHaveTextContent(/vault is busy/);
        expect(messaging.pairingPayloadRequest).not.toHaveBeenCalled();
    });

    it('refuses to continue when the shell returns no wallet id', async () => {
        const messaging = mkMessaging({ importMnemonic: vi.fn(async () => ({})) });
        await reachExchange(messaging);
        expect(screen.getByRole('alert')).toHaveTextContent(/no wallet id/i);
        expect(messaging.pairingPayloadRequest).not.toHaveBeenCalled();
    });
});

describe('PairPartnerWallet: exchange stage', () => {
    it('shows this wallet\'s code for the partner to scan', async () => {
        await reachExchange(mkMessaging());
        expect(screen.getByText('XCW-PAIR:ZmFrZQ')).toBeInTheDocument();
    });

    // A default wallet has three mainnet chains and a ~1900-character
    // pairing code, which is past what one QR frame can carry. The lane used to
    // answer that by drawing NO QR and telling the user to copy text - across an
    // air gap, which is the one thing that has no clipboard. It now chunks.
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
        fireEvent.click(screen.getByRole('button', { name: 'Pair a signer' }));
        expect(screen.getByRole('alert')).toHaveTextContent(/Paste or scan/i);
        expect(messaging.pairPartnerRequest).not.toHaveBeenCalled();
    });

    it('rejects malformed pasted input before calling the host', async () => {
        const messaging = mkMessaging();
        await reachExchange(messaging);
        fill(/Paste the other wallet's code/i, 'https://example.test/not-a-pairing-code');
        fireEvent.click(screen.getByRole('button', { name: 'Pair a signer' }));
        expect(screen.getByRole('alert')).toHaveTextContent(/invalid or incomplete/i);
        expect(screen.getByLabelText(/Paste the other wallet's code/i)).toHaveAttribute('aria-invalid', 'true');
        expect(messaging.pairPartnerRequest).not.toHaveBeenCalled();
    });

    it('keeps scanning after an unrelated code and accepts a valid code', async () => {
        const state = fakeNativeScanner();
        await reachExchange(mkMessaging());
        await openPartnerScanner();

        act(() => { state.onValue('https://example.test/not-a-pairing-code'); });
        expect(screen.getByRole('alert')).toHaveTextContent(/invalid or incomplete/i);
        expect(screen.getByRole('button', { name: /Scan with camera/i })).toBeInTheDocument();

        act(() => { state.onValue(PARTNER_CODE); });
        expect(screen.getByLabelText(/Paste the other wallet's code/i)).toHaveValue(PARTNER_CODE);
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
        expect(screen.getByLabelText(/Paste the other wallet's code/i)).toHaveValue(PARTNER_CODE);
        expect(screen.queryByText(/Pairing frames received:/i)).not.toBeInTheDocument();
    });

    it('accepts a complete multi-frame capture pasted as lines', async () => {
        const messaging = mkMessaging();
        const frames = encodeXcwChunks(new TextEncoder().encode(PARTNER_CODE), { chunkBytes: 64 });
        await reachExchange(messaging);
        fill(/Paste the other wallet's code/i, frames.join('\n'));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Pair a signer' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'Pair a signer' }));
        expect(screen.getByRole('alert')).toHaveTextContent(`received 1 of ${frames.length} frames`);
        expect(messaging.pairPartnerRequest).not.toHaveBeenCalled();
    });

    it('pairs and reports which chains matched', async () => {
        const messaging = mkMessaging();
        await reachExchange(messaging);
        fill(/Paste the other wallet's code/i, `  ${PARTNER_CODE}  `);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Pair a signer' }));
        });
        expect(messaging.pairPartnerRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                walletId: 'w-1',
                walletMode: 'watcher',
                partner: PARTNER_CODE,
            }),
        );
        expect(screen.getByRole('status')).toHaveTextContent(/same recovery phrase/i);
        expect(screen.getByText(/Matching chains: bitcoin-mainnet/)).toBeInTheDocument();
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
            fireEvent.click(screen.getByRole('button', { name: 'Pair a signer' }));
        });
        expect(screen.getByRole('alert')).toHaveTextContent(/different recovery phrases/);
        expect(screen.getByRole('button', { name: 'Pair a signer' })).toBeInTheDocument();
    });

    it('fires onPaired from the confirmation screen', async () => {
        const messaging = mkMessaging();
        const onPaired = vi.fn();
        render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(PairPartnerWallet, { onPaired }),
            ),
        );
        fireEvent.click(screen.getByRole('button', { name: /pair a signer/i }));
        fill(/Shared recovery phrase/i, PHRASE);
        fill(/^Password for this device$/i, PASSWORD);
        fill(/Confirm password/i, PASSWORD);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
        });
        fill(/Paste the other wallet's code/i, PARTNER_CODE);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Pair a signer' }));
        });
        fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
        expect(onPaired).toHaveBeenCalled();
    });

    it('returns through onBack when no completion callback is provided', async () => {
        const messaging = mkMessaging();
        const onBack = vi.fn();
        mount(messaging, { onBack });
        fireEvent.click(screen.getByRole('button', { name: /pair a signer/i }));
        fill(/Shared recovery phrase/i, PHRASE);
        fill(/^Password for this device$/i, PASSWORD);
        fill(/Confirm password/i, PASSWORD);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
        });
        fill(/Paste the other wallet's code/i, PARTNER_CODE);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Pair a signer' }));
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

describe('Onboarding: pairing lane entry point', () => {
    function mountOnboarding(props = {}) {
        globalThis.localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
        globalThis.localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
        globalThis.localStorage.setItem('xc:onboardingExplainerSeenAt', new Date().toISOString());
        return render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging: {} },
                React.createElement(Onboarding, { onCreate() {}, onImport() {}, ...props }),
            ),
        );
    }

    it('offers the pairing lane when the shell wires it', () => {
        const onPairPartner = vi.fn();
        mountOnboarding({ onPairPartner });
        const btn = screen.getByRole('button', { name: /Pair a watcher or signer/i });
        fireEvent.click(btn);
        expect(onPairPartner).toHaveBeenCalled();
    });

    it('hides the lane in a shell that does not wire it', () => {
        mountOnboarding();
        expect(screen.queryByRole('button', { name: /Pair a watcher or signer/i })).not.toBeInTheDocument();
    });
});
