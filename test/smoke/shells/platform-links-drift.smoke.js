// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Platform switcher: vendored-copy drift.
//
// packages/core/src/shared/platform-links.json is a copy of a file generated
// in xchain-websites and published at
// https://xchain.io/assets/platform-links.json. This repo's CI cannot see that
// repo, so a file-to-file assertion is impossible; instead we fetch the
// published copy and compare.
//
// SKIPS LOUDLY when the network or the host is unavailable. A silent skip
// would make an offline runner look like a verified one, and this check exists
// precisely to notice something nobody is watching. It exits 0 on skip so an
// offline dev machine is not blocked, and prints a warning that says the
// verification did NOT happen.
//
// On failure: rebuild xchain-websites and re-copy shared/platform-links.json
// rather than hand-editing the vendored file. Hand-copying a list between
// repos without this test is exactly how xchain-websites ended up with four
// stylesheets that silently disagreed.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const VENDORED = join(here, '..', '..', '..', 'packages', 'core', 'src', 'shared', 'platform-links.json');
const PUBLISHED = 'https://xchain.io/assets/platform-links.json';
const TIMEOUT_MS = 8000;

const vendored = JSON.parse(readFileSync(VENDORED, 'utf8'));

// Offline half: the vendored file must at least be structurally sound, which
// is checkable with no network at all.
assert.ok(Array.isArray(vendored.links) && vendored.links.length > 0, 'vendored list must be a non-empty array');
assert.match(vendored.$comment || '', /GENERATED/, 'vendored list must declare itself generated');
assert.ok(vendored.links.some((p) => p.key === 'wallet'), 'the wallet must appear in its own switcher');
for (const p of vendored.links) {
    assert.match(p.href, /^https:\/\/([a-z-]+\.)?xchain\.io\/$/, `${p.key} must be an https xchain.io origin`);
}

let published = null;
let reason = null;
const ctrl = new AbortController();
const killer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
try {
    const res = await fetch(PUBLISHED, { signal: ctrl.signal });
    if (res.ok) published = await res.json();
    else reason = `HTTP ${res.status}`;
} catch (err) {
    reason = err.name === 'AbortError' ? `no response in ${TIMEOUT_MS}ms` : err.message;
} finally {
    clearTimeout(killer);
}

if (!published) {
    console.warn(`WARN: SKIPPED the drift check: could not fetch ${PUBLISHED} (${reason}).`);
    console.warn('WARN: the vendored platform-links.json was NOT verified against the published copy.');
    console.warn('WARN: re-run with network access before trusting a green result here.');
    console.log('OK: platform links smoke (offline half only: 4 structural checks, drift check SKIPPED)');
} else {
    assert.deepEqual(
        published.links,
        vendored.links,
        'the vendored platform-links.json has drifted from the published list. '
        + 'Rebuild xchain-websites and re-copy shared/platform-links.json into '
        + 'packages/core/src/shared/ (do not hand-edit it).',
    );
    console.log(`OK: platform links smoke (4 structural checks + ${published.links.length} entries match the published list)`);
}
