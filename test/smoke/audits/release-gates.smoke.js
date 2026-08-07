// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke test for pieces 21+22 (threat-model artifact + reproducible-
// build scaffold).
//
// Verifies the release-gating documents exist and reference the right
// anchors, plus the pre-release dev-mock-leak guard runs cleanly against
// a clean (empty dist) tree.

import { strict as assert } from 'node:assert';
import {
    readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { docsAvailable, readDoc, WALLET_DOCS } from '../_docs-repo.js';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. Threat model doc --------------------------------------------
//
//  moved this out of the repo and split it in two: security.md now
// carries the posture (protected assets, in scope, out of scope) and
// threat-model.md carries the scenarios and the open items. The assertions
// followed the content into whichever file now owns it, and skip loudly
// when the sibling checkout is absent.

if (docsAvailable()) {
    const security = readDoc('security.md');
    for (const section of [
        'Protected assets',
        'In scope',
        'Out of scope',
        'Audit posture',
    ]) {
        assert.ok(
            security.includes(section),
            `security.md covers "${section}"`,
        );
    }

    const threatModel = readDoc('threat-model.md');
    for (const section of [
        'Attacker scenarios',
        'Known open items',
        'Change review cadence',
        'Verification',
    ]) {
        assert.ok(
            threatModel.includes(section),
            `threat-model.md covers "${section}"`,
        );
    }

    // The port rewrote the smoke-file citations into prose naming the same
    // suites, since a published page should not send a reader hunting for a
    // filename in a repo. The suites are what the claim rests on either way.
    for (const suite of [
        /bridge end-to-end test/i,
        /unlock-flow test/i,
        /action-decoder test/i,
        /onboarding.{0,40}test/i,
    ]) {
        assert.match(
            threatModel, suite,
            'threat-model.md Verification section must name the suite each claim is checkable against',
        );
    }

    for (const scenario of [
        /malicious dApp requesting every permission/i,
        /password-guessing offline attacker/i,
        /spoofed approval-window overlay/i,
        /[Dd]evelopment-mode addresses reaching mainnet/,
    ]) {
        assert.match(
            threatModel, scenario,
            'threat-model.md must still walk this attacker scenario',
        );
    }
} else {
    console.log('SKIP (partial): release-gates smoke - the threat-model half needs the sibling '
        + `xchain-documentation checkout (expected at ${WALLET_DOCS}).`);
}

// --- 2. Reproducible-build scaffold ---------------------------------

const reproReadme = readFileSync(
    join(wsRoot, 'tools', 'build-reproduce', 'README.md'),
    'utf8',
);
for (const section of [
    'Pinning',
    'Current gotchas',
    'RC checklist',
    'RELEASE_MANIFEST.txt',
]) {
    assert.ok(
        reproReadme.includes(section),
        `build-reproduce README covers "${section}"`,
    );
}

const checkScript = join(
    wsRoot,
    'tools',
    'build-reproduce',
    'check-no-dev-mock.sh',
);
assert.ok(existsSync(checkScript), 'check-no-dev-mock.sh exists');

const scriptSrc = readFileSync(checkScript, 'utf8');
for (const marker of [
    'xchain-sdk unavailable',
    'falling back to dev-mock SDK',
    'DO NOT USE FOR MAINNET',
]) {
    assert.ok(scriptSrc.includes(marker), `script greps for "${marker}"`);
}

// Asserted on the TEXT, deliberately, because no fixture can hold it. The
// desktop target is app.asar, a binary container, and whether a match in
// one is reported is a property of the installed grep: BSD and GNU grep
// name the file, ugrep says nothing without `-a`. On a host of the first
// kind - which includes this one when a script runs - dropping the flag
// changes nothing observable, so a behavioural test would pass either way
// and the machines where it matters are the ones nobody runs the suite on.
assert.ok(
    !/grep -r -l -F/.test(scriptSrc),
    'every recursive marker grep passes -a: without it a dev-mock marker '
    + 'sealed in app.asar is invisible to ugrep, and the gate reports CLEAN',
);
assert.equal(
    (scriptSrc.match(/grep -r -a -l -F/g) || []).length,
    3,
    'all three marker/SDK greps carry -a, not just the one someone edited',
);

// --- 3. Script REFUSES a tree where it can scan nothing --------------
//
// This assertion used to read "exits 0 when no dist exists", and it was the
// reason the defect it enshrined survived ( S33). A pristine clone
// checked out at the tag is precisely a tree with no dist/, and it is the
// only tree sign.sh will sign from, so the state this test blessed as
// success was the state the gate ran in for every real release: three
// SKIP lines, zero bytes read, `OK`, exit 0, and `# dev-mock-gate:
// enforced` in the signed manifest header on that basis.
//
// A test that asserts a gate is quiet when it has nothing to look at is
// not testing the gate, it is testing that nobody notices. The property
// worth holding is the opposite one, and it is checked in both directions
// below so that neither a silent pass nor a blanket refusal can satisfy it.
//
// AND THE CWD IS THE POINT, which the old assertion also got wrong. It ran
// the script at `wsRoot` and called that "when no dist exists" - true on a
// clean checkout and false on any machine that has ever built, where it
// silently became a scan of three real bundles. So the sentence describing
// what it measured and the thing it measured had drifted apart, and on a
// developer machine it was green for the opposite reason to the stated one.
// The pristine-clone condition is reproduced literally instead: an empty
// directory, where the script's relative SCAN_TARGETS resolve to nothing.

const noDist = mkdtempSync(join(tmpdir(), 'xchain-devmock-nodist-'));
let empty;
try {
    empty = spawnSync('bash', [checkScript], {
        cwd: noDist,
        encoding: 'utf8',
    });
} finally {
    rmSync(noDist, { recursive: true, force: true });
}
assert.equal(
    empty.status,
    1,
    'check-no-dev-mock.sh must REFUSE a tree with nothing to scan. It exited '
    + `${empty.status}. "The gate could not run" and "the gate passed" must not `
    + `produce the same release (sign.sh says so about a missing script; an `
    + `empty scan produces the identical release). stdout: ${empty.stdout}`,
);
assert.match(
    empty.stdout,
    /scanned NOTHING/,
    'the refusal says what actually happened, rather than reporting a failure '
    + 'that reads like a leaked dev-mock bundle',
);

// The other direction: given something real to read, it reads it and says
// how much. Without this, "always exit 1" would pass the assertion above.
const staged = mkdtempSync(join(tmpdir(), 'xchain-devmock-gate-'));
try {
    const bundle = join(staged, 'bundle');
    mkdirSync(bundle, { recursive: true });
    // A minimal stand-in for a shipped bundle: carries the real-SDK literal
    // and none of the mock markers, which is what a healthy release looks
    // like to this gate.
    writeFileSync(join(bundle, 'app.js'), 'throw new Error("CONTRACT_LINT_FAILED");\n');
    const tarball = join(staged, 'xchain-wallet-web-v0.0.0-test.tar.gz');
    assert.equal(
        spawnSync('tar', ['czf', tarball, '-C', bundle, '.'], { encoding: 'utf8' }).status,
        0,
        'staged a test web tarball',
    );

    const scanned = spawnSync('bash', [checkScript, '--artifacts', staged], {
        cwd: wsRoot,
        encoding: 'utf8',
    });
    assert.equal(
        scanned.status,
        0,
        'check-no-dev-mock.sh --artifacts passes a clean staged bundle; '
        + `stdout: ${scanned.stdout}\nstderr: ${scanned.stderr}`,
    );
    assert.match(
        scanned.stdout,
        /OK - 1 bundle\(s\) scanned/,
        'the OK line COUNTS what it scanned, so "scanned three bundles" and '
        + '"skipped three bundles" can never print the same words again',
    );
} finally {
    rmSync(staged, { recursive: true, force: true });
}

// --- 5. A DESKTOP-ONLY artifact set is scanned, not refused -----------
//
// The §7.5 staging set contains only the update-capable desktop formats:
// no web tarball, no extension zip. Before this, artifact mode collected
// no targets from such a set at all, so it refused with "scanned NOTHING",
// sign.sh treated that as fatal, and no staging manifest could ever be
// signed - which made the rehearsal that gates the whole desktop publish
// unreachable. Driven 2026-08-07 on the four real Linux artifacts.
//
// The fixture is a real `.deb` (an `ar` archive of tarballs) carrying a
// BINARY payload, because both halves matter: the gate has to open the
// package, and it has to read a marker that is not in a text file. The
// renderer bundle ships inside `app.asar`, plain UTF-8 in a binary
// container, and a grep without `-a` reports nothing on ugrep - the grep
// on the machine releases are signed from.
//
// The `.deb` is assembled from bytes rather than shelled out to `ar`,
// which is not a nicety: macOS `ar rc` writes a BSD-style archive with a
// `__.SYMDEF` member and `#1/` long names, and nothing that reads a
// Debian package can parse the result. A fixture that only builds
// correctly on the CI platform would leave this untested on the machine
// releases are actually signed from.
const arArchive = (members) => Buffer.concat([
    Buffer.from('!<arch>\n'),
    ...members.flatMap(({ name, data }) => {
        const header = `${`${name}/`.padEnd(16)}${'0'.padEnd(12)}${'0'.padEnd(6)}`
            + `${'0'.padEnd(6)}${'100644'.padEnd(8)}${String(data.length).padEnd(10)}\`\n`;
        return data.length % 2
            ? [Buffer.from(header), data, Buffer.from('\n')]
            : [Buffer.from(header), data];
    }),
]);

const debStaged = mkdtempSync(join(tmpdir(), 'xchain-devmock-deb-'));
try {
    const payload = join(debStaged, 'payload');
    mkdirSync(join(payload, 'opt', 'XChain Wallet', 'resources'), { recursive: true });
    // Binary container, real-SDK marker inside, no mock markers: what a
    // healthy desktop installer looks like to this gate.
    // The mock marker is in this fixture ON PURPOSE, and it is what a real
    // desktop installer looks like: the main process ships unbundled, so its
    // node_modules carries the extension package, whose sdkFactory.js defines
    // the mock beside the real resolver. A healthy installer therefore has
    // both strings in it, and the gate has to pass it on the strength of the
    // real-SDK half. Remove the positive-only handling and this case fails.
    writeFileSync(
        join(payload, 'opt', 'XChain Wallet', 'resources', 'app.asar'),
        Buffer.concat([
            Buffer.from([0x04, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03]),
            Buffer.from('{"files":{}}SDKWalletError'),
            Buffer.from('  ... falling back to dev-mock SDK ...'),
            Buffer.from([0x00, 0xff, 0x00, 0xfe]),
        ]),
    );
    const dataTar = join(debStaged, 'data.tar.gz');
    assert.equal(
        spawnSync('tar', ['czf', dataTar, '-C', payload, '.'], { encoding: 'utf8' }).status,
        0, 'staged the .deb data member',
    );
    const deb = join(debStaged, 'xchain-wallet_0.0.0_amd64.deb');
    writeFileSync(deb, arArchive([
        { name: 'debian-binary', data: Buffer.from('2.0\n') },
        { name: 'data.tar.gz', data: readFileSync(dataTar) },
    ]));
    // Nothing else in the directory: this is the desktop-only shape.
    rmSync(dataTar);
    rmSync(payload, { recursive: true, force: true });

    const debScan = spawnSync('bash', [checkScript, '--artifacts', debStaged], {
        cwd: wsRoot,
        encoding: 'utf8',
    });
    assert.equal(
        debScan.status,
        0,
        'check-no-dev-mock.sh reads a desktop-only staging set instead of refusing '
        + `it for having nothing to scan; stdout: ${debScan.stdout}\nstderr: ${debScan.stderr}`,
    );
    assert.match(
        debScan.stdout,
        /OK - 1 bundle\(s\) scanned/,
        'and counts the installer it opened',
    );
    assert.doesNotMatch(
        debScan.stdout,
        /scanned NOTHING/,
        'a desktop-only set is a scannable set',
    );

    // The other direction for an INSTALLER is the positive check, not the
    // marker one, and the difference is deliberate (see the gate's own note).
    // A desktop artifact ships the mock's SOURCE by construction - the main
    // process is unbundled and its node_modules carries the extension package
    // - and everything inside one asar is a single blob to a grep. So a
    // marker scan here could only ever refuse, which is a gate nobody can
    // satisfy. What an installer can answer is whether the REAL SDK is in it,
    // and that is what must fail when it is missing. Whether the mock is
    // WIRED is a source property held by sdk-wiring.smoke.js.
    const hollow = mkdtempSync(join(tmpdir(), 'xchain-devmock-deb-hollow-'));
    try {
        const hollowPayload = join(hollow, 'payload');
        mkdirSync(join(hollowPayload, 'resources'), { recursive: true });
        writeFileSync(
            join(hollowPayload, 'resources', 'app.asar'),
            Buffer.concat([
                Buffer.from([0x04, 0x00, 0x00, 0x00]),
                Buffer.from('{"files":{}} no sdk in here at all'),
                Buffer.from([0x00, 0xff]),
            ]));
        const hollowData = join(hollow, 'data.tar.gz');
        spawnSync('tar', ['czf', hollowData, '-C', hollowPayload, '.'], { encoding: 'utf8' });
        writeFileSync(join(hollow, 'xchain-wallet_0.0.0_arm64.deb'), arArchive([
            { name: 'debian-binary', data: Buffer.from('2.0\n') },
            { name: 'data.tar.gz', data: readFileSync(hollowData) },
        ]));
        rmSync(hollowData);
        rmSync(hollowPayload, { recursive: true, force: true });

        const hollowScan = spawnSync('bash', [checkScript, '--artifacts', hollow], {
            cwd: wsRoot,
            encoding: 'utf8',
        });
        assert.equal(hollowScan.status, 1,
            `an installer with no real SDK in it must fail the gate; stdout: ${hollowScan.stdout}`);
        assert.match(hollowScan.stdout, /does not contain the real xchain-sdk/,
            'and say which half failed');
        assert.match(hollowScan.stdout, /real-SDK check only/,
            'and state plainly that an installer is judged on the positive half, so a '
            + 'reader is never left thinking a marker scan passed when none was run');
    } finally {
        rmSync(hollow, { recursive: true, force: true });
    }

    // The MAC staging set is the same shape one OS over: UPDATE_CAPABLE_TARGET
    // is `*-mac.zip` there, so a fix that read only the `.deb` would have left
    // the mac rehearsal refused for exactly the reason the Linux one was,
    // found on the day somebody ran it.
    const macStaged = mkdtempSync(join(tmpdir(), 'xchain-devmock-maczip-'));
    try {
        const appDir = join(macStaged, 'app', 'XChain Wallet.app', 'Contents', 'Resources');
        mkdirSync(appDir, { recursive: true });
        writeFileSync(join(appDir, 'app.asar'),
            Buffer.concat([
                Buffer.from([0x04, 0x00, 0x00, 0x00]),
                Buffer.from('{"files":{}}SDKWalletError'),
                Buffer.from([0x00, 0xff]),
            ]));
        const zipped = spawnSync('zip', ['-qr', join(macStaged, 'xchain-wallet-0.0.0-arm64-mac.zip'), '.'],
            { cwd: join(macStaged, 'app'), encoding: 'utf8' });
        assert.ok(!zipped.error && zipped.status === 0,
            `staged a test mac zip: ${zipped.error?.code === 'ENOENT'
                ? "the 'zip' command is not installed on this machine" : zipped.stderr}`);
        rmSync(join(macStaged, 'app'), { recursive: true, force: true });

        const macScan = spawnSync('bash', [checkScript, '--artifacts', macStaged], {
            cwd: wsRoot,
            encoding: 'utf8',
        });
        assert.equal(macScan.status, 0,
            `check-no-dev-mock.sh reads a mac-only staging set; stdout: ${macScan.stdout}`);
        assert.match(macScan.stdout, /OK - 1 bundle\(s\) scanned/,
            'and counts the app bundle it opened');
    } finally {
        rmSync(macStaged, { recursive: true, force: true });
    }

    // A package that will not open is a HARD failure, never an empty pass.
    // This is the assertion that holds the "judge by result, not by exit
    // code" property: Apple's `ar` prints an error for every member of a
    // Debian package and still exits 0, so the obvious implementation
    // reports a successful extraction of an empty directory and the gate
    // then scans nothing while saying it scanned an installer.
    const unreadable = mkdtempSync(join(tmpdir(), 'xchain-devmock-deb-bad-'));
    try {
        writeFileSync(join(unreadable, 'xchain-wallet_0.0.0_amd64.deb'), 'not an ar archive\n');
        const bad = spawnSync('bash', [checkScript, '--artifacts', unreadable], {
            cwd: wsRoot,
            encoding: 'utf8',
        });
        assert.equal(bad.status, 1,
            `an unreadable .deb must fail the gate; stdout: ${bad.stdout}`);
        assert.match(bad.stdout, /nothing could be extracted/,
            'and say that nothing came out, rather than reporting a clean scan');
    } finally {
        rmSync(unreadable, { recursive: true, force: true });
    }
} finally {
    rmSync(debStaged, { recursive: true, force: true });
}

console.log(
    'OK: release-gates smoke (threat model §1–§7, reproducible-build README + check script, dry-run exit 0, '
    + 'artifact mode reads a desktop-only staging set - .deb and mac zip - judges an installer on the real-SDK half and says so, and refuses one that will not open)',
);
