// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
import { describe, it, expect } from 'vitest';
import { createDevMockDecoder } from '../../../packages/web/src/devMockDecoder.js';

const stub = (hex) => (hex === 'good' ? { actionString: 'SEND|0|XCP|1|addr' } : { inputs: [], outputs: [] });

describe('createDevMockDecoder', () => {
    const decoder = createDevMockDecoder(stub);

    it.each(['decodeActionFromPsbt', 'decodeActionStringFromPsbt'])('%s returns ok with the action string', (method) => {
        expect(decoder[method]('good')).toEqual({ ok: true, actionString: 'SEND|0|XCP|1|addr' });
    });

    it.each(['decodeActionFromPsbt', 'decodeActionStringFromPsbt'])('%s reports decode-failed without an action string', (method) => {
        expect(decoder[method]('bad')).toEqual({ ok: false, reason: 'decode-failed' });
    });
});
