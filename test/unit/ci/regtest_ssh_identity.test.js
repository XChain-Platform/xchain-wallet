// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ci = readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8');

// The step body runs from its `run: |` line to the next `- name:` entry.
function stepBody(name) {
    const start = ci.indexOf(`- name: ${name}`);
    expect(start).toBeGreaterThan(-1);
    const next = ci.indexOf('- name:', start + 1);
    return ci.slice(start, next === -1 ? undefined : next);
}

describe('regtest venue ssh identity', () => {
    it('names the regtest key in the ssh config before the fixtures make their own ssh calls', () => {
        const body = stepBody('Open the regtest tunnel');
        expect(body).toContain('IdentityFile ~/.ssh/regtest_key');
        expect(body).toContain('IdentitiesOnly yes');
        expect(body).toContain('>> ~/.ssh/config');
        expect(body).toContain('chmod 600 ~/.ssh/config');
    });

    it('writes the config after the key file exists', () => {
        const body = stepBody('Open the regtest tunnel');
        expect(body.indexOf('chmod 600 ~/.ssh/regtest_key')).toBeLessThan(body.indexOf('IdentityFile ~/.ssh/regtest_key'));
    });
});
