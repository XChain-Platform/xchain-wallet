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
