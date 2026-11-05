// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every TokenWizard stage draws its page content inside a page template.
// The static route-template guard only sees that the file names ListPage and
// FormPage somewhere, so it cannot catch one stage that hands Screen bare
// content. This drive renders each stage and checks the Screen's direct
// content: every element there is a ListPage or FormPage root.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        Screen: (props) => (
            <actual.Screen {...props}>
                <div data-xc-screen-content="">{props.children}</div>
            </actual.Screen>
        ),
        ListPage: (props) => (
            <div data-xc-template="ListPage"><actual.ListPage {...props} /></div>
        ),
        FormPage: (props) => (
            <div data-xc-template="FormPage"><actual.FormPage {...props} /></div>
        ),
    };
});

const { MessagingProvider } = await import('../../../packages/core/src/shared/MessagingProvider.jsx');
const { TokenWizard } = await import('../../../packages/core/src/shared/routes/TokenWizard.jsx');

const ADDRESSES = {
    'bitcoin-mainnet': [{
        id: 'addr-1',
        address: 'bc1qexampleexampleexampleexampleexampleex',
        publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
    }],
};

function mountWizard({ walletMode = 'full', messagingOverrides = {} } = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
            chainId: 'bitcoin-mainnet', networkFeeSats: 1000, xchainFee: '0.5',
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        issueToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
        ...messagingOverrides,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenWizard walletId="w" onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

// The wizard's own Screen is the outermost content box; nested pickers and
// the confirm page bring their own Screen, which this drive never opens.
function expectTemplatedStage() {
    const boxes = document.querySelectorAll('[data-xc-screen-content]');
    expect(boxes.length).toBe(1);
    const children = Array.from(boxes[0].children);
    expect(children.length).toBeGreaterThan(0);
    const bare = children
        .filter((el) => !el.hasAttribute('data-xc-template'))
        .map((el) => el.outerHTML.slice(0, 120));
    expect(bare).toEqual([]);
}

async function reachDetails() {
    fireEvent.click(await screen.findByText('Meme token'));
    await screen.findByLabelText('Fee paid by');
    expectTemplatedStage();
    fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
    fireEvent.change(screen.getByLabelText('Token name (ticker)'), { target: { value: 'PAGED' } });
    fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1' } });
}

async function approveFromReview() {
    fireEvent.click(screen.getByRole('button', { name: 'Continue to confirmation' }));
    await screen.findByTestId('confirm-modal');
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('confirm-approve'));
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    delete navigator.onLine;
});

describe('TokenWizard stages sit inside a page template', () => {
    it('draws the template stage, progress caption included, inside ListPage', async () => {
        mountWizard();
        await screen.findByText('Step 1 of 4: Template');
        expectTemplatedStage();
    });

    it('draws the network, details and review stages inside FormPage', async () => {
        mountWizard();
        await reachDetails();
        expectTemplatedStage();
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        await screen.findByText('Step 4 of 4: Review');
        expectTemplatedStage();
    });

    it('carries the offline note in the template notice slot at every editing stage', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        mountWizard();
        await screen.findByText('Step 1 of 4: Template');
        expectTemplatedStage();
        await reachDetails();
        expect(screen.getAllByText('Creating a token needs a network connection.')).toHaveLength(1);
        expectTemplatedStage();
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        await screen.findByText('Step 4 of 4: Review');
        expect(screen.getAllByText('Creating a token needs a network connection.')).toHaveLength(1);
        expectTemplatedStage();
    });

    it('carries the unfinished-draft banner in the template notice slot', async () => {
        mountWizard();
        await reachDetails();
        cleanup();
        mountWizard();
        await screen.findByText('Step 1 of 4: Template');
        expect(await screen.findByRole('button', { name: /restore/i })).toBeTruthy();
        expectTemplatedStage();
    });

    it('draws the unsigned watcher result inside ListPage', async () => {
        mountWizard({
            walletMode: 'watcher',
            messagingOverrides: {
                buildActionPsbtRequest: vi.fn().mockResolvedValue({
                    psbtHex: '70736274ff00', chainId: 'bitcoin-mainnet',
                }),
            },
        });
        await reachDetails();
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        fireEvent.submit(await screen.findByRole('form', { name: 'Review token issuance' }));
        await screen.findByLabelText('Unsigned transaction code');
        expectTemplatedStage();
    });

    it('draws the signed-not-broadcast result inside ListPage', async () => {
        const messaging = mountWizard({
            messagingOverrides: { issueToken: vi.fn().mockResolvedValue({ queued: true }) },
        });
        await reachDetails();
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        await approveFromReview();
        await waitFor(() => expect(messaging.issueToken).toHaveBeenCalledTimes(1));
        await screen.findByTestId('result-screen-notice');
        expectTemplatedStage();
    });

    it('draws the issued result inside ListPage', async () => {
        mountWizard();
        await reachDetails();
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        await approveFromReview();
        await screen.findByText('Token issued');
        expectTemplatedStage();
    });
});
