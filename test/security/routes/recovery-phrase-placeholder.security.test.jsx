// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Show Recovery Phrase draws the word grid before the password is checked,
// filled with blurred placeholder words. These tests pin that the real words
// reach neither the DOM nor the accessibility tree until a reveal succeeds,
// that the filler is aria-hidden and fixed (never derived from a phrase, on
// no BIP39 list), and that an empty or wrong password marks the field.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wordlist } from '@scure/bip39/wordlists/english';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MnemonicGrid, PLACEHOLDER_WORDS } from '../../../packages/core/src/shared/components/MnemonicGrid.jsx';
import { ViewRecoveryPhrase } from '../../../packages/core/src/shared/routes/ViewRecoveryPhrase.jsx';

// Distinctive words, none of which appears in the page's own copy.
const PHRASE = 'vapor tundra glimpse orchard falcon meadow quarry saddle walnut ripple lantern cobra';
const WORDS = PHRASE.split(' ');
const HIDDEN_LABEL = 'Recovery phrase hidden';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

/** True when the element or an ancestor is hidden from assistive tech. */
function hiddenFromAt(element) {
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
        if (node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('hidden')) return true;
    }
    return false;
}

/** Every string the accessibility tree can expose: visible text, names, titles, alts and values. */
function accessibleStrings() {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!hiddenFromAt(node.parentElement)) out.push(node.nodeValue || '');
    }
    for (const element of document.body.querySelectorAll('*')) {
        if (hiddenFromAt(element)) continue;
        for (const attr of ['aria-label', 'title', 'alt', 'aria-description', 'placeholder']) {
            const value = element.getAttribute(attr);
            if (value) out.push(value);
        }
        if ('value' in element && typeof element.value === 'string') out.push(element.value);
    }
    return out.join('\n');
}

/** Every string anywhere in the DOM, hidden or not, attribute values included. */
function domStrings() {
    const out = [document.body.innerHTML];
    for (const element of document.body.querySelectorAll('input, textarea, select')) out.push(element.value);
    return out.join('\n');
}

function expectNoRealWords(where) {
    const dom = domStrings();
    const tree = accessibleStrings();
    for (const word of WORDS) {
        const re = new RegExp(`\\b${word}\\b`, 'i');
        expect(re.test(dom), `${where}: DOM holds "${word}"`).toBe(false);
        expect(re.test(tree), `${where}: accessibility tree holds "${word}"`).toBe(false);
    }
}

function expectPlaceholder(where) {
    const group = screen.getByRole('group', { name: HIDDEN_LABEL });
    const area = group.querySelector('[data-concealed-area]');
    expect(area, `${where}: concealed grid`).not.toBeNull();
    expect(area.getAttribute('aria-hidden'), `${where}: grid aria-hidden`).toBe('true');
    // The same grid as the revealed one: twelve numbered cells of filler words.
    const cells = area.querySelectorAll('li');
    expect(cells).toHaveLength(12);
    cells.forEach((cell, i) => {
        expect(cell.textContent).toBe(`${i + 1}.${PLACEHOLDER_WORDS[i % PLACEHOLDER_WORDS.length]}`);
    });
    expect(document.querySelector('[data-secret]'), `${where}: no secret marker`).toBeNull();
}

const renderPage = (revealMnemonicRequest) => render(
    <MessagingProvider shell="web" messaging={{ revealMnemonicRequest }}>
        <ViewRecoveryPhrase walletId="wallet-1" walletName="Savings" onBack={() => {}} />
    </MessagingProvider>,
);

const passwordField = () => screen.getByLabelText('Wallet password');
const revealButton = () => screen.getByRole('button', { name: 'Reveal Recovery Phrase' });

describe('placeholder words', () => {
    it('are a fixed list of made-up words on no BIP39 list', () => {
        expect(Object.isFrozen(PLACEHOLDER_WORDS)).toBe(true);
        const bip39 = new Set(wordlist);
        for (const word of PLACEHOLDER_WORDS) expect(bip39.has(word), word).toBe(false);
    });

    it('blur past reading with a fixed filter that reduced motion cannot turn off', () => {
        const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');
        const css = read('packages/core/src/shared/components/MnemonicGrid.module.css');
        const rule = css.match(/\.concealedGrid \.index,\s*\.concealedGrid \.word\s*\{([^}]*)\}/);
        expect(rule).not.toBeNull();
        expect(rule[1]).toMatch(/filter:\s*var\(--xc-secret-placeholder-filter\)/);
        const tokens = read('packages/core/src/ui/tokens.css');
        const values = [...tokens.matchAll(/--xc-secret-placeholder-filter:\s*([^;]+);/g)].map((m) => m[1].trim());
        // Defined once, as a strong blur, and never switched off by a reduced-effects block.
        expect(values).toHaveLength(1);
        const blur = values[0].match(/^blur\((\d+)px\)$/);
        expect(blur).not.toBeNull();
        expect(Number(blur[1])).toBeGreaterThanOrEqual(6);
    });
});

