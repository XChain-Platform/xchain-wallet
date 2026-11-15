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
import { humanizeError } from '../../../packages/core/src/shared/utils/humanizeError.js';

describe('humanizeError explorer details redaction', () => {
    it('drops the request path and stack frames from details', () => {
        const err = new Error(
            'Explorer returned HTTP 503 for /RBTC/api/feequote?action=SEND\n'
            + '    at fetchJson (file:///app/sdk/explorer.js:10:5)\n'
            + '    at async run (file:///app/sdk/run.js:3:1)',
        );
        const out = humanizeError(err, 'send');
        expect(out.details).toContain('Explorer returned HTTP 503');
        expect(out.details).not.toContain('/RBTC/api/');
        expect(out.details).not.toContain('feequote');
        expect(out.details).not.toContain('\n    at ');
        expect(out.details).not.toContain('fetchJson');
    });
});
