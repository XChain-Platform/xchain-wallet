// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { redactDiagnosticText } from '../../../../packages/core/src/shared/utils/diagnosticText.js';

const XPUB = 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz';
const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const LTUB = 'Ltub2SSUS19CirucWFod2ZsYA2J4v4U76YiCXHdcQttnoiy5aGanFHCPDBX7utfG6dhsNrjQ7a6Hx3XJLCM47cWY4F7SPDsZJxwVRcLUEmvchzn';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';

describe('redactDiagnosticText credentials', () => {
    it.each([
        ['xpub', `wallet ${XPUB}`, XPUB],
        ['zpub', `watch ${ZPUB}`, ZPUB],
        ['Ltub', `ltc ${LTUB}`, LTUB],
        ['bearer header', 'Authorization: Bearer abcDEF123456.token-value', 'abcDEF123456'],
        ['jwt', `request ${JWT}`, JWT],
        ['session token', 'sessionToken=abc123xyz987', 'abc123xyz987'],
        ['session id', 'sessionId: s_9f8e7d', 's_9f8e7d'],
        ['pwd', 'pwd: hunter2', 'hunter2'],
        ['api key', 'api_key=sk_live_abcdef123456', 'sk_live_abcdef123456'],
        ['cookie', 'Cookie: session=abcdef0123456789', 'abcdef0123456789'],
    ])('removes a %s', (_name, input, secret) => {
        const out = redactDiagnosticText(input);
        expect(out).not.toContain(secret);
        expect(out).toContain('[REDACTED]');
    });

    it('keeps ordinary sentences readable', () => {
        expect(redactDiagnosticText('token: XCHAIN sent 5')).toBe('token: XCHAIN sent 5');
    });
});