describe('MnemonicGrid concealed', () => {
    it('never renders the phrase it holds, only filler in an aria-hidden grid inside a labelled box', () => {
        render(<MnemonicGrid mnemonic={PHRASE} />);
        expectNoRealWords('concealed grid');
        expectPlaceholder('concealed grid');
        // The default Reveal button stays reachable inside the labelled box.
        expect(screen.getByRole('button', { name: 'Reveal Recovery Phrase' })).toBeInTheDocument();
    });
});

describe('Show Recovery Phrase before a successful reveal', () => {
    it('holds no real word on first paint, and the blurred box is aria-hidden and labelled', () => {
        const revealMnemonicRequest = vi.fn().mockResolvedValue({ mnemonic: PHRASE });
        renderPage(revealMnemonicRequest);
        expectNoRealWords('first paint');
        expectPlaceholder('first paint');
        expect(revealMnemonicRequest).not.toHaveBeenCalled();
    });

    it('marks the password field red for an empty password, with no request and no new notice', () => {
        const revealMnemonicRequest = vi.fn();
        renderPage(revealMnemonicRequest);
        const noticesBefore = document.querySelectorAll('[data-tone="danger"]').length;
        fireEvent.click(revealButton());
        expect(passwordField()).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByText('Enter your wallet password.')).toBeInTheDocument();
        expect(document.querySelectorAll('[data-tone="danger"]')).toHaveLength(noticesBefore);
        expect(revealMnemonicRequest).not.toHaveBeenCalled();
        expectNoRealWords('empty password');
        expectPlaceholder('empty password');
    });

    it('marks the password field red for a wrong password, with no new notice and the grid still concealed', async () => {
        const err = Object.assign(new Error('bad'), { name: 'WrongPasswordError' });
        const revealMnemonicRequest = vi.fn().mockRejectedValue(err);
        renderPage(revealMnemonicRequest);
        const noticesBefore = document.querySelectorAll('[data-tone="danger"]').length;
        fireEvent.change(passwordField(), { target: { value: 'nope' } });
        fireEvent.click(revealButton());
        expect(await screen.findByText('The wallet password is not right.')).toBeInTheDocument();
        expect(passwordField()).toHaveAttribute('aria-invalid', 'true');
        expect(document.querySelectorAll('[data-tone="danger"]')).toHaveLength(noticesBefore);
        expectNoRealWords('wrong password');
        expectPlaceholder('wrong password');
        // Typing again clears the field's error state.
        fireEvent.change(passwordField(), { target: { value: 'nope2' } });
        expect(passwordField()).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('holds no real word while the reveal request is pending', async () => {
        let resolve;
        const revealMnemonicRequest = vi.fn(() => new Promise((r) => { resolve = r; }));
        renderPage(revealMnemonicRequest);
        fireEvent.change(passwordField(), { target: { value: 'pw' } });
        fireEvent.click(revealButton());
        expect(revealMnemonicRequest).toHaveBeenCalledTimes(1);
        expectNoRealWords('pending');
        expectPlaceholder('pending');
        await act(async () => { resolve({ mnemonic: PHRASE }); });
    });
});

describe('Show Recovery Phrase after the right password', () => {
    async function reveal() {
        const revealMnemonicRequest = vi.fn().mockResolvedValue({ mnemonic: PHRASE });
        renderPage(revealMnemonicRequest);
        fireEvent.change(passwordField(), { target: { value: 'pw' } });
        fireEvent.click(revealButton());
        expect(await screen.findByText('vapor')).toBeInTheDocument();
    }

    it('shows the real words unblurred in the same box, the placeholder gone', async () => {
        await reveal();
        for (const word of WORDS) expect(screen.getByText(word)).toBeInTheDocument();
        const card = document.querySelector('[data-mnemonic-card]');
        expect(card.querySelector('[data-concealed-area]')).toBeNull();
        expect(card.querySelector('[data-secret]')).not.toBeNull();
        expect(screen.queryByRole('group', { name: HIDDEN_LABEL })).toBeNull();
        for (const filler of PLACEHOLDER_WORDS) expect(screen.queryByText(filler)).toBeNull();
    });

    it('goes back to the blurred placeholder, with no real word left, after 60 seconds', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        await reveal();
        await act(async () => { vi.advanceTimersByTime(60_000); });
        expectNoRealWords('after auto-hide');
        expectPlaceholder('after auto-hide');
    });

    it('goes back to the blurred placeholder, with no real word left, when the window blurs', async () => {
        await reveal();
        act(() => { window.dispatchEvent(new Event('blur')); });
        expectNoRealWords('after window blur');
        expectPlaceholder('after window blur');
    });
});
