// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    MAX_MESSAGE_ATTACHMENT_BYTES,
    parseMessageContent,
    serializeMessageContent,
} from '../../../../packages/core/src/shared/utils/messageContent.js';

const attachment = (overrides = {}) => ({
    name: 'note.txt',
    type: 'text/plain',
    dataUrl: 'data:text/plain;base64,AQ==',
    size: 1,
    ...overrides,
});

const wire = (overrides = {}) => serializeMessageContent('message', attachment(overrides));

describe('message content branch coverage', () => {
    it('keeps missing attachments and non-string content harmless', () => {
        expect(serializeMessageContent('message', null)).toBe('message');
        expect(parseMessageContent(null)).toEqual({ text: '', attachment: null });
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
    ])('accepts valid payloads with $0', (_label, overrides) => {
        expect(parseMessageContent(wire(overrides))).toMatchObject({
            text: 'message',
            attachment: { size: overrides.size },
        });
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
        ['oversized payload', { size: MAX_MESSAGE_ATTACHMENT_BYTES + 1 }],
        ['mismatched decoded size', { size: 2 }],
        ['incomplete quartet', { dataUrl: 'data:text/plain;base64,AQI', size: 2 }],
    ])('leaves $0 as ordinary text', (_label, overrides) => {
        const value = wire(overrides);
        expect(parseMessageContent(value)).toEqual({ text: value, attachment: null });
    });

    it('leaves malformed JSON after the marker as ordinary text', () => {
        const value = `${wire()} trailing-json`;
        expect(parseMessageContent(value)).toEqual({ text: value, attachment: null });
    });
});
