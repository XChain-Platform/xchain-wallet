// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import { artworkLinkFields } from '../../../packages/core/src/flows/multipartArtworkLink.js';
import { resolveMultipartLinkTarget } from '../../../packages/core/src/flows/multipartLinkTarget.js';
import { multipartFailureMessage } from '../../../packages/core/src/shared/utils/multipartFailureMessage.js';
import {
    LINK_TARGET_REASONS,
    multipartLinkMessage,
} from '../../../packages/core/src/shared/utils/multipartLinkMessage.js';

const CASES = [
    ['not_indexed', true],
    ['pending', true],
    ['unreadable', true],
    ['mismatch', false],
    ['not_a_manifest', false],
    ['no_link_target', false],
    ['token_mismatch', false],
    ['bad_index', false],
];

const TXID = 'ab'.repeat(32);
const linkTarget = () => ({ tick: 'ART', issueActionIndex: 23 });

function manifestDetail(status) {
    return {
        action: 'FILE',
        action_format: 1,
        status: 'valid',
        multipart: {
            file_hash: 'cd'.repeat(32),
            total_parts: 2,
            parts_received: 1,
            total_bytes: 400,
            status,
        },
    };
}

function explorerFor(transaction, detail) {
    return {
        getTransaction: vi.fn(async () => transaction),
        getAction: vi.fn(async () => detail),
    };
}

describe('multipart link message mappings', () => {
    it.each(CASES)('maps %s with retryable=%s', (reason, retryable) => {
        expect(multipartLinkMessage(reason)).toEqual({
            reason,
            message: expect.any(String),
            retryable,
        });
    });

    it('reuses the established mismatch wording', () => {
        const failure = multipartFailureMessage({ code: 'FILE_MULTIPART_MISMATCH' });
        expect(multipartLinkMessage('mismatch').message).toBe(failure.message);
    });
});

describe('multipart artwork link refusal coverage', () => {
    it.each([
        [{ linkTarget: null, resolved: { ready: false, reason: 'pending' } }, 'no_link_target'],
        [{
            linkTarget: { tick: 'OTHER', issueActionIndex: 23 },
            resolved: { ready: true, actionIndex: 41 },
        }, 'token_mismatch'],
        [{ linkTarget: linkTarget(), resolved: { ready: false, reason: 'pending' } }, 'pending'],
        [{ linkTarget: linkTarget(), resolved: { ready: true, actionIndex: 0 } }, 'bad_index'],
    ])('maps the %s refusal into the public reason set', (overrides, expected) => {
        const result = artworkLinkFields({ coinTicker: 'BTC', tick: 'ART', ...overrides });
        expect(result).toEqual({ ok: false, reason: expected });
        expect(LINK_TARGET_REASONS).toContain(result.reason);
    });
});

describe('multipart link target refusal coverage', () => {
    it.each([
        ['no actions', explorerFor({ actions: [] }), 'not_indexed'],
        ['non-FILE action', explorerFor({ actions: [{ action: 'SEND', action_index: 7 }] }), 'not_a_manifest'],
        [
            'pending detail',
            explorerFor({ actions: [{ action: 'FILE', action_index: 7 }] }, manifestDetail('pending')),
            'pending',
        ],
        [
            'mismatch detail',
            explorerFor({ actions: [{ action: 'FILE', action_index: 7 }] }, manifestDetail('mismatch')),
            'mismatch',
        ],
        [
            'throw',
            { getTransaction: vi.fn(async () => { throw new Error('offline'); }), getAction: vi.fn() },
            'unreadable',
        ],
    ])('maps a %s result into the public reason set', async (_label, explorer, expected) => {
        const sleep = vi.fn(async () => {});
        const result = await resolveMultipartLinkTarget({
            explorer, txid: TXID, coin: 'BTC', maxAttempts: 1, sleep,
        });
        expect(result).toEqual({ ready: false, reason: expected });
        expect(LINK_TARGET_REASONS).toContain(result.reason);
        expect(sleep).not.toHaveBeenCalled();
    });
});

describe('multipart link reason registry', () => {
    it('contains exactly the eight immutable public reasons', () => {
        expect(LINK_TARGET_REASONS).toEqual(CASES.map(([reason]) => reason));
        expect(Object.isFrozen(LINK_TARGET_REASONS)).toBe(true);
    });
});

describe('multipart link message wording', () => {
    it.each(CASES)('keeps the %s message suitable for display', (reason) => {
        const { message } = multipartLinkMessage(reason);
        const sentenceCount = message.split(/(?<=[.!?])\s+/).length;
        expect(message).toMatch(/\.$/);
        expect(message).not.toMatch(/[a-z]+_[a-z_]+/);
        expect([...message].map((character) => character.codePointAt(0))).not.toContain(8212);
        expect(sentenceCount).toBeGreaterThanOrEqual(1);
        expect(sentenceCount).toBeLessThanOrEqual(2);
    });
});

describe('multipart link message fallthrough', () => {
    it.each(['unknown_reason', 'toString', '__proto__', null, 7, {}, undefined])(
        'returns null for an unmapped or non-string value',
        (reason) => expect(multipartLinkMessage(reason)).toBeNull(),
    );
});

describe('multipart link message copy safety', () => {
    it('returns a fresh object on every call', () => {
        const first = multipartLinkMessage('pending');
        const second = multipartLinkMessage('pending');
        expect(first).toEqual(second);
        expect(first).not.toBe(second);
    });
});
