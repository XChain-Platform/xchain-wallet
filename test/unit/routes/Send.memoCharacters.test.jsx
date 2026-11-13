// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

// The Asset field opens the token picker page; a stub with one button for the
// token under test keeps these cases about the memo.
vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, chainIdFilter, onSelect, onBack }) => (
        <section aria-label={title}>
            <h2>{title}</h2>
            <button type="button" onClick={() => onSelect({ chainId: chainIdFilter, tick: 'PEPE' })}>Pick PEPE</button>
            <button type="button" onClick={onBack}>Back</button>
        </section>
    ),
}));

import { memoCharacterError } from '../../../packages/core/src/shared/utils/memoLimit.js';
import { fillNativeSend, mountSend, sendButton } from './sendInputHarness.jsx';

afterEach(() => cleanup());

describe('memoCharacterError', () => {
    it.each([
        ['a\u0000b'],
        ['tab\there'],
        ['line1\nline2'],
        ['carriage\rreturn'],
        ['esc\u001b[31m'],
        ['del\u007f'],
        ['c1\u0085break'],
        ['‮evil'],
        ['x‪y'],
        ['x⁦y'],
        ['x⁩y'],
    ])('refuses %j', (memo) => {
        expect(memoCharacterError(memo)).toMatch(/control characters or text direction overrides/);
    });

    it.each([
        [''],
        [null],
        [undefined],
        ['hello world'],
        ['café 📦'],
        ['שלום עולם'],
        ['مرحبا'],
        ['👨‍👩‍👧'],
        ['mark‏RLM'],
    ])('accepts %j', (memo) => {
        expect(memoCharacterError(memo)).toBeNull();
    });
});

describe('Send memo characters', () => {
    it('refuses a token send whose memo carries a control character before compose', async () => {
        const messaging = mountSend();
        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' } });
        fireEvent.click(await screen.findByRole('button', { name: /^Asset/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Pick PEPE' }));
        fireEvent.change(await screen.findByLabelText(/^Amount \(/), { target: { value: '1' } });
        fireEvent.click(screen.getByText('Advanced'));
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'hi‮evil' } });

        expect(screen.getAllByText('Memo cannot contain text-direction control characters.').length).toBeGreaterThan(0);
        fireEvent.click(sendButton());
        await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});
