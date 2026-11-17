// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import * as messageContent from '../../../../packages/core/src/shared/utils/messageContent.js';

const { parseMessageContent } = messageContent;

const MARKER = '\n\n[[xchain-attachment:v1]]\n';

const envelope = (overrides = {}) => JSON.stringify({
    name: 'note.txt',
    type: 'text/plain',
    dataUrl: 'data:text/plain;base64,AQ==',
    size: 1,
    ...overrides,
});

const wire = (overrides = {}) => `message${MARKER}${envelope(overrides)}`;

describe('message content (legacy envelope is hidden, never an attachment)', () => {
    it('exports no way to build an attachment', () => {
        expect(Object.keys(messageContent)).toEqual(['parseMessageContent']);
    });

    it('keeps non-string content harmless', () => {
        expect(parseMessageContent(null)).toEqual({ text: '' });
    });

    it.each([
        ['two padding bytes', { dataUrl: 'data:text/plain;base64,AQ==', size: 1 }],
        ['one padding byte', { dataUrl: 'data:text/plain;base64,AQI=', size: 2 }],
        ['no padding bytes', { dataUrl: 'data:text/plain;base64,AQID', size: 3 }],
        ['case-normalized media type', {
            type: 'TEXT/PLAIN',
            dataUrl: 'data:text/plain;base64,AQ==',
            size: 1,
        }],
    ])('strips a well-formed envelope with $0 and returns only the text', (_label, overrides) => {
        const result = parseMessageContent(wire(overrides));
        expect(result).toEqual({ text: 'message' });
        expect(result.attachment).toBeUndefined();
    });

    it.each([
        ['unsupported type', { type: 'application/javascript' }],
        ['missing type', { type: undefined }],
        ['missing name', { name: undefined }],
        ['empty name', { name: '' }],
        ['long name', { name: 'a'.repeat(256) }],
        ['missing data URL', { dataUrl: undefined }],
        ['wrong data prefix', { dataUrl: 'data:image/png;base64,AQ==' }],
        ['invalid base64', { dataUrl: 'data:text/plain;base64,A?==' }],
        ['non-integral size', { size: 1.5 }],
        ['zero size', { size: 0 }],
        ['oversized payload', { size: 256 * 1024 + 1 }],
        ['mismatched decoded size', { size: 2 }],
        ['incomplete quartet', { dataUrl: 'data:text/plain;base64,AQI', size: 2 }],
    ])('leaves $0 as ordinary text', (_label, overrides) => {
        const value = wire(overrides);
        expect(parseMessageContent(value)).toEqual({ text: value });
    });

    it('leaves malformed JSON after the marker as ordinary text', () => {
        const value = `${wire()} trailing-json`;
        expect(parseMessageContent(value)).toEqual({ text: value });
    });

    it('leaves javascript: text alone', () => {
        expect(parseMessageContent('javascript:alert(1)')).toEqual({ text: 'javascript:alert(1)' });
    });
});
