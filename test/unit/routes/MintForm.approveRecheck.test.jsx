// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Mint at Approve, in the desktop and extension shells. The Review press
// re-reads the token record, but the confirm page can sit open while the
// issuer locks minting from another window or device. Approve re-reads the
// record once more, so a lock that lands while the confirm page is open stops
// the signature with a plain notice instead of paying fees for a MINT the
// network refuses. A moved total supply alone refuses too, since another mint
// can use the headroom the user reviewed. A re-read that throws or returns a
// loadError record signs, as at Review, and an unchanged record signs after a
// fresh read. A double press on Approve signs once, and a host that
// drops the signer call (a stopped extension worker) shows a notice after one
// compose and one signer call.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MintForm } from '../../../packages/core/src/shared/routes/MintForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN_ID = 'bitcoin-mainnet';
const ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';
const ADDRESSES = {
    [CHAIN_ID]: [{
        id: 'addr-1',
        address: ADDRESS,
        publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
    }],
};

function record(locks = {}, overrides = {}) {
    return {
        chainId: CHAIN_ID,
        tick: 'CAPTEST',
        creator: ADDRESS,
        maxSupply: '5000',
        totalSupply: '1000',
        mintMax: null,
        divisibility: 0,
        locks,
        ...overrides,
    };
}

function mountMint(shell, { mintToken } = {}) {
    let current = record();
    let readFailure = null;
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked', unlocked: true }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        isUnlocked: vi.fn().mockResolvedValue(true),
        getTokenInfo: vi.fn(async () => {
            if (readFailure === "throw") throw new Error("explorer unavailable");
            if (readFailure === "loadError") return { ...record({ mint: true }), loadError: "explorer unavailable" };
            return current;
        }),
        composeForConfirm: vi.fn(async () => ({
            psbt: 'aa00',
            encoding: 'psbt',
            actionString: 'MINT|0|CAPTEST|4000',
            version: 1,
            chainId: CHAIN_ID,
            decoded: { summary: 'Mint 4,000 CAPTEST', details: [], warnings: [] },
        })),
        preflight: vi.fn(async () => ({
            schemaVersion: 1, verdict: 'pass', restricted: false, checksRun: ['local'],
            findings: [], unverified: [], quote: null, stateHeight: 1, elapsedMs: 1,
        })),
        checkInputLiveness: vi.fn(async () => ({ verdict: 'live' })),
        releaseEncoderInputs: vi.fn(async () => undefined),
        reserve: vi.fn(async () => ({ id: 'reservation' })),
        releaseReservation: vi.fn(async () => undefined),
        mintToken: mintToken || vi.fn(async () => ({ txid: 'ab'.repeat(32) })),
    };
    const proxy = new Proxy(messaging, {
        get(target, property) {
            if (property in target) return target[property];
            return undefined;
        },
    });
    render(
        <MessagingProvider shell={shell} messaging={proxy}>
            <MintForm walletId="w" initialChainId={CHAIN_ID} initialTick="CAPTEST" onBack={() => {}} />
        </MessagingProvider>,
    );
    return {
        messaging,
        lockMinting() { current = record({ mint: true, mint_supply: true }); },
        raiseSupply() { current = record({}, { totalSupply: "2500" }); },
        failReads(mode) { readFailure = mode; },
    };
}

async function reachConfirm() {
    await screen.findByText(/4,000 CAPTEST available to mint/);
    fireEvent.change(await screen.findByLabelText(/^Amount\b/), { target: { value: '4000' } });
    fireEvent.click(screen.getByRole('button', { name: /^Mint$/ }));
    // The confirm page's Approve button names the action it signs.
    return screen.findByRole('button', { name: /^Mint 4,000 CAPTEST$/ });
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe.each(['desktop', 'extension'])('Mint Approve in the %s shell', (shell) => {
    it('refuses at Approve when minting locks while the confirm page is open', async () => {
        const { messaging, lockMinting } = mountMint(shell);
        const approve = await reachConfirm();
        lockMinting();
        await waitFor(() => expect(approve).not.toBeDisabled());
        fireEvent.click(approve);
        expect(await screen.findByText(/CAPTEST changed since this form opened/)).toBeInTheDocument();
        expect(messaging.mintToken).not.toHaveBeenCalled();
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
    });

    it('refuses at Approve when only the total supply moves while the confirm page is open', async () => {
        const { messaging, raiseSupply } = mountMint(shell);
        const approve = await reachConfirm();
        raiseSupply();
        await waitFor(() => expect(approve).not.toBeDisabled());
        fireEvent.click(approve);
        expect(await screen.findByText(/CAPTEST changed since this form opened/)).toBeInTheDocument();
        expect(messaging.mintToken).not.toHaveBeenCalled();
    });

    it.each(['throw', 'loadError'])('signs when the Approve re-read fails with %s', async (mode) => {
        const { messaging, failReads } = mountMint(shell);
        const approve = await reachConfirm();
        failReads(mode);
        await waitFor(() => expect(approve).not.toBeDisabled());
        const readsBefore = messaging.getTokenInfo.mock.calls.length;
        fireEvent.click(approve);
        expect(await screen.findByText('Minted')).toBeInTheDocument();
        expect(messaging.getTokenInfo.mock.calls.length).toBeGreaterThan(readsBefore);
        expect(messaging.mintToken).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(/changed since this form opened/)).not.toBeInTheDocument();
    });

    it('signs at Approve when the record is unchanged and re-reads it fresh', async () => {
        const { messaging } = mountMint(shell);
        const approve = await reachConfirm();
        await waitFor(() => expect(approve).not.toBeDisabled());
        const readsBefore = messaging.getTokenInfo.mock.calls.length;
        fireEvent.click(approve);
        expect(await screen.findByText('Minted')).toBeInTheDocument();
        expect(messaging.mintToken).toHaveBeenCalledTimes(1);
        const approveReads = messaging.getTokenInfo.mock.calls.slice(readsBefore).map(([req]) => req);
        expect(approveReads).toContainEqual(expect.objectContaining({ chainId: CHAIN_ID, tick: 'CAPTEST', fresh: true }));
    });

    it('signs once when Approve is pressed twice', async () => {
        let finish;
        const mintToken = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
        const { messaging } = mountMint(shell, { mintToken });
        const approve = await reachConfirm();
        await waitFor(() => expect(approve).not.toBeDisabled());
        fireEvent.click(approve);
        fireEvent.click(approve);
        await waitFor(() => expect(mintToken).toHaveBeenCalledTimes(1));
        finish({ txid: 'cd'.repeat(32) });
        expect(await screen.findByText('Minted')).toBeInTheDocument();
        expect(mintToken).toHaveBeenCalledTimes(1);
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
    });

    it('shows a notice after one signer call when the host drops it', async () => {
        const mintToken = vi.fn(async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); });
        // The form logs the failed confirm; the assertion is on what the user sees.
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { messaging } = mountMint(shell, { mintToken });
        const approve = await reachConfirm();
        await waitFor(() => expect(approve).not.toBeDisabled());
        fireEvent.click(approve);
        await waitFor(() => expect(mintToken).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.queryByText('Minted')).not.toBeInTheDocument());
        expect(mintToken).toHaveBeenCalledTimes(1);
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
        logged.mockRestore();
    });
});
