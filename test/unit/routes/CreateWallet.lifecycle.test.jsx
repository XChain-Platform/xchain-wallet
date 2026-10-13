// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const PHRASE = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
const SECOND_PHRASE = 'account accuse achieve acid acoustic acquire across act action actor actress actual';
const PASSWORD = 'correct-horse-battery';
const BIP39_PASSPHRASE = 'separate secret';

const mocks = vi.hoisted(() => ({
    generateBip39Mnemonic: vi.fn(),
    nextPaint: vi.fn(),
    pickQuizPositions: vi.fn(),
}));

const hookValues = vi.hoisted(() => new Map());

vi.mock('react', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useState(initialValue) {
            const [value, setValue] = actual.useState(initialValue);
            const id = actual.useRef(Symbol('state')).current;
            hookValues.set(id, value);
            const setTrackedValue = actual.useCallback((nextValue) => {
                setValue((previousValue) => {
                    const resolved = typeof nextValue === 'function'
                        ? nextValue(previousValue)
                        : nextValue;
                    hookValues.set(id, resolved);
                    return resolved;
                });
            }, [id]);
            return [value, setTrackedValue];
        },
    };
});

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: { ...actual.crypto, generateBip39Mnemonic: mocks.generateBip39Mnemonic },
    };
});

vi.mock('../../../packages/core/src/shared/utils/nextPaint.js', () => ({
    nextPaint: mocks.nextPaint,
}));

vi.mock('../../../packages/core/src/shared/utils/pickQuizPositions.js', () => ({
    pickQuizPositions: mocks.pickQuizPositions,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateWallet } from '../../../packages/core/src/shared/routes/CreateWallet.jsx';

function wallet(messaging = { importMnemonic: vi.fn() }) {
    return (
        <MessagingProvider shell="web" messaging={messaging}>
            <CreateWallet onBack={() => {}} onCreated={() => {}} />
        </MessagingProvider>
    );
}

function enterPasswordStep({ passphrase = false } = {}) {
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
    if (passphrase) {
        fireEvent.click(screen.getByLabelText(/^Use a BIP39 passphrase/));
        fireEvent.change(screen.getByLabelText('BIP39 passphrase'), {
            target: { value: BIP39_PASSPHRASE },
        });
        fireEvent.change(screen.getByLabelText('Confirm passphrase'), {
            target: { value: BIP39_PASSPHRASE },
        });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
}

function startQuiz() {
    fireEvent.click(screen.getByRole('checkbox', { name: /saved my recovery phrase/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Verify recovery phrase' }));
}

function answerQuiz() {
    const words = PHRASE.split(' ');
    for (const input of screen.getAllByLabelText(/^Word \d+$/)) {
        const position = Number(input.labels[0].textContent.match(/\d+/)[0]);
        fireEvent.change(input, { target: { value: words[position - 1] } });
    }
}

beforeEach(() => {
    hookValues.clear();
    mocks.generateBip39Mnemonic.mockReset().mockReturnValue(PHRASE);
    mocks.nextPaint.mockReset().mockResolvedValue();
    mocks.pickQuizPositions.mockReset().mockReturnValue([2, 4, 6]);
});

afterEach(() => {
    cleanup();
});

describe('CreateWallet lifecycle guards', () => {
    it('keeps one generated phrase through mnemonic-step rerenders', () => {
        mocks.generateBip39Mnemonic.mockReturnValueOnce(PHRASE).mockReturnValue(SECOND_PHRASE);
        render(wallet());
        enterPasswordStep();

        fireEvent.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }));
        fireEvent.click(screen.getByRole('checkbox', { name: /saved my recovery phrase/i }));
        fireEvent.click(screen.getByRole('checkbox', { name: /saved my recovery phrase/i }));

        expect(mocks.generateBip39Mnemonic).toHaveBeenCalledTimes(1);
        expect(screen.getByText('abandon')).toBeInTheDocument();
        expect(screen.queryByText('account')).toBeNull();
    });

    it('does not persist when the verification step has no quiz positions', async () => {
        mocks.pickQuizPositions.mockReturnValue([]);
        const importMnemonic = vi.fn();
        render(wallet({ importMnemonic }));
        enterPasswordStep();
        startQuiz();

        fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Recovery phrase verification could not start. Go back and try again.',
        );
        expect(importMnemonic).not.toHaveBeenCalled();
        expect(mocks.nextPaint).not.toHaveBeenCalled();
    });

    it('recovers from a rejected paint wait without leaving the screen busy', async () => {
        mocks.nextPaint.mockRejectedValue(new Error('Could not prepare wallet creation'));
        const importMnemonic = vi.fn();
        render(wallet({ importMnemonic }));
        enterPasswordStep();
        startQuiz();
        answerQuiz();

        fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not prepare wallet creation');
        expect(screen.getByRole('button', { name: 'Create wallet' })).toBeEnabled();
        expect(importMnemonic).not.toHaveBeenCalled();
    });

    it('allows only one persistence request while creation is in flight', async () => {
        let releasePaint;
        mocks.nextPaint.mockImplementation(() => new Promise((resolve) => { releasePaint = resolve; }));
        const importMnemonic = vi.fn().mockResolvedValue({ walletId: 'wallet-1' });
        render(wallet({ importMnemonic }));
        enterPasswordStep();
        startQuiz();
        answerQuiz();
        const form = screen.getByRole('button', { name: 'Create wallet' }).closest('form');

        act(() => {
            fireEvent.submit(form);
            fireEvent.submit(form);
        });
        expect(mocks.nextPaint).toHaveBeenCalledTimes(1);

        await act(async () => releasePaint());
        await screen.findByRole('heading', { name: 'Automatic Donation System' });
        expect(importMnemonic).toHaveBeenCalledTimes(1);
    });

    it('clears wallet secrets from component state after persistence', async () => {
        const importMnemonic = vi.fn().mockResolvedValue({ walletId: 'wallet-1' });
        render(wallet({ importMnemonic }));
        enterPasswordStep({ passphrase: true });
        startQuiz();
        answerQuiz();

        fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }));
        await screen.findByRole('heading', { name: 'Automatic Donation System' });
        await waitFor(() => {
            const stateValues = [...hookValues.values()];
            expect(stateValues).not.toContain(PASSWORD);
            expect(stateValues).not.toContain(PHRASE);
            expect(stateValues).not.toContain(BIP39_PASSPHRASE);
        });
    });
});
