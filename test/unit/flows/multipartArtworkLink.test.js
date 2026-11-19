// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { artworkLinkFields } from '../../../packages/core/src/flows/multipartArtworkLink.js';

const validInput = () => ({
    linkTarget: { tick: 'ART', issueActionIndex: 23 },
    resolved: { ready: true, actionIndex: 41 },
    coinTicker: 'btc',
    tick: 'art',
});

describe('multipart artwork LINK fields', () => {
    it('builds fields for a resumed record and normalizes its ticker', () => {
        expect(artworkLinkFields(validInput())).toEqual({
            ok: true,
            fields: {
                coin1: 'BTC',
                coin1ActionIndex: '41',
                coin2: 'BTC',
                coin2ActionIndex: '23',
            },
        });
    });

    it.each([
        [{ ready: true, actionIndex: '0' }, 23],
        [{ ready: true, actionIndex: '1.5' }, 23],
        [{ ready: true, actionIndex: '2' }, '03'],
        [{ ready: true, actionIndex: '2' }, -1],
    ])('rejects invalid action indices', (resolved, issueActionIndex) => {
        const input = validInput();
        input.resolved = resolved;
        input.linkTarget.issueActionIndex = issueActionIndex;
        expect(artworkLinkFields(input)).toEqual({ ok: false, reason: 'bad_index' });
    });
});

describe('multipart artwork LINK refusal order', () => {
    it('checks a missing target before every other refusal', () => {
        const input = validInput();
        input.linkTarget = null;
        input.resolved = { ready: false, reason: 'not_complete' };
        expect(artworkLinkFields(input)).toEqual({ ok: false, reason: 'no_link_target' });
    });

    it('checks token identity before resolution and indices', () => {
        const input = validInput();
        input.linkTarget = { tick: 'OTHER', issueActionIndex: '0' };
        input.resolved = { ready: false, reason: 'not_complete' };
        expect(artworkLinkFields(input)).toEqual({ ok: false, reason: 'token_mismatch' });
    });

    it('passes through the unresolved reason before checking indices', () => {
        const input = validInput();
        input.linkTarget.issueActionIndex = '0';
        input.resolved = { ready: false, reason: 'not_complete' };
        expect(artworkLinkFields(input)).toEqual({ ok: false, reason: 'not_complete' });
    });
});

describe('multipart artwork LINK input ownership', () => {
    it('does not mutate any input', () => {
        const input = validInput();
        const before = structuredClone(input);
        artworkLinkFields(input);
        expect(input).toEqual(before);
    });
});
