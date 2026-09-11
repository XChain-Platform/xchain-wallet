// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Receive screen's Copy QR / Share QR used `fetch(dataUrl)` to get a
// Blob, and every shell's CSP refused it ("Copy failed: Failed to fetch").
// This helper decodes in-process; the property under test is that it
// never touches fetch and that its bytes are exactly the encoded ones.

import { describe, it, expect, vi } from 'vitest';
import QRCode from 'qrcode';
import { dataUrlToBlob, parseDataUrl } from '../../../packages/core/src/shared/dataUrl.js';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('parseDataUrl', () => {
    it('decodes a base64 payload byte for byte', () => {
        const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
        const b64 = Buffer.from(bytes).toString('base64');
        const out = parseDataUrl(`data:application/octet-stream;base64,${b64}`);
        expect(out.type).toBe('application/octet-stream');
        expect(Array.from(out.bytes)).toEqual(Array.from(bytes));
    });

    it('decodes the percent-encoded text form and defaults the type', () => {
        const out = parseDataUrl('data:,hello%20world');
        expect(out.type).toBe('text/plain');
        expect(new TextDecoder().decode(out.bytes)).toBe('hello world');
    });

    it('drops media-type parameters and tolerates whitespace in base64', () => {
        const b64 = Buffer.from('abc').toString('base64');
        const out = parseDataUrl(`data:text/plain;charset=utf-8;base64,${b64.slice(0, 2)}\n${b64.slice(2)}`);
        expect(out.type).toBe('text/plain');
        expect(new TextDecoder().decode(out.bytes)).toBe('abc');
    });

    it('rejects anything that is not a data URL', () => {
        expect(() => parseDataUrl('https://example.com/x.png')).toThrow(/data: URL/);
        expect(() => parseDataUrl('')).toThrow(/data: URL/);
        expect(() => parseDataUrl(null)).toThrow(/data: URL/);
    });
});

describe('dataUrlToBlob', () => {
    it('turns a qrcode PNG data URL into an image/png Blob without fetch', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
            throw new TypeError('Failed to fetch');
        });
        try {
            const dataUrl = await QRCode.toDataURL('litecoin:LTC1QEXAMPLE', { width: 64 });
            const blob = dataUrlToBlob(dataUrl);
            expect(blob.type).toBe('image/png');
            // jsdom's Blob has no arrayBuffer(); check the bytes through the
            // parser the Blob was built from and the size through the Blob.
            const { bytes } = parseDataUrl(dataUrl);
            expect(Array.from(bytes.slice(0, 8))).toEqual(PNG_MAGIC);
            expect(blob.size).toBe(bytes.length);
            expect(blob.size).toBeGreaterThan(100);
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            fetchSpy.mockRestore();
        }
    });
});
