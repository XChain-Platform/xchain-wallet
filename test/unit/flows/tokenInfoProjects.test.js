// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// normalizeTokenInfo `projects` passthrough — the explorer's getToken
// `projects[]` (project ticks whose CURRENT roster includes this token)
// backs the "Official token" banner on TokenDetail + ManageToken.

import { describe, it, expect } from 'vitest';
import { normalizeTokenInfo } from '../../../packages/core/src/flows/tokenInfo.js';

describe('normalizeTokenInfo projects', () => {
    it('extracts and uppercases project ticks', () => {
        const info = normalizeTokenInfo('bitcoin-mainnet', 'MEMA', {
            info: { description: 'd', owner: 'addr' },
            projects: [
                { project: 'proj1', link_action_index: 400, roster_action_index: 399 },
                { project: 'PROJ2', link_action_index: 500, roster_action_index: 499 },
            ],
        });
        expect(info.projects).toEqual(['PROJ1', 'PROJ2']);
    });

    it('defaults to an empty array when absent', () => {
        const info = normalizeTokenInfo('bitcoin-mainnet', 'MEMA', { info: {} });
        expect(info.projects).toEqual([]);
    });

    it('drops malformed entries', () => {
        const info = normalizeTokenInfo('bitcoin-mainnet', 'MEMA', {
            projects: [null, {}, { project: 42 }, { project: '' }, { project: 'OK' }],
        });
        expect(info.projects).toEqual(['OK']);
    });

    it('tolerates a non-array projects field', () => {
        const info = normalizeTokenInfo('bitcoin-mainnet', 'MEMA', { projects: 'nope' });
        expect(info.projects).toEqual([]);
    });
});
