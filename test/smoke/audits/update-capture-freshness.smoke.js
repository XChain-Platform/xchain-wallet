// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The archived update-check capture must describe the updater we SHIP
// ( §7.6).
//
// WHY THIS EXISTS. §7.6 is explicit that the download page may state only
// what a capture SHOWS, not what we believe, and `docs/update-check-capture.json`
// is that capture. But a capture is a measurement of one version, and the
// version moves: `electron-updater` went 6.8.3 -> 6.8.9 to clear two HIGH
// advisories in the update path itself. Nothing noticed, because
// `capture-update-check.mjs` was invoked by nothing at all - not a workflow,
// not a script, not a test. The archive could sit at any age while the page
// kept citing it, and the failure is silent by construction: a stale capture
// is a well-formed file that answers the wrong question.
//
// So the freshness of the archive is now a property something checks. This
// does NOT re-drive the capture (that stands up a server and a real updater,
// which belongs in the release procedure, not in every smoke run). It asserts
// the cheap invariant that catches the drift that actually happens: the
// version the archive was taken at is the version the lockfile installs.
//
// The two privacy facts the page leans on are pinned here too, so a capture
// refreshed at a NEWER version cannot quietly carry a different answer:
// the as-shipped staging id is the all-zero UUID and it does not vary.

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const require = createRequire(import.meta.url);

const capture = JSON.parse(
    readFileSync(join(root, 'docs', 'update-check-capture.json'), 'utf8'),
);

// The version actually installed, resolved the way the desktop shell resolves
// it, rather than read out of a range in package.json: every release lane
// installs --frozen-lockfile, so the resolution is the pin (§9 makes the same
// point about the electron caret).
const installed = require(
    require.resolve('electron-updater/package.json', {
        paths: [join(root, 'packages', 'desktop')],
    }),
).version;

assert.equal(
    capture['electron-updater'],
    installed,
    'docs/update-check-capture.json was captured at electron-updater '
    + `${capture['electron-updater']} but ${installed} is installed. The `
    + 'download page states only what this capture shows, so a capture from a '
    + 'different version is a privacy claim about software we do not ship. '
    + 'Re-drive it: node tools/release/capture-update-check.mjs --drive',
);

const shipped = capture.persistentIdentifier?.asShipped;
assert.ok(shipped, 'the capture must record the as-shipped identifier result');
assert.equal(
    shipped.value,
    '00000000-0000-0000-0000-000000000000',
    'the as-shipped x-user-staging-id must be the all-zero UUID: upstream '
    + 'generates a per-install identifier and reuses it forever, and the page '
    + 'says no such identifier is sent',
);
assert.equal(
    shipped.constantAcrossChecks,
    true,
    'and it must not vary between installs, which is the whole claim',
);

console.log(
    'OK: update-capture freshness ( §7.6: the archived update-check '
    + `capture was taken at the installed electron-updater (${installed}), and `
    + 'records the as-shipped staging id as a constant all-zero UUID)',
);
