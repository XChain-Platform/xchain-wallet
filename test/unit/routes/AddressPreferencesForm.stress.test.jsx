// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The preferences form composes one ADDRESS write carrying all three wire
// values plus an optional memo. These cases hold the form to one contract:
// the composed write never carries a value the review did not show, and a
// value Review refuses never reaches compose, whatever the input, timing,
// read failure, remount or wallet size.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AddressPreferencesForm } from '../../../packages/core/src/shared/routes/AddressPreferencesForm.jsx';

const CHAIN = 'bitcoin-regtest';
const ADDRESS = 'bcrt1qprefsprefsprefsprefsprefsprefsprefs00';
const OTHER = 'bcrt1qotherotherotherotherotherotherother00';
const DEFAULTS = { onChain: false, feePreference: 0, requireMemo: 0, dispenserPreference: 1 };
const ALL_SET = { onChain: true, feePreference: 1, requireMemo: 1, dispenserPreference: 2 };

function addressRecords(count = 1) {
    const rows = [
        { id: 'a0', address: ADDRESS, publicKey: '02ab', derivationPath: "m/84'/1'/0'/0/0", source: 'hd', label: 'L'.repeat(64) },
        { id: 'a1', address: OTHER, publicKey: '02cd', derivationPath: "m/84'/1'/0'/0/1", source: 'hd', label: 'M'.repeat(64) },
    ];
    for (let i = 2; i < count; i += 1) {
        rows.push({
            id: `a${i}`,
            address: `bcrt1q${String(i).padStart(36, '0')}`,
            publicKey: '02ef',
            derivationPath: `m/84'/1'/0'/0/${i}`,
            source: 'hd',
            label: `${i}`.padEnd(64, 'x'),
        });
    }
    return rows;
}

function makeTarget({ prefs = () => Promise.resolve(DEFAULTS), count = 2 } = {}) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: addressRecords(count) }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: 'a0', address: ADDRESS } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getAddressPreferences: vi.fn().mockImplementation((args) => prefs(args)),
        // Compose answers with a held promise: the cases read what compose
        // was asked to write, never sign it.
        composeForConfirm: vi.fn().mockImplementation(() => new Promise(() => {})),
    };
}

function element(target, address = ADDRESS) {
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(AddressPreferencesForm, {
            walletId: 'w', chainId: CHAIN, address, onBack() {},
        }),
    );
}

