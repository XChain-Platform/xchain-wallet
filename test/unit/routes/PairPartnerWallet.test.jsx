// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Behavioural test for the §20.5 /  watcher <-> signer pairing lane.
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

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct-horse-battery';

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
    vi.restoreAllMocks();
});

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

    it('requires a partner code before calling the host', async () => {
        const messaging = mkMessaging();
        await reachExchange(messaging);
        fireEvent.click(screen.getByRole('button', { name: 'Pair a signer' }));
        expect(screen.getByRole('alert')).toHaveTextContent(/Paste or scan/i);
        expect(messaging.pairPartnerRequest).not.toHaveBeenCalled();
    });

    it('pairs and reports which chains matched', async () => {
        const messaging = mkMessaging();
        await reachExchange(messaging);
        fill(/Paste the other wallet's code/i, '  XCW-PAIR:cGFydG5lcg  ');
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Pair a signer' }));
        });
        expect(messaging.pairPartnerRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                walletId: 'w-1',
                walletMode: 'watcher',
                partner: 'XCW-PAIR:cGFydG5lcg',
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
        fill(/Paste the other wallet's code/i, 'XCW-PAIR:cGFydG5lcg');
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
        fill(/Paste the other wallet's code/i, 'XCW-PAIR:cGFydG5lcg');
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Pair a signer' }));
        });
        fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
        expect(onPaired).toHaveBeenCalled();
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
