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
    SHELLS,
    WIRE_AUDIT,
    egressHostsFor,
    registeredHosts,
} from '../../../packages/core/src/privacy/wireAudit.js';

describe('privacy/wireAudit', () => {
    it('defines each shipped shell exactly once', () => {
        expect(SHELLS).toEqual(['web', 'desktop', 'extension', 'mobile']);
        expect(new Set(SHELLS).size).toBe(SHELLS.length);
    });

    it('keeps every audit row complete and scoped to supported shells', () => {
        for (const entry of WIRE_AUDIT) {
            expect(entry.host).toEqual(expect.any(String));
            expect(entry.host.length).toBeGreaterThan(0);
            expect(['first', 'third']).toContain(entry.party);
            expect(entry.why).toEqual(expect.any(String));
            expect(entry.why.length).toBeGreaterThan(0);
            expect(entry.carries).toEqual(expect.any(String));
            expect(entry.carries.length).toBeGreaterThan(0);
            expect(entry.control).toEqual(expect.any(String));
            expect(entry.control.length).toBeGreaterThan(0);
            expect(entry.source).toEqual(expect.any(String));
            expect(entry.source.length).toBeGreaterThan(0);
            expect(Array.isArray(entry.shells)).toBe(true);
            expect(new Set(entry.shells).size).toBe(entry.shells.length);
            expect(entry.shells.every((shell) => SHELLS.includes(shell))).toBe(true);
        }
    });

    it('returns a sorted, unique host list derived from each shell row', () => {
        for (const shell of SHELLS) {
            const expected = [...new Set(
                WIRE_AUDIT
                    .filter((entry) => entry.shells.includes(shell))
                    .map((entry) => entry.host),
            )].sort();

            expect(egressHostsFor(shell)).toEqual(expected);
        }
    });

    it('collapses multiple wildcard entries to one disclosure host', () => {
        const mobileWildcardRows = WIRE_AUDIT.filter(
            (entry) => entry.host === '*' && entry.shells.includes('mobile'),
        );
        const mobileWildcardHosts = egressHostsFor('mobile').filter((host) => host === '*');

        expect(mobileWildcardRows.length).toBeGreaterThan(1);
        expect(mobileWildcardHosts).toEqual(['*']);
    });

    it('returns fresh collections that cannot alter the audit', () => {
        const hosts = egressHostsFor('web');
        hosts.push('mutated.example');

        const registered = registeredHosts();
        registered.add('mutated.example');

        expect(egressHostsFor('web')).not.toContain('mutated.example');
        expect(registeredHosts()).not.toContain('mutated.example');
    });

    it('deep-freezes audit rows so consumers cannot alter egress policy', () => {
        const entry = WIRE_AUDIT[0];
        const originalHost = entry.host;
        const originalShells = [...entry.shells];

        expect(Object.isFrozen(entry)).toBe(true);
        expect(Object.isFrozen(entry.shells)).toBe(true);
        expect(() => { entry.host = 'mutated.example'; }).toThrow(TypeError);
        expect(() => { entry.shells.push('mutated'); }).toThrow(TypeError);
        expect(entry.host).toBe(originalHost);
        expect(entry.shells).toEqual(originalShells);
    });

    it('registers every concrete host and excludes the wildcard class', () => {
        const expected = new Set(WIRE_AUDIT.map((entry) => entry.host));
        expected.delete('*');

        expect(registeredHosts()).toEqual(expected);
        expect(registeredHosts()).not.toContain('*');
    });

    it('rejects unknown shell values with the supported choices', () => {
        expect(() => egressHostsFor('ios')).toThrow(
            'wireAudit: unknown shell "ios"; expected one of web, desktop, extension, mobile',
        );
    });
});