function mount(opts) {
    const target = makeTarget(opts);
    const view = render(element(target));
    return { target, view };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

async function typeMemo(value) {
    const memo = await screen.findByLabelText(/^Memo \(optional\)/);
    fireEvent.change(memo, { target: { value } });
    return memo;
}

function utf8Bytes(value) {
    return new TextEncoder().encode(value).byteLength;
}

function clickReview() {
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
}

async function continueToConfirm(target) {
    await screen.findByRole('form', { name: 'Review preferences' });
    const button = screen.getByRole('button', { name: /Continue to confirmation|Build unsigned transaction/ });
    fireEvent.click(button);
    await vi.waitFor(() => expect(target.composeForConfirm).toHaveBeenCalled());
    return target.composeForConfirm.mock.calls[0][0].actionData;
}

function reviewText() {
    const form = screen.getByRole('form', { name: 'Review preferences' });
    return form.textContent;
}

function expectWireShape(params) {
    expect(['1', '2']).toContain(params.FEE_PREFERENCE);
    expect(['0', '1']).toContain(params.REQUIRE_MEMO);
    expect(['1', '2']).toContain(params.DISPENSER_PREFERENCE);
    if ('MEMO' in params) {
        expect(params.MEMO).not.toMatch(/[|;\u0000-\u001f\u007f-\u009f​‪-‮⁦-⁩]/);
        expect(params.MEMO).toBe(params.MEMO.trim());
        expect(new TextEncoder().encode(params.MEMO).byteLength).toBeLessThanOrEqual(250);
    }
}

afterEach(() => cleanup());

describe('AddressPreferencesForm input', () => {
    const accepted = [
        ['250 bytes of two-byte text', 'é'.repeat(125)],
        ['250 bytes of CJK plus padding', '漢'.repeat(83) + 'a'],
        ['250 bytes of emoji plus padding', '🚀'.repeat(62) + 'ab'],
        ['combining marks', 'é'.repeat(80)],
    ];
    for (const [name, value] of accepted) {
        it(`Review accepts a memo of ${name} and compose carries it exactly`, async () => {
            const { target } = mount();
            await typeMemo(value);
            clickReview();
            expect(await screen.findByRole('form', { name: 'Review preferences' })).toBeTruthy();
            expect(reviewText()).toContain(value);
            const actionData = await continueToConfirm(target);
            expect(actionData.action).toBe('ADDRESS');
            expect(actionData.params.MEMO).toBe(value);
            expectWireShape(actionData.params);
        });
    }

    const refused = [
        ['251 bytes of two-byte text', 'é'.repeat(125) + 'a', /251 bytes/],
        ['252 bytes of CJK', '漢'.repeat(84), /252 bytes/],
        ['252 bytes of emoji', '🚀'.repeat(63), /252 bytes/],
        ['a zero-width space', 'pay​me', /zero-width/],
        ['a right-to-left override', 'abc‮def', /text-direction|direction/],
        ['an isolate mark', 'abc⁦def', /text-direction|direction/],
        ['a tab', 'a\tb', /control characters/],
    ];
    for (const [name, value, message] of refused) {
        it(`Review refuses a memo holding ${name} before any compose`, async () => {
            const { target } = mount();
            await typeMemo(value);
            clickReview();
            expect(await screen.findByText(message)).toBeTruthy();
            expect(screen.queryByRole('form', { name: 'Review preferences' })).toBeNull();
            expect(target.getAddressPreferences).toHaveBeenCalledTimes(1);
            expect(target.composeForConfirm).not.toHaveBeenCalled();
        });
    }

    it('trims leading and trailing whitespace in both the review and the write', async () => {
        const { target } = mount();
        await typeMemo('   hello world   ');
        clickReview();
        await screen.findByRole('form', { name: 'Review preferences' });
        expect(screen.getByText('hello world')).toBeTruthy();
        const actionData = await continueToConfirm(target);
        expect(actionData.params.MEMO).toBe('hello world');
    });

    it('a pasted multi-line memo never reaches compose with a line break', async () => {
        const { target } = mount();
        const memo = await typeMemo('line one\nline two\r\nthree');
        clickReview();
        const reviewOpen = await screen.findByRole('form', { name: 'Review preferences' }).catch(() => null);
        if (!reviewOpen) {
            expect(target.composeForConfirm).not.toHaveBeenCalled();
            return;
        }
        // A single-line input drops the breaks; the review shows the joined text.
        expect(memo).toBeTruthy();
        const actionData = await continueToConfirm(target);
        expectWireShape(actionData.params);
        expect(reviewText()).toContain(actionData.params.MEMO);
    });

    it('a whitespace-only memo writes no MEMO field', async () => {
        const { target } = mount();
        await typeMemo('    ');
        clickReview();
        const actionData = await continueToConfirm(target);
        expect('MEMO' in actionData.params).toBe(false);
        expect(reviewText()).not.toMatch(/Memo/);
    });

    it('every field at its default still writes all three values', async () => {
        const { target } = mount();
        await screen.findByRole('button', { name: 'Review' });
        clickReview();
        const actionData = await continueToConfirm(target);
        expect(actionData.params).toEqual({ FEE_PREFERENCE: '2', REQUIRE_MEMO: '0', DISPENSER_PREFERENCE: '1' });
    });

    it('every field set writes exactly what the review shows', async () => {
        const { target } = mount();
        fireEvent.click(await screen.findByRole('radio', { name: 'Destroy the fee (reduces supply)' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Require a memo on any send to this address' }));
        fireEvent.click(screen.getByRole('radio', { name: 'Anyone may open a dispenser funded by this address' }));
        await typeMemo('all set');
        clickReview();
        await screen.findByRole('form', { name: 'Review preferences' });
        expect(screen.getByText('Destroy the fee (reduces supply) - CHANGED')).toBeTruthy();
        const actionData = await continueToConfirm(target);
        expect(actionData.params).toEqual({
            FEE_PREFERENCE: '1', REQUIRE_MEMO: '1', DISPENSER_PREFERENCE: '2', MEMO: 'all set',
        });
    });

    const oddReads = [
        ['out-of-range numbers', { onChain: true, feePreference: 9, requireMemo: 7, dispenserPreference: 5 }],
        ['negative numbers', { onChain: true, feePreference: -1, requireMemo: -1, dispenserPreference: -1 }],
        ['strings', { onChain: true, feePreference: 'x', requireMemo: 'yes', dispenserPreference: 'open' }],
        ['missing fields', { onChain: true }],
    ];
    for (const [name, read] of oddReads) {
        it(`normalises an on-chain read with ${name} to a valid wire write`, async () => {
            const { target } = mount({ prefs: () => Promise.resolve(read) });
            await screen.findByRole('button', { name: 'Review' });
            clickReview();
            const actionData = await continueToConfirm(target);
            expectWireShape(actionData.params);
            const text = reviewText();
            expect(text).not.toMatch(/undefined|NaN|null/);
        });
    }
});

describe('AddressPreferencesForm races', () => {
    it('a double click on Review runs one review and one compose', async () => {
        const { target } = mount();
        const review = await screen.findByRole('button', { name: 'Review' });
        fireEvent.click(review);
        fireEvent.click(review);
        await screen.findByRole('form', { name: 'Review preferences' });
        const button = screen.getByRole('button', { name: /Continue to confirmation/ });
        fireEvent.click(button);
        fireEvent.click(button);
        await vi.waitFor(() => expect(target.composeForConfirm).toHaveBeenCalled());
        await act(async () => { await Promise.resolve(); });
        expect(target.composeForConfirm).toHaveBeenCalledTimes(1);
        expect(screen.getAllByRole('form', { name: 'Review preferences' })).toHaveLength(1);
    });

    it('a field changed while Review reads the baseline is the value review shows and compose writes', async () => {
        const held = deferred();
        let calls = 0;
        const { target } = mount({ prefs: () => { calls += 1; return calls === 1 ? Promise.resolve(DEFAULTS) : held.promise; } });
        await screen.findByRole('button', { name: 'Review' });
        clickReview();
        fireEvent.click(screen.getByRole('radio', { name: 'Destroy the fee (reduces supply)' }));
        await act(async () => { held.resolve(DEFAULTS); await held.promise; });
        await screen.findByRole('form', { name: 'Review preferences' });
        expect(screen.getByText('Destroy the fee (reduces supply) - CHANGED')).toBeTruthy();
        const actionData = await continueToConfirm(target);
        expect(actionData.params.FEE_PREFERENCE).toBe('1');
    });

    const lateMemos = [
        ['a|b', 'Memo cannot contain "|" or ";".'],
        ['é'.repeat(125) + 'a', 'Memo is 251 bytes; the network accepts at most 250 bytes.'],
    ];
    for (const [late, message] of lateMemos) {
        it(`a memo edited while Review reads the baseline is checked before the write (${utf8Bytes(late)} bytes)`, async () => {
            const held = deferred();
            let calls = 0;
            const { target } = mount({ prefs: () => { calls += 1; return calls === 1 ? Promise.resolve(DEFAULTS) : held.promise; } });
            await typeMemo('fine');
            clickReview();
            await vi.waitFor(() => expect(target.getAddressPreferences).toHaveBeenCalledTimes(2));
            await typeMemo(late);
            await act(async () => { held.resolve(DEFAULTS); await held.promise; });
            expect(await screen.findByText(message)).toBeTruthy();
            expect(screen.queryByRole('form', { name: 'Review preferences' })).toBeNull();
            // No continue button exists outside review, so nothing can compose.
            expect(screen.queryByRole('button', { name: /Continue to confirmation|Build unsigned transaction/ })).toBeNull();
            expect(target.composeForConfirm).not.toHaveBeenCalled();
        });
    }

    it('switching the address with Review open never writes the first address\'s baseline unseen', async () => {
        const reads = [];
        const target = makeTarget({
            prefs: (args) => { reads.push(args.address); return Promise.resolve(args.address === OTHER ? ALL_SET : DEFAULTS); },
        });
        const view = render(element(target, ADDRESS));
        await screen.findByRole('button', { name: 'Review' });
        clickReview();
        await screen.findByRole('form', { name: 'Review preferences' });
        view.rerender(element(target, OTHER));
        await act(async () => { await Promise.resolve(); });
        const reviewOpen = screen.queryByRole('form', { name: 'Review preferences' });
        if (reviewOpen) {
            // Still in review: it must name the new address and compose must
            // send from the address the review names. The review shortens an
            // address to its head and tail, so the tail is what it shows.
            expect(reviewText()).toContain('Destroy the fee');
            const button = screen.getByRole('button', { name: /Continue to confirmation/ });
            fireEvent.click(button);
            await vi.waitFor(() => expect(target.composeForConfirm).toHaveBeenCalled());
            const call = target.composeForConfirm.mock.calls[0][0];
            expect(reviewOpen.textContent.replace(/\s/g, '')).toContain(call.from.address.slice(-6));
            // Every value compose writes is a value the review shows.
            const params = call.actionData.params;
            expect(reviewText()).toContain(params.FEE_PREFERENCE === '1' ? 'Destroy the fee' : 'Donate');
            expectWireShape(params);
        } else {
            expect(target.composeForConfirm).not.toHaveBeenCalled();
        }
    });
});

describe('AddressPreferencesForm network reads', () => {
    it('a failed prefill shows an error and Review retries the read', async () => {
        let calls = 0;
        const { target } = mount({
            prefs: () => { calls += 1; return calls === 1 ? Promise.reject(new Error('HTTP 500')) : Promise.resolve(ALL_SET); },
        });
        expect(await screen.findByText('HTTP 500')).toBeTruthy();
        clickReview();
        await screen.findByRole('form', { name: 'Review preferences' });
        expect(target.getAddressPreferences).toHaveBeenCalledTimes(2);
        const actionData = await continueToConfirm(target);
        expect(actionData.params).toEqual({ FEE_PREFERENCE: '1', REQUIRE_MEMO: '1', DISPENSER_PREFERENCE: '2' });
    });

    it('a failed review read refuses Review and a second click retries', async () => {
        let calls = 0;
        const { target } = mount({
            prefs: () => { calls += 1; return calls === 2 ? Promise.reject(new Error('timeout')) : Promise.resolve(DEFAULTS); },
        });
        await screen.findByRole('button', { name: 'Review' });
        clickReview();
        expect(await screen.findByText(/Could not re-check the current on-chain values: timeout/)).toBeTruthy();
        expect(target.composeForConfirm).not.toHaveBeenCalled();
        clickReview();
        await screen.findByRole('form', { name: 'Review preferences' });
    });

    for (const [name, value] of [['null', null], ['a string', '<html>'], ['an array', []]]) {
        it(`a malformed prefill of ${name} leaves defaults and Review still works`, async () => {
            let calls = 0;
            const { target } = mount({ prefs: () => { calls += 1; return Promise.resolve(calls === 1 ? value : DEFAULTS); } });
            await screen.findByRole('button', { name: 'Review' });
            await act(async () => { await Promise.resolve(); });
            expect(screen.getByRole('radio', { name: 'Destroy the fee (reduces supply)' }).checked).toBe(false);
            clickReview();
            const actionData = await continueToConfirm(target);
            expectWireShape(actionData.params);
        });
    }

    it('a malformed review read refuses Review rather than writing guesses', async () => {
        let calls = 0;
        const { target } = mount({ prefs: () => { calls += 1; return Promise.resolve(calls === 1 ? DEFAULTS : null); } });
        await screen.findByRole('button', { name: 'Review' });
        clickReview();
        expect(await screen.findByText(/Could not re-check the current on-chain values/)).toBeTruthy();
        expect(target.composeForConfirm).not.toHaveBeenCalled();
    });

    it('a prefill that never answers does not block Review', async () => {
        let calls = 0;
        const { target } = mount({ prefs: () => { calls += 1; return calls === 1 ? new Promise(() => {}) : Promise.resolve(DEFAULTS); } });
        await screen.findByRole('button', { name: 'Review' });
        clickReview();
        const actionData = await continueToConfirm(target);
        expectWireShape(actionData.params);
    });

    it('a late reply for the previous address never prefills the new one', async () => {
        const first = deferred();
        const target = makeTarget({
            prefs: (args) => (args.address === ADDRESS ? first.promise : Promise.resolve(DEFAULTS)),
        });
        const view = render(element(target, ADDRESS));
        await screen.findByRole('button', { name: 'Review' });
        view.rerender(element(target, OTHER));
        await act(async () => { await Promise.resolve(); });
        await act(async () => { first.resolve(ALL_SET); await first.promise; });
        expect(screen.getByRole('radio', { name: 'Destroy the fee (reduces supply)' }).checked).toBe(false);
        expect(screen.getByRole('checkbox', { name: 'Require a memo on any send to this address' }).checked).toBe(false);
        expect(screen.queryByText('Custom preferences set')).toBeNull();
    });
});

describe('AddressPreferencesForm lifecycle', () => {
    it('a remount with Review open returns to the form, submits nothing, and Review reads again', async () => {
        const target = makeTarget();
        const view = render(element(target));
        await typeMemo('before lock');
        clickReview();
        await screen.findByRole('form', { name: 'Review preferences' });
        // A lock replaces the route; unlock mounts it fresh.
        view.unmount();
        const again = render(element(target));
        await screen.findByRole('button', { name: 'Review' });
        expect(target.composeForConfirm).not.toHaveBeenCalled();
        const before = target.getAddressPreferences.mock.calls.length;
        clickReview();
        await screen.findByRole('form', { name: 'Review preferences' });
        expect(target.getAddressPreferences.mock.calls.length).toBe(before + 1);
        expect(screen.queryByText('before lock')).toBeNull();
        again.unmount();
    });

    it('a remount mid-edit while the review read is pending submits nothing', async () => {
        const held = deferred();
        let calls = 0;
        const target = makeTarget({ prefs: () => { calls += 1; return calls === 2 ? held.promise : Promise.resolve(DEFAULTS); } });
        const view = render(element(target));
        await typeMemo('mid edit');
        clickReview();
        view.unmount();
        await act(async () => { held.resolve(ALL_SET); await held.promise; });
        render(element(target));
        await screen.findByRole('button', { name: 'Review' });
        expect(screen.queryByRole('form', { name: 'Review preferences' })).toBeNull();
        expect(target.composeForConfirm).not.toHaveBeenCalled();
    });
});

describe('AddressPreferencesForm scale', () => {
    it('a wallet of 500 addresses with long labels renders with one preferences read', async () => {
        const { target } = mount({ count: 500 });
        await screen.findByRole('button', { name: 'Review' });
        await act(async () => { await Promise.resolve(); });
        expect(target.getAddressesByChain).toHaveBeenCalledTimes(1);
        expect(target.getAddressPreferences).toHaveBeenCalledTimes(1);
        expect(target.getAddressPreferences.mock.calls[0][0].address).toBe(ADDRESS);
        clickReview();
        const actionData = await continueToConfirm(target);
        expectWireShape(actionData.params);
        expect(target.getAddressPreferences).toHaveBeenCalledTimes(2);
    });
});
