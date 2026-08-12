// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §6: the release credentials have an expiry clock, and the
// clock is right.
//
// WHY. §6 records four dated credentials and calls the K3 certificate's date
// "a renewal date and not a fact to forget". Nothing read it: a `git grep` for
// either date across `tools/`, `test/` and `.github/` returned no hits. That
// is §9's own defect one packaging over - a cadence that is only prose is not
// a cadence - and it is worse here, because an expired signing certificate
// produces a release that builds clean, signs clean, passes every gate, and is
// refused by Gatekeeper on every user's machine.
//
// The cases are the decisions the tool makes, driven against a FIXED clock and
// fixed declarations rather than against the calendar or the release machine's
// keychain: a test whose verdict changes with the date, or with which machine
// runs it, is a test that gets ignored the first time it goes red for neither
// reason.
//
// The one case worth naming separately is DRIFT. A hand-maintained date file
// is itself a declaration nothing measures, which is exactly how
// `expected-artifacts.txt` declared artifact CLASSES and never counted them,
// certifying half-built releases until. So the tool reads the expiry
// out of the artifact whenever it can reach it, and disagreement is a failure
// rather than a preference for the file.

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assess, assessOne, expandHome, readActualExpiry } from '../../../tools/release/credential-expiry.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const TOOL = join(root, 'tools/release/credential-expiry.mjs');
const DECL = join(root, 'tools/release/credential-expiry.json');

const at = (iso) => new Date(iso);

// A declaration that names no real artifact, so every calendar case below is
// decided by the clock alone and never by what happens to be on this machine.
const synthetic = (expires) => ({
    policy: { renewalLeadDays: 60 },
    credentials: [{
        id: 'TEST',
        what: 'a credential',
        expires,
        verifyFrom: '/nonexistent/nothing-here.cer',
        breaks: 'nothing, it is a fixture',
    }],
});

// --- the declaration this repo actually ships ------------------------------

const declared = JSON.parse(readFileSync(DECL, 'utf8'));

assert.equal(typeof declared.policy?.renewalLeadDays, 'number',
    'the renewal lead time is policy and must be declared, not implied');

assert.ok(declared.credentials.length >= 4,
    'S6 records four dated credentials at minimum; a shorter list means a row was dropped');

for (const c of declared.credentials) {
    assert.ok(c.id && c.what && c.expires && c.verifyFrom && c.breaks,
        `credential ${c.id || '(unnamed)'} is missing a required field`);
    assert.ok(!Number.isNaN(Date.parse(c.expires)),
        `credential ${c.id} declares an unparseable date`);
    // A row that names no artifact can never be measured, only believed, which
    // is the state this whole tool exists to leave behind.
    assert.match(c.verifyFrom, /^[~/]/, `credential ${c.id} must name a real path to verify from`);
}

// K3 is the one with a hard external deadline, so it is pinned by name: it
// expires with the G1 authority that issued it and cannot be extended.
const k3 = declared.credentials.find((c) => c.id === 'K3');
assert.ok(k3, 'K3, the Developer ID certificate, must stay declared');
assert.equal(k3.expires, '2027-02-01T22:12:15Z',
    'K3 expires at the exact second its issuing CA does; changing this line means a reissue happened');

// --- the calendar branches -------------------------------------------------

{
    const r = assess(synthetic('2027-02-01T00:00:00Z'), at('2026-08-08T00:00:00Z'));
    assert.equal(r.code, 0, 'far from expiry is current');
    assert.equal(r.findings[0].state, 'current');
}

{
    const r = assess(synthetic('2027-02-01T00:00:00Z'), at('2026-12-15T00:00:00Z'));
    assert.equal(r.code, 1, 'inside the renewal lead time is actionable');
    assert.equal(r.findings[0].state, 'due');
}

{
    // The boundary is a decision, not an accident: exactly `leadDays` out is
    // already due, because a renewal that starts on the last possible day has
    // no lead time at all.
    const r = assess(synthetic('2026-10-07T00:00:00Z'), at('2026-08-08T00:00:00Z'));
    assert.equal(r.findings[0].days, 60);
    assert.equal(r.findings[0].state, 'due', 'the lead-time boundary is inclusive');
}

{
    const r = assess(synthetic('2026-08-01T00:00:00Z'), at('2026-08-08T00:00:00Z'));
    assert.equal(r.code, 1);
    assert.equal(r.findings[0].state, 'expired');
}

