// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §55 / Cluster T FOLLOWUP 3 — Glossary auto-appendix.
// Pins the generator's existence + the in-sync state of docs/GLOSSARY.md
// against canonical sources, so a maintainer who renames a BridgeErrorCode
// or adds a SitePermissions key without re-running the generator gets a
// red smoke.

import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const generatorPath = join(wsRoot, 'tools', 'glossary', 'generate-appendix.js');
const glossaryPath = join(wsRoot, 'docs', 'GLOSSARY.md');

assert.ok(existsSync(generatorPath),
    'tools/glossary/generate-appendix.js exists');
assert.ok(existsSync(glossaryPath),
    'docs/GLOSSARY.md exists');

// --- 1. --check returns exit 0 when in sync ---------------------------

const r = spawnSync(process.execPath, [generatorPath, '--check'], {
    cwd: wsRoot,
    encoding: 'utf8',
});
if (r.status !== 0) {
    console.error('Generator stdout:', r.stdout);
    console.error('Generator stderr:', r.stderr);
}
assert.equal(r.status, 0,
    'GLOSSARY.md appendix is in sync with bridge-spec / connectedSite sources. '
    + 'If this fails, run `node tools/glossary/generate-appendix.js` and commit.');

// --- 2. Markers + key codes / keys are present in the doc -------------

const { readFileSync } = await import('node:fs');
const glossary = readFileSync(glossaryPath, 'utf8');
assert.ok(/<!-- BEGIN auto-generated glossary appendix -->/.test(glossary),
    'GLOSSARY.md carries the begin marker');
assert.ok(/<!-- END auto-generated glossary appendix -->/.test(glossary),
    'GLOSSARY.md carries the end marker');
// Sanity: a couple of well-known codes are listed in the appendix.
for (const code of ['USER_REJECTED', 'WALLET_LOCKED', 'BRIDGE_VERSION_MISMATCH']) {
    assert.ok(new RegExp(`\\b${code}\\b`).test(glossary),
        `appendix lists \`${code}\``);
}
// Sanity: SitePermissions keys are listed.
for (const key of ['chains', 'accounts', 'canSignMessage', 'canSignAction']) {
    assert.ok(new RegExp(`\`${key}\``).test(glossary),
        `appendix lists \`${key}\` permission key`);
}

console.log('glossary-appendix smoke OK');
