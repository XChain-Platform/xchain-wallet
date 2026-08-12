// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §9: the Electron CVE clock has a mechanism, and the
// mechanism is right.
//
// WHY. §9 owns the security-patch cadence for a wallet that ships a
// browser engine, and it owned it in prose. Measured 2026-08-02: the
// shipped pin was 41.3.0 (2026-04-22) while 41.10.3 existed, and majors 42
// and 43 had both come and gone past §9's own four-week rule. Nobody was
// wrong on purpose; nothing was reading the rule.
//
// So the rule is now a tool, and the tool is driven here against fixed
// registry documents rather than the live registry: a test that needs the
// network is a test that goes red for reasons that are not the code, and
// this one has to be trustworthy enough to gate a release.
//
// The cases are the decisions the tool makes, one each: current, a patch
// behind on our own major, a major past the grace window, a major still
// inside it, out of the support window entirely, the oldest-supported
// warning, an unreadable pin, and an unreachable registry - which must
// NEVER read as current.

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assess, POLICY, readPinnedVersion } from '../../../tools/release/electron-cadence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const TOOL = join(root, 'tools/release/electron-cadence.mjs');

const NOW = '2026-08-02T00:00:00.000Z';
const daysAgo = (n) => new Date(Date.parse(NOW) - n * 86400000).toISOString();

// THE POLICY VALUES THEMSELVES, not just the comparisons that use them.
// The cases below build their fixtures FROM these constants, so they
// verify the arithmetic and would happily follow the numbers anywhere -
// widening the window to ten years would move the fixtures with it and
// pass. §9's rule is four weeks, and upstream maintains three majors;
// those are the numbers, so they are asserted as numbers.
assert.equal(POLICY.MAJOR_GRACE_DAYS, 28,
    "§9: upgrade to each new stable major within 4 weeks of upstream release");
assert.equal(POLICY.SUPPORTED_MAJORS, 3,
    'Electron maintains the newest three stable majors; older ones get no fixes at all');

/** A registry document shaped like npm's, with the clock pinned. */
function packument({ tags, time = {} }) {
    return { 'dist-tags': tags, time, _now: NOW };
}

// ------------------------------------------------------------- current

{
    const doc = packument({
        tags: { latest: '43.2.0', '43-x-y': '43.2.0', '42-x-y': '42.8.0', '41-x-y': '41.10.3' },
    });
    const r = assess('43.2.0', doc);
    assert.equal(r.ok, true, 'the newest stable is current');
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.supportWindow, [41, 43]);
}

// --------------------------------------------- a patch behind on our major

{
    const doc = packument({
        tags: { latest: '43.2.0', '43-x-y': '43.2.0' },
        time: { '43.2.0': daysAgo(3) },
    });
    const r = assess('43.0.0', doc);
    assert.equal(r.ok, false, 'a newer patch on our own major is a failure, not a note');
    assert.equal(r.problems.length, 1);
    assert.equal(r.problems[0].kind, 'patch');
    assert.match(r.problems[0].detail, /43\.2\.0 exists/);
}

// -------------------------------------- a newer major, inside and outside grace

{
    const inside = packument({
        tags: { latest: '43.0.0', '43-x-y': '43.0.0', '42-x-y': '42.8.0' },
        time: { '43.0.0': daysAgo(POLICY.MAJOR_GRACE_DAYS - 1) },
    });
    const r = assess('42.8.0', inside);
    assert.equal(r.ok, true,
        `a major ${POLICY.MAJOR_GRACE_DAYS - 1} days old is inside §9's window`);

    const outside = packument({
        tags: { latest: '43.0.0', '43-x-y': '43.0.0', '42-x-y': '42.8.0' },
        time: { '43.0.0': daysAgo(POLICY.MAJOR_GRACE_DAYS + 1) },
    });
    const late = assess('42.8.0', outside);
    assert.equal(late.ok, false, 'one day past the window fails');
    assert.equal(late.problems[0].kind, 'major');

    // The boundary itself, stated rather than left to a reader: the rule is
    // "within N days", so exactly N is still inside.
    const boundary = packument({
        tags: { latest: '43.0.0', '43-x-y': '43.0.0', '42-x-y': '42.8.0' },
        time: { '43.0.0': daysAgo(POLICY.MAJOR_GRACE_DAYS) },
    });
    assert.equal(assess('42.8.0', boundary).ok, true, 'exactly at the window is inside it');
}

