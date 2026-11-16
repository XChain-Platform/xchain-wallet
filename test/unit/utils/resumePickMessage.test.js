// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { multipartFailureMessage } from '../../../packages/core/src/shared/utils/multipartFailureMessage.js';
import {
    RESUME_PICK_REASONS,
    resumePickMessage,
} from '../../../packages/core/src/shared/utils/resumePickMessage.js';

const CASES = [
    ['not_resumable', 'This upload has ended and cannot be continued.'],
    ['chain_mismatch', 'Switch to the network this upload started on.'],
    ['source_mismatch', 'Continue this upload from the address that started it.'],
    ['gate_mismatch', 'A gated upload continues only from Gated publish. A public one continues only from Publish file or Attach Artwork.'],
    ['file_mismatch', 'Choose the same file you started this upload with.'],
    ['read_failed', 'The picked file could not be read. Choose it again.'],
];

describe('resumePickMessage mappings', () => {
    it.each(CASES)('maps %s', (reason, message) => {
        expect(resumePickMessage(reason)).toEqual({ reason, message });
    });
});

describe('resumePickMessage shared wording', () => {
    it('matches the source mismatch failure message', () => {
        expect(resumePickMessage('source_mismatch').message)
            .toBe(multipartFailureMessage({ code: 'RESUME_SOURCE_MISMATCH' }).message);
    });

    it('matches the original file mismatch failure message', () => {
        expect(resumePickMessage('file_mismatch').message)
            .toBe(multipartFailureMessage({ code: 'RESUME_ORIGINAL_MISMATCH' }).message);
    });
});

describe('RESUME_PICK_REASONS', () => {
    it('holds exactly the supported reasons in order', () => {
        expect(RESUME_PICK_REASONS).toEqual(CASES.map(([reason]) => reason));
    });

    it('is frozen', () => {
        expect(Object.isFrozen(RESUME_PICK_REASONS)).toBe(true);
    });
});

describe('resume pick message copy safety', () => {
    it.each(CASES)('keeps the %s message user-facing', (reason) => {
        const { message } = resumePickMessage(reason);
        expect(message).not.toMatch(/[a-z]+_[a-z_]+/);
        expect(message).not.toContain(String.fromCodePoint(8212));
        expect(message).toMatch(/\.$/);
        expect(message.split(/(?<=[.!?])\s+/).length).toBeGreaterThanOrEqual(1);
        expect(message.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(2);
    });
});

describe('resumePickMessage fallthrough', () => {
    it.each([
        'unknown_reason',
        42,
        null,
        undefined,
        {},
        'toString',
        '__proto__',
    ])('returns null for %j', (reason) => {
        expect(resumePickMessage(reason)).toBeNull();
    });
});

describe('resumePickMessage result ownership', () => {
    it('returns a fresh object on every call', () => {
        const first = resumePickMessage('chain_mismatch');
        const second = resumePickMessage('chain_mismatch');
        expect(first).toEqual(second);
        expect(first).not.toBe(second);
    });
});
