// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ManageToken reports the issuer on every shell render, so the shells'
// updater must hand back the same object when nothing changed, or React
// re-renders forever ("Maximum update depth exceeded" on Manage token).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { withResolvedIssuer } from '../../../packages/core/src/shared/utils/tokenDetailIssuer.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('withResolvedIssuer', () => {
    const ref = { chainId: 'bitcoin-mainnet', tick: 'XCP', issuer: '1Issuer' };

    it('keeps the same object when the issuer is already recorded', () => {
        expect(withResolvedIssuer('1Issuer')(ref)).toBe(ref);
    });

    it('treats a missing creator and a null issuer as the same', () => {
        const none = { chainId: 'c', tick: 't', issuer: null };
        expect(withResolvedIssuer(undefined)(none)).toBe(none);
        const unset = { chainId: 'c', tick: 't' };
        expect(withResolvedIssuer(null)(unset)).toBe(unset);
    });

    it('records a new issuer in a new object', () => {
        const next = withResolvedIssuer('1Other')(ref);
        expect(next).not.toBe(ref);
        expect(next).toEqual({ ...ref, issuer: '1Other' });
    });

    it('leaves an empty ref empty', () => {
        expect(withResolvedIssuer('1Issuer')(null)).toBe(null);
    });

    it('is what every shell hands ManageToken', () => {
        for (const shell of ['packages/web/src/App.jsx', 'packages/desktop/renderer/App.jsx', 'packages/extension/src/popup/App.jsx']) {
            const src = readFileSync(join(REPO, shell), 'utf8');
            expect([shell, src.includes('setTokenDetailRef(withResolvedIssuer(creator))')]).toEqual([shell, true]);
            expect([shell, src.includes('issuer: creator || null }')]).toEqual([shell, false]);
        }
    });
});
