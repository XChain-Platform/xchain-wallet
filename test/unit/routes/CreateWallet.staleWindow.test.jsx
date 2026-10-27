// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const PHRASE = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
const PASSWORD = 'correct-horse-battery';
const EXISTS = 'A wallet already exists. Unlock or reset first.';
const NOTICE = /recovery phrase shown in this window was not saved.*another window created a wallet.*Write down nothing from this window/s;

const mocks = vi.hoisted(() => ({
    generateBip39Mnemonic: vi.fn(),
    nextPaint: vi.fn(),
    pickQuizPositions: vi.fn(),
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: { ...actual.crypto, generateBip39Mnemonic: mocks.generateBip39Mnemonic },
    };
});
vi.mock('../../../packages/core/src/shared/utils/nextPaint.js', () => ({ nextPaint: mocks.nextPaint }));
vi.mock('../../../packages/core/src/shared/utils/pickQuizPositions.js', () => ({
    pickQuizPositions: mocks.pickQuizPositions,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateWallet } from '../../../packages/core/src/shared/routes/CreateWallet.jsx';

function tree({ importMnemonic, staleGuard, onCreated = () => {} }) {
    return (
        <MessagingProvider shell="popup" messaging={{ importMnemonic }}>
            <CreateWallet onBack={() => {}} onCreated={onCreated} staleGuard={staleGuard} />
        </MessagingProvider>
    );
}

function toMnemonic() {
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Confirm'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
}

function toVerifyAndSubmit() {
    toMnemonic();
    fireEvent.click(screen.getByRole('checkbox', { name: /saved my recovery phrase/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Verify recovery phrase' }));
    const words = PHRASE.split(' ');
    for (const input of screen.getAllByLabelText(/^Word \d+$/)) {
        const position = Number(input.labels[0].textContent.match(/\d+/)[0]);
        fireEvent.change(input, { target: { value: words[position - 1] } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }));
}

beforeEach(() => {
    mocks.generateBip39Mnemonic.mockReset().mockReturnValue(PHRASE);
    mocks.nextPaint.mockReset().mockResolvedValue();
    mocks.pickQuizPositions.mockReset().mockReturnValue([2, 4, 6]);
});
afterEach(cleanup);

describe('CreateWallet in a window another window out-created', () => {
    it('stays on a lasting notice and drops the phrase when the vault refuses the create', async () => {
        const onCreated = vi.fn();
        const importMnemonic = vi.fn(async () => {
            throw Object.assign(new Error(EXISTS), { name: 'WalletExistsError' });
        });
        render(tree({ importMnemonic, staleGuard: { elsewhere: false, report: () => {} }, onCreated }));
        toVerifyAndSubmit();

        const notice = await screen.findByRole('alert');
        expect(notice).toHaveTextContent(NOTICE);
        expect(document.body).not.toHaveTextContent(EXISTS);
        expect(document.body).not.toHaveTextContent('abandon');
        expect(screen.queryByLabelText(/^Word \d+$/)).toBeNull();
        expect(screen.getAllByRole('button').filter((b) => b.textContent === 'Continue')).toHaveLength(1);
        expect(onCreated).not.toHaveBeenCalled();
        // Nothing moves the window on its own.
        await new Promise((r) => setTimeout(r, 50));
        expect(screen.getByRole('alert')).toHaveTextContent(NOTICE);
        expect(onCreated).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect(onCreated).toHaveBeenCalledTimes(1);
    });

    it('moves a window that shows the phrase to the notice when another window creates the wallet first', async () => {
        const importMnemonic = vi.fn();
        const guard = (elsewhere) => ({ elsewhere, report: () => {} });
        const { rerender } = render(tree({ importMnemonic, staleGuard: guard(false) }));
        toMnemonic();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }));
        expect(document.body).toHaveTextContent('abandon');

        rerender(tree({ importMnemonic, staleGuard: guard(true) }));

        expect(await screen.findByRole('alert')).toHaveTextContent(NOTICE);
        expect(document.body).not.toHaveTextContent('abandon');
        expect(importMnemonic).not.toHaveBeenCalled();
    });

    it('reports hold while a phrase is held and idle before it', () => {
        const report = vi.fn();
        render(tree({ importMnemonic: vi.fn(), staleGuard: { elsewhere: false, report } }));
        expect(report).toHaveBeenLastCalledWith('idle');
        toMnemonic();
        expect(report).toHaveBeenLastCalledWith('hold');
    });

    it('keeps the durable error on a shell without a guard', async () => {
        const importMnemonic = vi.fn(async () => {
            throw Object.assign(new Error(EXISTS), { name: 'WalletExistsError' });
        });
        render(tree({ importMnemonic, staleGuard: undefined }));
        toVerifyAndSubmit();

        await waitFor(() => expect(document.body).toHaveTextContent(EXISTS));
        expect(document.body).not.toHaveTextContent('was not saved');
        expect(screen.getByRole('button', { name: 'Create wallet' })).toBeTruthy();
    });
});
