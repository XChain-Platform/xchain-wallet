// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Airdrop "Token holders" source: a tokens file selector under the Tokens
// box, a full-width token picker button under it, and exactly 8px under that
// button. The Addresses and Existing list sources keep their own fields.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AirdropForm } from '../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { selectOption } from '../../helpers/selectOption.js';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'litecoin-mainnet';
const SOURCE = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';

function mountAirdrop() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                id: 'addr-ltc', address: SOURCE, publicKey: '02cd',
                derivationPath: "m/84'/2'/0'/0/0", source: 'hd', signerId: 'signer-1',
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'HELD', divisibility: 0, locks: {} }),
        getHoldersForToken: vi.fn().mockResolvedValue({ total: 2 }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        searchTokens: vi.fn().mockResolvedValue([]),
        getListsForSource: vi.fn().mockResolvedValue([]),
        listPendingAirdropsForWallet: vi.fn().mockResolvedValue([]),
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(AirdropForm, {
            walletId: 'w', onBack() {}, initialChainId: CHAIN, initialTick: 'HELD',
        }),
    ));
    return messaging;
}

async function openMode(mode) {
    const select = await screen.findByRole('combobox', { name: /^Airdrop to/ });
    selectOption(select, mode);
}

const upload = (name, text) => {
    const input = screen.getByLabelText('Upload CSV of tokens');
    const file = new File([text], name, { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
};

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('Airdrop Token holders source: tokens file', () => {
    it('shows the file selector under the tokens field, above the picker button', async () => {
        mountAirdrop();
        await openMode('holders');
        const tokens = screen.getByLabelText('Tokens (one per line)');
        const file = screen.getByRole('textbox', { name: /^Tokens file \(CSV or TXT\)/ });
        const picker = screen.getByRole('button', { name: /Add from token picker/ });
        expect(file).toHaveAttribute('readonly');
        expect(tokens.compareDocumentPosition(file) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(file.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('adds the tokens of a file to the box and reports lines that are not tickers', async () => {
        mountAirdrop();
        await openMode('holders');
        upload('tokens.csv', 'ticker\nAAA\nBBB\nnot a token!\n\nCCC\n');
        await waitFor(() => expect(screen.getByLabelText('Tokens (one per line)')).toHaveValue('AAA\nBBB\nnot a token!\nCCC'));
        const report = await screen.findByTestId('airdrop-ticks-file-bad-lines');
        expect(report.textContent).toMatch(/1 line is not a token name/);
        expect(report.textContent).toMatch(/Line 4: not a token!/);
        expect(screen.getByRole('textbox', { name: /^Tokens file/ })).toHaveValue('tokens.csv');
    });

    it('removes the file tokens again with the X, and clears the report', async () => {
        mountAirdrop();
        await openMode('holders');
        upload('tokens.txt', 'AAA\nbad token!\n');
        await screen.findByTestId('airdrop-ticks-file-bad-lines');
        fireEvent.click(screen.getByRole('button', { name: /^Remove/ }));
        expect(screen.getByLabelText('Tokens (one per line)')).toHaveValue('');
        expect(screen.queryByTestId('airdrop-ticks-file-bad-lines')).toBeNull();
    });

    it('draws the picker button at full width', async () => {
        mountAirdrop();
        await openMode('holders');
        const picker = screen.getByRole('button', { name: /Add from token picker/ });
        expect(picker.className).toMatch(/block/);
    });

    it('leaves exactly 8px under the picker button, by the form-gap rule', () => {
        const css = readFileSync(
            resolve(process.cwd(), 'packages/core/src/shared/routes/IssueTokenForm.module.css'),
            'utf8',
        );
        const rule = css.match(/\.tokenPickerRow\s*\{([^}]*)\}/);
        expect(rule).not.toBeNull();
        expect(rule[1]).toMatch(
            /margin-block-end:\s*calc\(var\(--xc-space-2\) - var\(--xc-form-gap, var\(--xc-space-4\)\)\)/,
        );
        expect(rule[1]).not.toMatch(/\d+px/);
        expect(css).toMatch(/\.tokenPickerRow\s*>\s*button\s*\{[^}]*width:\s*100%/);
        const jsx = readFileSync(
            resolve(process.cwd(), 'packages/core/src/shared/routes/AirdropForm.jsx'),
            'utf8',
        );
        expect(jsx).toMatch(/styles\.tokenPickerRow/);
    });

    it('keeps the Addresses and Existing list sources as they were', async () => {
        mountAirdrop();
        const select = await screen.findByRole('combobox', { name: /^Airdrop to/ });
        expect(screen.getByRole('textbox', { name: 'Recipients' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: /^Recipients file \(CSV or TXT\)/ })).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: /^Tokens file/ })).toBeNull();
        selectOption(select, 'existing');
        expect(screen.queryByRole('textbox', { name: /^Tokens file/ })).toBeNull();
        expect(screen.queryByRole('textbox', { name: 'Recipients' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Add from token picker/ })).toBeNull();
    });
});
