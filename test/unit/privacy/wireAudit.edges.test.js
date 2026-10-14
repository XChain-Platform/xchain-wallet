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

describe('privacy/wireAudit edge behavior', () => {
    it.each([
        [null, 'null'],
        [undefined, 'undefined'],
        [0, '0'],
        [{ shell: 'web' }, '{"shell":"web"}'],
    ])('rejects unsupported shell value %s without coercing it', (shell, rendered) => {
        expect(() => egressHostsFor(shell)).toThrow(
            `wireAudit: unknown shell ${rendered}; expected one of ${SHELLS.join(', ')}`,
        );
    });

    it.each(['WEB', ' web', 'web ', 'ios'])('requires an exact shipped shell name: %s', (shell) => {
        expect(() => egressHostsFor(shell)).toThrow(/wireAudit: unknown shell/);
    });

    it('freezes the shell list and the audit list themselves', () => {
        expect(Object.isFrozen(SHELLS)).toBe(true);
        expect(Object.isFrozen(WIRE_AUDIT)).toBe(true);
        expect(() => SHELLS.push('ios')).toThrow(TypeError);
        expect(() => WIRE_AUDIT.pop()).toThrow(TypeError);
    });

    it.each(SHELLS)('returns one wildcard for %s even though multiple rows match', (shell) => {
        const matchingRows = WIRE_AUDIT.filter(
            (entry) => entry.host === '*' && entry.shells.includes(shell),
        );

        expect(matchingRows.length).toBeGreaterThan(1);
        expect(egressHostsFor(shell).filter((host) => host === '*')).toEqual(['*']);
    });

    it.each(SHELLS)('returns a mutable snapshot for %s without exposing audit state', (shell) => {
        const first = egressHostsFor(shell);
        const second = egressHostsFor(shell);

        expect(first).not.toBe(second);
        first.length = 0;
        expect(egressHostsFor(shell)).toEqual(second);
    });

    it('returns an isolated registered-host set on every call', () => {
        const first = registeredHosts();
        const second = registeredHosts();

        expect(first).not.toBe(second);
        first.clear();
        expect(registeredHosts()).toEqual(second);
    });
});