// --------------------------------------------------- the support window

{
    // Two majors behind: still supported (41 of 41-43), but it is the
    // oldest, so the next release drops it. A warning, not a failure.
    const doc = packument({
        tags: { latest: '43.2.0', '43-x-y': '43.2.0', '42-x-y': '42.8.0', '41-x-y': '41.10.3' },
        time: {},
    });
    const oldest = assess('41.10.3', doc);
    assert.ok(oldest.problems.some((p) => p.kind === 'about-to-be-unsupported'),
        'the oldest supported major is called out before it falls off');
    assert.equal(oldest.ok, true, 'but being the oldest supported major is not itself a failure');

    // Three behind: outside the window. No fixes exist at any version.
    const dead = assess('40.10.6', packument({
        tags: {
            latest: '43.2.0', '43-x-y': '43.2.0', '42-x-y': '42.8.0',
            '41-x-y': '41.10.3', '40-x-y': '40.10.6',
        },
    }));
    assert.equal(dead.ok, false);
    assert.ok(dead.problems.some((p) => p.kind === 'unsupported'),
        'an unsupported major is the loudest case: nothing upstream will fix it');
}

// ------------------------------------------------- the pin it actually reads

{
    // The LOCKFILE is the pin, because every release lane installs
    // --frozen-lockfile. A tool that read the caret from package.json would
    // report a version nobody ships.
    const pin = readPinnedVersion();
    assert.match(pin.version, /^\d+\.\d+\.\d+/, 'the resolved version parses out of the lockfile');
    assert.ok(pin.range.startsWith('^') || pin.range === pin.version,
        'and the declared range is reported beside it');

    const broken = mkdtempSync(join(tmpdir(), 'xchain-cadence-'));
    try {
        writeFileSync(join(broken, 'lock.yaml'), 'importers:\n  .:\n    dependencies: {}\n');
        writeFileSync(join(broken, 'pkg.json'), '{"devDependencies":{"electron":"^41.3.0"}}');
        const missing = readPinnedVersion({
            lockfile: join(broken, 'lock.yaml'), manifest: join(broken, 'pkg.json'),
        });
        assert.equal(missing.version, null, 'a lockfile with no electron is a config error');
    } finally {
        rmSync(broken, { recursive: true, force: true });
    }
}

// ------------------------------------------- exit codes, driven end to end

{
    const tmp = mkdtempSync(join(tmpdir(), 'xchain-cadence-run-'));
    try {
        const current = join(tmp, 'current.json');
        writeFileSync(current, JSON.stringify(packument({
            tags: { latest: readPinnedVersion().version, [`${readPinnedVersion().version.split('.')[0]}-x-y`]: readPinnedVersion().version },
        })));
        const ok = spawnSync(process.execPath, [TOOL, '--offline', current], { encoding: 'utf8' });
        assert.equal(ok.status, 0, `a current pin exits 0:\n${ok.stdout}${ok.stderr}`);

        const behind = join(tmp, 'behind.json');
        writeFileSync(behind, JSON.stringify(packument({
            tags: { latest: '99.0.0', '99-x-y': '99.0.0' },
            time: { '99.0.0': daysAgo(400) },
        })));
        const bad = spawnSync(process.execPath, [TOOL, '--offline', behind], { encoding: 'utf8' });
        assert.equal(bad.status, 1, 'being behind exits 1');

        // The one that matters most: a registry we could not reach must not
        // look like a clean bill of health.
        const gone = spawnSync(process.execPath, [TOOL, '--offline', join(tmp, 'nope.json')],
            { encoding: 'utf8' });
        assert.equal(gone.status, 3, 'unreachable/unreadable registry data is INCONCLUSIVE, not ok');
        assert.match(gone.stderr, /INCONCLUSIVE/);
        assert.match(gone.stderr, /not green just because/);

        // --json is what a cron or a dashboard would read.
        const asJson = spawnSync(process.execPath, [TOOL, '--offline', behind, '--json'],
            { encoding: 'utf8' });
        const parsed = JSON.parse(asJson.stdout);
        assert.equal(parsed.ok, false);
        assert.ok(Array.isArray(parsed.problems) && parsed.problems.length > 0);
        assert.ok(parsed.declaredRange, 'the declared range travels with the report');
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

console.log('electron-cadence smoke: ok');
