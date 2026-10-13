// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    checkPasteIntegrity,
    hashText,
} from '../../../../packages/core/src/shared/utils/pasteIntegrity.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('hashText', () => {
    it('returns stable SHA-256 hex for strings', () => {
        expect(hashText('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
        expect(hashText('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        expect(hashText('wallet')).toHaveLength(64);
        expect(hashText('wallet')).not.toBe(hashText('Wallet'));
    });

    it.each([undefined, null, 42, {}, new Uint8Array([1])])(
        'returns an empty string for non-string input %#',
        (value) => {
            expect(hashText(value)).toBe('');
        },
    );
});

describe('checkPasteIntegrity', () => {
    it('accepts an unchanged clipboard value', async () => {
        const readText = vi.fn().mockResolvedValue('bc1qrecipient');

        const result = await checkPasteIntegrity({
            pastedText: 'bc1qrecipient',
            clipboard: { readText },
        });

        expect(readText).toHaveBeenCalledOnce();
        expect(result).toEqual({
            ok: true,
            pastedHash: hashText('bc1qrecipient'),
            rereadHash: hashText('bc1qrecipient'),
        });
    });

    it('uses the browser clipboard when no reader is injected', async () => {
        const readText = vi.fn().mockResolvedValue('bc1qrecipient');
        vi.stubGlobal('navigator', { clipboard: { readText } });

        await expect(checkPasteIntegrity({ pastedText: 'bc1qrecipient' }))
            .resolves.toMatchObject({ ok: true });
        expect(readText).toHaveBeenCalledOnce();
    });

    it('reports the reread value when clipboard contents differ', async () => {
        const result = await checkPasteIntegrity({
            pastedText: 'bc1qrecipient',
            clipboard: { readText: vi.fn().mockResolvedValue('bc1qattacker') },
        });

        expect(result).toEqual({
            ok: false,
            pastedHash: hashText('bc1qrecipient'),
            reread: 'bc1qattacker',
            rereadHash: hashText('bc1qattacker'),
            reason: 'Clipboard contents changed between paste and re-read.',
        });
    });

    it.each([
        ['missing clipboard', {}],
        ['missing reader', { clipboard: {} }],
        ['rejected read', { clipboard: { readText: vi.fn().mockRejectedValue(new Error('denied')) } }],
        ['non-string read', { clipboard: { readText: vi.fn().mockResolvedValue(null) } }],
    ])('skips comparison for %s', async (_label, options) => {
        await expect(checkPasteIntegrity({ pastedText: 'value', ...options })).resolves.toMatchObject({
            ok: true,
            skipped: true,
            pastedHash: hashText('value'),
        });
    });

    it.each([undefined, null, 12])('skips non-string pasted input %#', async (pastedText) => {
        const readText = vi.fn();

        await expect(checkPasteIntegrity({ pastedText, clipboard: { readText } }))
            .resolves.toEqual({ ok: true, skipped: true });
        expect(readText).not.toHaveBeenCalled();
    });
});
