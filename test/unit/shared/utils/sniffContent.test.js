// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-27: byte-level sniffing for unlocked gated files. The declared
// on-chain MIME is attacker-controlled, so presentation is decided
// from the bytes alone; these tests pin the classification the
// GatedFileViewer's render decisions hang off.

import { describe, it, expect } from 'vitest';
import {
    sniffContent,
    isInlineRenderableKind,
} from '../../../../packages/core/src/shared/utils/sniffContent.js';

const utf8 = (s) => new Uint8Array(Buffer.from(s, 'utf8'));

describe('sniffContent raster images', () => {
    it('detects PNG by magic bytes', () => {
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
        expect(sniffContent(png)).toEqual({ kind: 'image', mime: 'image/png' });
    });

    it('detects JPEG, GIF, BMP, and WebP', () => {
        expect(sniffContent(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])).mime).toBe('image/jpeg');
        expect(sniffContent(utf8('GIF89a.......')).mime).toBe('image/gif');
        expect(sniffContent(utf8('GIF87a.......')).mime).toBe('image/gif');
        expect(sniffContent(new Uint8Array([0x42, 0x4d, 0x76, 0x00])).mime).toBe('image/bmp');
        const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
        expect(sniffContent(webp)).toEqual({ kind: 'image', mime: 'image/webp' });
    });

    it('does not classify a RIFF container without the WEBP tag as an image', () => {
        const riff = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20]);
        expect(sniffContent(riff).kind).toBe('binary');
    });
});

describe('sniffContent svg vs text vs html', () => {
    it('classifies an SVG root as svg, including with XML prolog/comments/BOM', () => {
        expect(sniffContent(utf8('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).kind).toBe('svg');
        expect(sniffContent(utf8('<?xml version="1.0"?>\n<!-- hi -->\n<svg></svg>')).kind).toBe('svg');
        expect(sniffContent(utf8('﻿  <!DOCTYPE svg><svg viewBox="0 0 1 1"/>')).kind).toBe('svg');
        expect(sniffContent(utf8('<svg onload="alert(1)"></svg>'))).toEqual({ kind: 'svg', mime: 'image/svg+xml' });
    });

    it('classifies HTML as plain text, never as a renderable document type', () => {
        const html = sniffContent(utf8('<!doctype html><html><script>alert(1)</script></html>'));
        expect(html.kind).toBe('text');
        expect(html.mime).toBe('text/plain');
        // An html-wrapped svg is a document, not an svg image.
        expect(sniffContent(utf8('<html><svg></svg></html>')).kind).toBe('text');
    });

    it('classifies UTF-8 prose and JSON as text', () => {
        expect(sniffContent(utf8('hello gated world\nline two')).kind).toBe('text');
        expect(sniffContent(utf8('{"a":1,"b":[true,null]}')).kind).toBe('text');
        expect(sniffContent(utf8('héllo ✨ ünïcödé')).kind).toBe('text');
    });

    it('never trusts a declared type: sniff takes no declared-type argument', () => {
        // Signature pin: one positional bytes argument.
        expect(sniffContent.length).toBe(1);
    });
});

describe('sniffContent download-only kinds', () => {
    it('classifies PDF as pdf (download-only)', () => {
        const pdf = sniffContent(utf8('%PDF-1.7\n...'));
        expect(pdf.kind).toBe('pdf');
        expect(isInlineRenderableKind(pdf.kind)).toBe(false);
    });

    it('classifies invalid UTF-8 and NUL-bearing bytes as binary', () => {
        expect(sniffContent(new Uint8Array([0xc3, 0x28, 0x01, 0x02])).kind).toBe('binary');
        expect(sniffContent(new Uint8Array([0x68, 0x69, 0x00, 0x68, 0x69])).kind).toBe('binary');
    });

    it('classifies control-character-heavy decodable bytes as binary', () => {
        const bytes = new Uint8Array(100);
        bytes.fill(0x01);
        expect(sniffContent(bytes).kind).toBe('binary');
    });

    it('handles empty and non-Uint8Array input as binary', () => {
        expect(sniffContent(new Uint8Array(0)).kind).toBe('binary');
        expect(sniffContent(null).kind).toBe('binary');
        expect(sniffContent('string').kind).toBe('binary');
    });
});

describe('isInlineRenderableKind', () => {
    it('allows exactly image, svg, and text inline', () => {
        expect(isInlineRenderableKind('image')).toBe(true);
        expect(isInlineRenderableKind('svg')).toBe(true);
        expect(isInlineRenderableKind('text')).toBe(true);
        expect(isInlineRenderableKind('pdf')).toBe(false);
        expect(isInlineRenderableKind('binary')).toBe(false);
        expect(isInlineRenderableKind(undefined)).toBe(false);
    });
});
