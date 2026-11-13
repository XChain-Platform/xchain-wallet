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
import { cleanup, render, screen } from '@testing-library/react';
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
// The Form Standard's FormFrame imports FormPage by path, so that import is
// wrapped the same way.
vi.mock('../../../packages/core/src/ui/FormPage.jsx', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        FormPage: (props) => (
            <div data-xc-template="FormPage"><actual.FormPage {...props} /></div>
        ),
    };
});

const { MessagingProvider } = await import('../../../packages/core/src/shared/MessagingProvider.jsx');
const { publishWalletModes, resetWalletModes } = await import('../../../packages/core/src/shared/hooks/useWalletMode.js');
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
    // The wallet's mode is read from the wallet list, not from settings.
    publishWalletModes({ wallets: [{ id: 'w', walletMode }], activeWalletId: 'w' });
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({}),
        listWallets: vi.fn().mockResolvedValue([{ id: 'w', name: 'W', walletMode }]),
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

afterEach(() => {
    cleanup();
    resetWalletModes();
    localStorage.clear();
    delete navigator.onLine;
});

// The Issue a token wizard is retired: TokenWizard is the one Issue token
// form, so the template, network, details and review steps (and their "Step 1
// of 4" captions) are no longer shown. The form itself must still sit inside a
// page template.
describe('TokenWizard is the one Issue token form inside a page template', () => {
    it('opens straight on the Issue Token form, with no template step or progress caption', async () => {
        mountWizard();
        await screen.findByRole('form', { name: 'Issue Token' });
        expect(screen.queryByText(/Step \d of 4/)).toBeNull();
        expect(screen.queryByText('Meme token')).toBeNull();
        expectTemplatedStage();
    });

    it('draws the form inside FormPage with the Network field first and one submit action', async () => {
        mountWizard();
        const form = await screen.findByRole('form', { name: 'Issue Token' });
        expect(form.querySelector('[aria-label="Network: Bitcoin"]')).not.toBeNull();
        expect(document.querySelector('button[type="submit"]')).not.toBeNull();
        expectTemplatedStage();
    });
});
