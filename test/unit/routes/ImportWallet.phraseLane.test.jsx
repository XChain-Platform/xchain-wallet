// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The regular Recovery phrase lane imports BIP39 only. A BIP39 phrase with a
// one-word typo whose words all sit in the FreeWallet list still parses as a
// FreeWallet phrase, and accepting it there would open a different, empty
// wallet. The lane refuses it and points at From FreeWallet; the FreeWallet
// lane imports the same words as before. Phrases are built at run time from
// the two wordlists and never printed.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { englishWordlist, isValidBip39Mnemonic } from '../../../packages/core/src/crypto/mnemonic.js';
import {
    COUNTERWALLET_WORDLIST,
    isValidCounterwalletMnemonic,
} from '../../../packages/core/src/crypto/counterwallet.js';
import {
    importPhraseFormat,
    importPhraseFormatArg,
} from '../../../packages/core/src/shared/utils/importPhraseCheck.js';

const PASSWORD = 'correct-horse-battery';
const REFUSAL = "This phrase doesn't pass the recovery phrase check. If it came from FreeWallet, use the From FreeWallet option.";

// Deterministic draw so the test never depends on a lucky random phrase.
function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function sharedWordPhrases() {
    const cw = new Set(COUNTERWALLET_WORDLIST);
    const shared = englishWordlist.filter((word) => cw.has(word));
    const next = seededRandom(20261027);
    const pick = () => shared[Math.floor(next() * shared.length)];
    for (let attempt = 0; attempt < 10000; attempt++) {
        const words = Array.from({ length: 12 }, pick);
        if (!isValidBip39Mnemonic(words.join(' '))) continue;
        for (let tries = 0; tries < 100; tries++) {
            const typo = words.slice();
            const at = Math.floor(next() * 12);
            typo[at] = pick();
            const typoPhrase = typo.join(' ');
            if (typo[at] !== words[at] && !isValidBip39Mnemonic(typoPhrase)) {
                return { valid: words.join(' '), typo: typoPhrase };
            }
        }
    }
    throw new Error('no shared-word phrase found');
}

const { valid: VALID_SHARED, typo: TYPO_SHARED } = sharedWordPhrases();

async function fill(variant, phrase) {
    const messaging = {
        importMnemonic: vi.fn().mockResolvedValue({ walletId: 'w-1' }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ImportWallet variant={variant} mode="fresh" onBack={() => {}} onImported={() => {}} />
        </MessagingProvider>,
    );
    fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: phrase } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
    return messaging;
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('regular recovery phrase lane', () => {
    it('builds a typo phrase that fails BIP39 and parses as FreeWallet', () => {
        expect(isValidBip39Mnemonic(TYPO_SHARED)).toBe(false);
        expect(isValidCounterwalletMnemonic(TYPO_SHARED)).toBe(true);
        expect(isValidBip39Mnemonic(VALID_SHARED)).toBe(true);
    });

    it('refuses a one-word typo of a BIP39 phrase whose words are also FreeWallet words', async () => {
        const messaging = await fill('default', TYPO_SHARED);
        expect(screen.queryByText('Counterwallet/FreeWallet recovery phrase detected')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(REFUSAL);
        expect(messaging.importMnemonic).not.toHaveBeenCalled();
    });

    it('imports a valid BIP39 phrase as BIP39, pinned on the request', async () => {
        const messaging = await fill('default', VALID_SHARED);
        expect(screen.getByText('BIP39 recovery phrase detected')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));
        await waitFor(() => expect(messaging.importMnemonic).toHaveBeenCalled());
        expect(messaging.importMnemonic.mock.calls[0][0]).toMatchObject({ format: 'bip39' });
    });

    it('imports the same typo words through From FreeWallet as a FreeWallet phrase', async () => {
        const messaging = await fill('freewallet', TYPO_SHARED);
        expect(screen.getByText('Counterwallet/FreeWallet recovery phrase detected')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));
        await waitFor(() => expect(messaging.importMnemonic).toHaveBeenCalled());
        expect(messaging.importMnemonic.mock.calls[0][0]).toMatchObject({ format: 'counterwallet-legacy' });
    });
});

describe('importPhraseFormat', () => {
    it('accepts only BIP39 on the regular lane and FreeWallet first on the FreeWallet lane', () => {
        expect(importPhraseFormat(TYPO_SHARED, false)).toBeNull();
        expect(importPhraseFormat(TYPO_SHARED, true)).toBe('counterwallet');
        expect(importPhraseFormat(VALID_SHARED, false)).toBe('bip39');
        expect(importPhraseFormat(VALID_SHARED, true)).toBe('counterwallet');
    });

    it('pins BIP39 on the regular lane and leaves the FreeWallet lane request as it was', () => {
        expect(importPhraseFormatArg('bip39', false)).toEqual({ format: 'bip39' });
        expect(importPhraseFormatArg('bip39', true)).toEqual({});
        expect(importPhraseFormatArg('counterwallet', true)).toEqual({ format: 'counterwallet-legacy' });
    });
});
