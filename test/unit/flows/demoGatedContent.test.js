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
import {
    getDemoGatedGroupsForTick,
    getDemoGatedPlaintextBase64,
    isDemoGatedActionIndex,
} from '../../../packages/core/src/flows/demoGatedContent.js';

const FIXTURE_TICKS = ['PEPECREATURE'];

describe('demo gated content', () => {
    it('returns no groups for empty and unknown ticks', () => {
        expect(getDemoGatedGroupsForTick('')).toEqual([]);
        expect(getDemoGatedGroupsForTick('NOT_A_FIXTURE')).toEqual([]);
    });

    it('matches fixture ticks without regard to case', () => {
        const expected = getDemoGatedGroupsForTick(FIXTURE_TICKS[0]);
        expect(getDemoGatedGroupsForTick('pepecreature')).toEqual(expected);
        expect(getDemoGatedGroupsForTick('pEpEcReAtUrE')).toEqual(expected);
    });

    it('exposes complete unlock metadata for every fixture', () => {
        for (const tick of FIXTURE_TICKS) {
            const groups = getDemoGatedGroupsForTick(tick);
            expect(groups.length).toBeGreaterThan(0);
            for (const group of groups) {
                expect(group).toEqual(expect.objectContaining({
                    keyHash: expect.any(String),
                    encryptionMethod: expect.any(Number),
                    gateTicker: expect.any(String),
                    files: expect.any(Array),
                }));
                expect(group.files.length).toBeGreaterThan(0);
                for (const file of group.files) {
                    expect(file).toEqual(expect.objectContaining({
                        actionIndex: expect.any(String),
                        name: expect.any(String),
                        type: expect.any(String),
                        title: expect.any(String),
                        status: expect.any(String),
                    }));
                    expect(file.actionIndex.startsWith('demo:')).toBe(true);
                    expect(isDemoGatedActionIndex(file.actionIndex)).toBe(true);
                }
            }
        }
    });

    it('recognizes only demo-prefixed string action indices', () => {
        expect(isDemoGatedActionIndex(123)).toBe(false);
        expect(isDemoGatedActionIndex('123')).toBe(false);
        expect(isDemoGatedActionIndex(undefined)).toBe(false);
    });

    it('encodes every listed plaintext with its exact byte length', () => {
        expect(getDemoGatedPlaintextBase64('demo:not-listed')).toBe(null);
        const groups = getDemoGatedGroupsForTick(FIXTURE_TICKS[0]);
        for (const group of groups) {
            for (const file of group.files) {
                const result = getDemoGatedPlaintextBase64(file.actionIndex);
                expect(result?.plaintextBase64).toEqual(expect.any(String));
                const decoded = Buffer.from(result.plaintextBase64, 'base64');
                expect(decoded.toString('base64')).toBe(result.plaintextBase64);
                expect(decoded.length).toBe(result.byteLength);
            }
        }
    });
});
