// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import {
    LIST_SHARE_MAX_MEMBERS,
    isShareConfirmed,
    listShareEligibility,
} from '../../../packages/core/src/flows/listShareEligibility.js';

describe('listShareEligibility', () => {
    it.each([
        ['1', 'token'],
        ['2', 'address'],
    ])('allows a type %s %s list', (type) => {
        expect(listShareEligibility({ type, memberCount: 12, isShared: false })).toEqual({
            ok: true,
            reasons: [],
            countKnown: true,
        });
    });

    it('refuses a union list', () => {
        expect(listShareEligibility({ type: '3', memberCount: 12, isShared: false })).toMatchObject({
            ok: false,
            reasons: [{ code: 'union', text: 'A union list cannot be shared in this release.' }],
        });
    });

    it('refuses an unsupported list type', () => {
        expect(listShareEligibility({ type: '4', memberCount: 12, isShared: false })).toMatchObject({
            ok: false,
            reasons: [{ code: 'type', text: 'Only token and address lists can be shared.' }],
        });
    });

    it('refuses an already-shared list', () => {
        expect(listShareEligibility({ type: '1', memberCount: 12, isShared: true }))
            .toMatchObject({
                ok: false,
                reasons: [{
                    code: 'already-shared',
                    text: 'This list is already shared; a shared list cannot be shared again.',
                }],
            });
    });

    it('allows exactly 10,000 members and refuses 10,001', () => {
        expect(listShareEligibility({
            type: '1', memberCount: LIST_SHARE_MAX_MEMBERS, isShared: false,
        }).ok).toBe(true);
        expect(listShareEligibility({
            type: '1', memberCount: LIST_SHARE_MAX_MEMBERS + 1, isShared: false,
        })).toMatchObject({
            ok: false,
            reasons: [{
                code: 'too-many',
                text: 'A list over 10,000 members cannot be shared.',
            }],
        });
    });

    it.each([null, undefined])('allows an unknown member count of %s', (memberCount) => {
        expect(listShareEligibility({ type: '2', memberCount, isShared: false })).toEqual({
            ok: true,
            reasons: [],
            countKnown: false,
        });
    });

    it('returns multiple reasons in the required order', () => {
        expect(listShareEligibility({ type: '3', memberCount: 12, isShared: true }).reasons)
            .toEqual([
                { code: 'union', text: 'A union list cannot be shared in this release.' },
                {
                    code: 'already-shared',
                    text: 'This list is already shared; a shared list cannot be shared again.',
                },
            ]);
    });
});

describe('isShareConfirmed', () => {
    it.each([
        ['SHARE', true],
        ['  SHARE\n', true],
        ['share', false],
        ['Share', false],
        ['', false],
        [null, false],
        [undefined, false],
    ])('checks %j case-sensitively', (typed, expected) => {
        expect(isShareConfirmed(typed)).toBe(expected);
    });
});
