// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyPinnedSignature } from '../../../tools/release/gpg-signature-status.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const verify = join(root, 'tools', 'release', 'verify.sh');
const work = mkdtempSync(join(tmpdir(), 'release-sigstatus-'));
const release = join(work, 'release');
const bin = join(work, 'bin');
mkdirSync(release);
mkdirSync(bin);

const artifact = 'xchain-wallet-extension-v9.9.9.zip';
const bytes = 'fixture artifact\n';
const digest = createHash('sha256').update(bytes).digest('hex');
writeFileSync(join(release, artifact), bytes);
writeFileSync(join(release, 'RELEASE_HASHES.txt'), [
    '# XChain Wallet release manifest',
    '# manifest-version: 2',
    '# tag: v9.9.9',
    '# tag-commit: 0000000000000000000000000000000000000000',
    '# built: 2026-01-01T00:00:00Z',
    '# dev-mock-gate: enforced',
    '# artifacts: 1',
    `# profile default: ./${artifact}`,
    `${digest}  ./${artifact}`,
    '',
].join('\n'));
writeFileSync(join(release, 'RELEASE_HASHES.txt.asc'), 'fixture signature\n');

const fakeGpg = join(bin, 'gpg');
writeFileSync(fakeGpg, [
    '#!/usr/bin/env bash',
    'if [[ "$*" == *"--version"* ]]; then echo "fixture gpg"; exit 0; fi',
    'printf "%s\\n" "$FAKE_GPG_STATUS" >&3',
    '',
].join('\n'));
chmodSync(fakeGpg, 0o755);

const signing = 'AB'.repeat(20);
const primary = 'CD'.repeat(20);
const good = `[GNUPG:] GOODSIG ${signing.slice(-16)} Fixture key`;
const valid = `[GNUPG:] VALIDSIG ${signing} 2026-01-01 0 4 0 22 8 00 ${primary}`;
const fixtures = [
    { name: 'valid', status: `${good}\n${valid}` },
    { name: 'expired key', status: `${good}\n[GNUPG:] EXPKEYSIG ${signing.slice(-16)} Fixture key\n${valid}` },
    { name: 'revoked key', status: `${good}\n[GNUPG:] REVKEYSIG ${signing.slice(-16)} Fixture key\n${valid}` },
    { name: 'expired signature', status: `${good}\n[GNUPG:] EXPSIG ${signing.slice(-16)} Fixture key\n${valid}` },
    { name: 'missing GOODSIG', status: valid },
    { name: 'wrong GOODSIG', status: `[GNUPG:] GOODSIG ${'EF'.repeat(8)} Other key\n${valid}` },
    { name: 'two VALIDSIG records', status: `${good}\n${valid}\n${valid}` },
];

for (const fixture of fixtures) {
    const expected = classifyPinnedSignature(fixture.status, primary) === 'ok';
    const result = spawnSync('bash', [
        verify, '--input', release, '--tag', 'v9.9.9', '--key', primary,
    ], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_GPG_STATUS: fixture.status },
        encoding: 'utf8',
    });
    assert.equal(result.status === 0, expected, `${fixture.name}: ${result.stderr}`);
}

console.log(`PASS release-verify-sigstatus.smoke.js (${fixtures.length} signature-status cases)`);