// --- an unmeasurable row is named, never assumed ---------------------------

{
    const r = assess(synthetic('2027-02-01T00:00:00Z'), at('2026-08-08T00:00:00Z'));
    assert.equal(r.findings[0].measured, false,
        'an artifact this machine does not hold cannot be reported as measured');
    assert.match(r.findings[0].reason, /not present/,
        'and it must say WHY it could not measure, the way PAYLOAD-ARCH-UNCHECKED does');
}

// --- drift: the declaration is not the authority ---------------------------

{
    const cred = {
        id: 'DRIFTY',
        what: 'a credential whose file disagrees with the file',
        expires: '2030-01-01T00:00:00Z',
        verifyFrom: DECL, // a real, reachable file that is not a certificate
        breaks: 'nothing, it is a fixture',
    };
    // A file that exists but carries no readable expiry is unmeasurable, not
    // drifted: the tool must not invent a disagreement out of a failed read.
    const f = assessOne(cred, at('2026-08-08T00:00:00Z'), 60);
    assert.equal(f.state, 'current');
    assert.equal(f.measured, false);
}

{
    // Same clock, same declaration, and the ONLY difference is that the tool
    // can now read the artifact - which must flip the verdict to drift.
    const fake = {
        id: 'DRIFTY',
        what: 'a credential whose declared date is wrong',
        expires: '2030-01-01T00:00:00Z',
        verifyFrom: '/some/cert.pem',
        breaks: 'nothing, it is a fixture',
    };
    const io = { run: () => 'notAfter=Feb  1 22:12:15 2027 GMT\n', home: '/' };
    // existsSync is real, so point at a file that exists and force the read.
    const f = assessOne({ ...fake, verifyFrom: DECL }, at('2026-08-08T00:00:00Z'), 60, io);
    assert.equal(f.state, 'drift',
        'a declared date the artifact does not carry is a failure, not a preference for the file');
    assert.match(f.detail, /2030-01-01/);
    assert.match(f.detail, /2027-02-01/);
}

{
    // And agreement must NOT report drift, or the check would be noise and get
    // switched off - the failure mode §9 names for gates that are always red.
    const io = { run: () => 'notAfter=Feb  1 22:12:15 2027 GMT\n', home: '/' };
    const f = assessOne(
        { id: 'OK', what: 'x', expires: '2027-02-01T22:12:15Z', verifyFrom: DECL, breaks: 'x' },
        at('2026-08-08T00:00:00Z'), 60, io);
    assert.equal(f.state, 'current');
    assert.equal(f.measured, true);
}

// --- the two artifact shapes are read differently --------------------------

{
    // A provisioning profile is a CMS-signed plist, not a certificate. Reading
    // one as the other yields nothing, which would silently become
    // DECLARED-ONLY for a row that IS measurable.
    const profile = readActualExpiry('/x/y.provisionprofile', {
        run: () => '<key>ExpirationDate</key><date>2027-08-07T01:34:10Z</date>',
    });
    // existsSync is real and /x/y does not exist, so this must report absence
    // rather than a date: the guard runs before the decode.
    assert.equal(profile.date, null);
    assert.match(profile.reason, /not present/);
}

// --- config failures are code 2, never code 0 ------------------------------

assert.equal(assess({ credentials: [] }, at('2026-08-08T00:00:00Z')).code, 2,
    'a declaration with no policy is a config error');
assert.equal(assess({ policy: { renewalLeadDays: 60 }, credentials: [] }, at('2026-08-08T00:00:00Z')).code, 2,
    'an empty credential list is a config error, not a clean bill of health');

assert.equal(expandHome('~/a/b', '/home/x'), '/home/x/a/b');
assert.equal(expandHome('/a/b', '/home/x'), '/a/b');

// --- the tool runs end to end ----------------------------------------------

{
    const run = spawnSync(process.execPath, [TOOL, '--json'], { encoding: 'utf8' });
    assert.ok([0, 1].includes(run.status), `tool exited ${run.status}: ${run.stderr}`);
    const parsed = JSON.parse(run.stdout);
    assert.equal(parsed.findings.length, declared.credentials.length);
    // Whatever today's verdict, every row must carry a state a reader can act
    // on rather than an empty object.
    for (const f of parsed.findings) {
        assert.ok(['current', 'due', 'expired', 'drift', 'config'].includes(f.state), `bad state ${f.state}`);
    }
}

console.log('credential-expiry smoke: ok');
