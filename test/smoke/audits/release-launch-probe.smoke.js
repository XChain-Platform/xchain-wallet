// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  row 144: a release must not be able to ship a build
// that DIES AT LAUNCH while every other gate reports green.
//
// v0.338.0 did exactly that. It was signed with the Developer ID cert,
// notarized, stapled, byte-reproduced against the pinned container,
// hash-manifested under K1 and rehearsed through the staging feed, and it
// died about three seconds in on every Mac with `Fatal process out of
// memory: Failed to reserve virtual memory for CodeRange` - the hardened
// runtime's allow-jit entitlement was false. Every gate read the artifact.
// None of them ran it.
//
// So the interesting cases here are not "does a good app pass". They are:
// a process that is gone when we look, a process that printed a crash
// banner, and - the one this whole file is about - a host that could not
// run the thing at all reading as though it had passed.
//
// FIXTURES ARE TINY SHELL SCRIPTS, NOT RELEASE ARTIFACTS. The probe's job
// is to notice whether a process is alive and what it printed, and a
// four-line script exercises every branch of that in milliseconds. A
// committed 130MB app would test electron-builder. The real artifacts were
// driven by hand against this code (v0.339.0 arm64 passes, v0.338.0 arm64
// fails on the verbatim fatal above); what is automated here is the logic
// those drives went through.

import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

import {
    LAUNCH_CLASSES,
    appImageShape,
    classifyArtifact,
    elfArch,
    evaluate,
    findFatal,
    findHostLimitation,
    hostSessionCapability,
    launchAndWatch,
    macBundleExecutable,
    machoArch,
    probeArtifact,
    summarise,
} from '../../../tools/release/launch-probe.mjs';

const work = mkdtempSync(join(tmpdir(), 'xchain-launchprobe-smoke-'));

/** Write an executable shell script and return its path. */
function script(name, body) {
    const p = join(work, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return p;
}

// --- classification ----------------------------------------------------

{
    // The real release set, named exactly as it is staged.
    assert.equal(classifyArtifact('xchain-wallet-0.339.0-arm64-mac.zip'), 'mac-app-zip');
    assert.equal(classifyArtifact('xchain-wallet-0.339.0-x64-mac.zip'), 'mac-app-zip');
    assert.equal(classifyArtifact('xchain-wallet-0.339.0-arm64.dmg'), 'mac-dmg');
    assert.equal(classifyArtifact('xchain-wallet-0.339.0-x86_64.AppImage'), 'linux-appimage');
    assert.equal(classifyArtifact('xchain-wallet_0.339.0_amd64.deb'), 'linux-package');
    assert.equal(classifyArtifact('xchain-wallet-setup-0.339.0-x64.exe'), 'windows-app');
    assert.equal(classifyArtifact('xchain-wallet-0.339.0-win.zip'), 'windows-app');

    // The three zips in a release differ only by an infix, and getting this
    // wrong would either probe a browser extension as an app or skip the
    // mac bundle silently.
    assert.equal(classifyArtifact('xchain-wallet-extension-0.339.0.zip'), 'not-an-app');
    assert.equal(classifyArtifact('stable-mac.yml'), 'not-an-app');
    assert.equal(classifyArtifact('xchain-wallet-web-0.339.0.tar.gz'), 'not-an-app');
    assert.equal(classifyArtifact('RELEASE_HASHES.txt'), 'not-an-app');

    // Every class must exist and say what it is. A class with no `what` is
    // one whose skip line would print an empty reason, which is the silent
    // skip in a different costume.
    for (const [name, spec] of Object.entries(LAUNCH_CLASSES)) {
        assert.ok(spec.what && spec.what.length > 20, `${name} must state what it is`);
        assert.ok(spec.host === null || ['darwin', 'linux', 'win32'].includes(spec.host));
    }
}

// --- the decision itself -----------------------------------------------

{
    const alive = { exited: false, exitCode: null, signal: null, output: 'booting\n', waitedMs: 8000 };
    assert.equal(evaluate(alive).state, 'ok');
    assert.match(evaluate(alive).reason, /still running after 8\.0s/);

    // THE ROW'S CHECK. A process that is gone when we look has failed to
    // launch, whatever its exit status: a successor to the allow-jit defect
    // could just as easily exit 0, so the status is reported and the
    // PRESENCE is what decides.
    const gone = { exited: true, exitCode: 0, signal: null, output: 'bye\n', waitedMs: 900 };
    assert.equal(evaluate(gone).state, 'failed', 'an app that exited is not a launched app');
    assert.match(evaluate(gone).reason, /DIED/);
    assert.match(evaluate(gone).reason, /exited with code 0/);

    const killed = { exited: true, exitCode: null, signal: 'SIGSEGV', output: '', waitedMs: 300 };
    assert.equal(evaluate(killed).state, 'failed');
    assert.match(evaluate(killed).reason, /killed by SIGSEGV/);
    assert.match(evaluate(killed).reason, /printed nothing/);

    // The v0.338.0 output, verbatim from the artifact on disk. Crash output
    // fails even while the process is still winding down, and the reason
    // names the defect rather than the exit code.
    const v0338 = [
        '',
        '#',
        '# Fatal process out of memory: Failed to reserve virtual memory for CodeRange',
        '#',
        '----- Native stack trace -----',
        '',
        ' 1: 0x10f11408c node::MultiIsolatePlatform::DisposeIsolate(v8::Isolate*)',
    ].join('\n');
    const crashed = evaluate({ exited: false, exitCode: null, signal: null, output: v0338, waitedMs: 3100 });
    assert.equal(crashed.state, 'failed', 'a live process that printed a V8 crash dump has not launched');
    assert.match(crashed.reason, /CRASHED/);
    assert.match(crashed.reason, /allow-jit/);
}

{
    // The host-limitation escape hatch, which is the most dangerous thing
    // in the tool, pinned in all three directions.
    const fuse = 'fuse: failed to exec fusermount: No such file or directory\nCannot mount AppImage\n';

    const died = evaluate({ exited: true, exitCode: 1, signal: null, output: fuse, waitedMs: 200 });
    assert.equal(died.state, 'recorded', 'a host with no FUSE did not test the app');
    assert.match(died.reason, /NOT PROBED/);
    assert.notEqual(died.state, 'ok', 'a host limitation must never read as a pass');

    // A RUNNING app is proof the host could run it, whatever appeared in
    // its logs, so the excuse must not apply.
    const running = evaluate({ exited: false, exitCode: null, signal: null, output: fuse, waitedMs: 8000 });
    assert.equal(running.state, 'ok', 'the excuse applies only to a process that died');

    // And a crash must never be excused by a host string sitting beside it.
    const both = evaluate({
        exited: true,
        exitCode: 133,
        signal: null,
        output: `${fuse}\nFatal process out of memory: Failed to reserve virtual memory for CodeRange\n`,
        waitedMs: 3000,
    });
    assert.equal(both.state, 'failed', 'an app crash outranks any host excuse in the same output');
}

{
    // --expect-log: additive, never a substitute for the aliveness answer.
    const out = 'Checking for update\nUpdate for version 0.339.0 is not available\n';
    const alive = { exited: false, exitCode: null, signal: null, output: out, waitedMs: 8000 };
    assert.equal(evaluate(alive, { expect: [/Checking for update/] }).state, 'ok');
    assert.match(evaluate(alive, { expect: [/Checking for update/] }).reason, /1 expected pattern/);

    const missing = evaluate(alive, { expect: [/Checking for update/, /Downloading update/] });
    assert.equal(missing.state, 'failed');
    assert.match(missing.reason, /NO EXPECTED OUTPUT/);
    assert.match(missing.reason, /Downloading update/);

    // A dead process with the pattern in its output is still dead. The
    // pattern cannot rescue it, which is the ordering a later row (the
    // updater feed check) depends on.
    const deadButLogged = evaluate(
        { exited: true, exitCode: 0, signal: null, output: out, waitedMs: 1000 },
        { expect: [/Checking for update/] },
    );
    assert.equal(deadButLogged.state, 'failed');
}

{
    // Nothing crash-shaped in ordinary boot noise. A false positive here
    // refuses a good release, so the wallet's real v0.339.0 first seconds
    // are asserted clean, verbatim.
    const real = '[xchain] Tor routing not applied at boot (vault locked?): getSettings: vault is required\n'
        + 'Checking for update\n'
        + 'Generated new staging user ID: 8619d5cd-7186-57f5-887f-fd8dcd9d19a9\n'
        + 'Update for version 0.339.0 is not available (latest version: 0.338.0, downgrade is disallowed).\n'
        + '[13674:0811/201008.792500:ERROR:content/browser/network_service_instance_impl.cc:721]'
        + ' Network service crashed or was terminated, restarting service.\n';
    assert.equal(findFatal(real), null, 'the real shipped build\'s boot output must not read as a crash');
    assert.equal(findHostLimitation(real), null);
}

// --- launching real processes ------------------------------------------

{
    // A process that stays up, which is the only shape that passes.
    const sleeper = script('sleeper.sh', 'echo up; sleep 30');
    const obs = await launchAndWatch(sleeper, [], { timeoutMs: 600 });
    assert.equal(obs.exited, false, 'a sleeping process must be observed as alive');
    assert.equal(evaluate(obs).state, 'ok');
    assert.match(obs.output, /up/);
    assert.ok(obs.waitedMs >= 550, `the full window must be waited, got ${obs.waitedMs}ms`);
}

{
    // The v0.338.0 shape: it exits on its own, well inside the window, and
    // the probe must not sit out the whole timeout to find that out.
    const quitter = script('quitter.sh', 'echo starting; exit 7');
    const obs = await launchAndWatch(quitter, [], { timeoutMs: 8000 });
    assert.equal(obs.exited, true);
    assert.equal(obs.exitCode, 7);
    assert.ok(obs.waitedMs < 4000, `must resolve on exit, not on the window (${obs.waitedMs}ms)`);
    const res = evaluate(obs);
    assert.equal(res.state, 'failed');
    assert.match(res.reason, /exited with code 7/);
}

{
    // Crash output from a process that is still technically up.
    const crasher = script('crasher.sh',
        'echo "# Fatal process out of memory: Failed to reserve virtual memory for CodeRange"; sleep 30');
    const obs = await launchAndWatch(crasher, [], { timeoutMs: 600 });
    assert.equal(obs.exited, false);
    assert.equal(evaluate(obs).state, 'failed', 'crash output fails even while the process lingers');
}

{
    // Output captured from BOTH streams. Electron writes its crash banner
    // to stderr and its updater log to stdout, so a probe reading one of
    // them would miss half of what it exists to see.
    const both = script('both.sh', 'echo on-stdout; echo on-stderr >&2; sleep 30');
    const obs = await launchAndWatch(both, [], { timeoutMs: 600 });
    assert.match(obs.output, /on-stdout/);
    assert.match(obs.output, /on-stderr/);
}

{
    // A command that is not there at all reports a spawn error rather than
    // being mistaken for an app that died.
    const obs = await launchAndWatch(join(work, 'no-such-binary'), [], { timeoutMs: 500 });
    assert.ok(obs.spawnError, 'an unspawnable command must surface as a spawn error');
}

{
    // THE PROCESS GROUP, not just the process. Electron forks GPU, network
    // and renderer helpers; killing only the one we spawned would leave
    // them running on the release machine after every signing ceremony.
    const marker = join(work, 'grandchild.pid');
    const forker = script('forker.sh', `sleep 60 & echo $! > ${JSON.stringify(marker)}; sleep 60`);
    await launchAndWatch(forker, [], { timeoutMs: 600 });
    const pid = Number(readFileSync(marker, 'utf8').trim());
    assert.ok(Number.isFinite(pid) && pid > 0);
    let alive = true;
    for (let i = 0; i < 20 && alive; i += 1) {
        try { process.kill(pid, 0); await new Promise((r) => setTimeout(r, 100)); } catch { alive = false; }
    }
    assert.equal(alive, false, `grandchild ${pid} survived the probe: the group was not signalled`);
}

// --- host capability, which must never be guessed ----------------------

{
    const withDisplay = hostSessionCapability({ platform: 'linux', env: { DISPLAY: ':0' } });
    assert.equal(withDisplay.can, true);

    const viaXvfb = hostSessionCapability({ platform: 'linux', env: {}, has: (c) => c === 'xvfb-run' });
    assert.equal(viaXvfb.can, true);
    assert.ok(viaXvfb.note, 'the xvfb path must be recorded, not silent');

    const headless = hostSessionCapability({ platform: 'linux', env: {}, has: () => false });
    assert.equal(headless.can, false);
    assert.match(headless.reason, /DISPLAY/);
    assert.match(headless.reason, /xvfb/, 'the reason must name the fix, like lib.sh names dpkg-deb');

    const elsewhere = hostSessionCapability({ platform: 'sunos', env: {} });
    assert.equal(elsewhere.can, false);
    assert.match(elsewhere.reason, /sunos/);
}

// --- artifacts this host cannot launch: recorded, never passed ---------

{
    const cases = [
        ['xchain-wallet-0.339.0-arm64.dmg', 'darwin', /the zip row probes that app/],
        ['xchain-wallet_0.339.0_amd64.deb', 'linux', /the AppImage row probes that app/],
        ['xchain-wallet-setup-0.339.0-x64.exe', 'win32', /NOT IMPLEMENTED/],
        ['xchain-wallet-0.339.0-x86_64.AppImage', 'darwin', /runs on linux and this host is darwin/],
        ['xchain-wallet-0.339.0-arm64-mac.zip', 'linux', /runs on darwin and this host is linux/],
        ['stable-mac.yml', 'darwin', /not an executable application artifact/],
    ];
    for (const [name, platform, rx] of cases) {
        const res = await probeArtifact(join(work, name), { platform });
        assert.equal(res.state, 'recorded', `${name} on ${platform} must be recorded`);
        assert.notEqual(res.state, 'ok', `${name} on ${platform} must never read as a pass`);
        assert.match(res.reason, /^NOT PROBED:/, 'a skip must announce itself as a skip');
        assert.match(res.reason, rx);
    }

    // A GUI-less shell is named and never counted as a pass. It is NOT
    // "a host limitation like any other", though, and the 26th run's
    // central verification changed that: it is a check this host was
    // supposed to run and could not, so it is marked `blocked` and the run
    // exits 1 (see the fail-shut block at the end of this file). Yes, that
    // turns `ssh release-mac 'sign.sh'` red - which is the correct answer,
    // because signing a macOS release from a shell that cannot launch it is
    // exactly the ceremony row 143's build walked through.
    const noSession = await probeArtifact(join(work, 'xchain-wallet-0.339.0-arm64-mac.zip'), {
        platform: 'darwin',
        session: { can: false, reason: 'this shell has no macOS GUI session (launchctl managername = Background)' },
    });
    assert.equal(noSession.state, 'recorded');
    assert.match(noSession.reason, /no macOS GUI session/);
}

// --- architecture, read from the file rather than from the name --------

{
    const macho = (cpu) => {
        const b = Buffer.alloc(16);
        b.writeUInt32LE(0xfeedfacf, 0);
        b.writeUInt32LE(cpu, 4);
        const p = join(work, `macho-${cpu}`);
        writeFileSync(p, b);
        return p;
    };
    assert.equal(machoArch(macho(0x0100000c)), 'arm64');
    assert.equal(machoArch(macho(0x01000007)), 'x64');

    const fat = join(work, 'fat');
    const fb = Buffer.alloc(16);
    fb.writeUInt32BE(0xcafebabe, 0);
    writeFileSync(fat, fb);
    assert.equal(machoArch(fat), 'universal');

    // A shell script is not a Mach-O, and must answer "unknown" rather than
    // being misread as a foreign architecture and skipped.
    assert.equal(machoArch(script('not-macho.sh', 'true')), null);

    const elf = (machine) => {
        const b = Buffer.alloc(32);
        b.writeUInt32BE(0x7f454c46, 0);
        b.writeUInt16LE(machine, 0x12);
        const p = join(work, `elf-${machine}`);
        writeFileSync(p, b);
        return p;
    };
    assert.equal(elfArch(elf(0x3e)), 'x64');
    assert.equal(elfArch(elf(0xb7)), 'arm64');
    assert.equal(elfArch(script('not-elf.sh', 'true')), null);
}

{
    // A FILE IS NOT ITS EXTENSION. Three shapes, three different owners.
    const appimage = join(work, 'real.AppImage');
    const b = Buffer.alloc(64);
    b.writeUInt32BE(0x7f454c46, 0);
    b[8] = 0x41; b[9] = 0x49; b[10] = 0x02;              // 'AI' + type 2
    b.writeUInt16LE(0x3e, 0x12);
    writeFileSync(appimage, b);
    assert.equal(appImageShape(appimage), 'appimage');

    // An ELF without the magic is what a synthetic fixture looks like, and
    // what lib.sh's payload gate happily accepts (it reads e_machine, not
    // this). The probe must say it launched nothing rather than exec it.
    const bare = Buffer.from(b);
    bare[8] = 0; bare[9] = 0; bare[10] = 0;
    writeFileSync(join(work, 'bare.AppImage'), bare);
    assert.equal(appImageShape(join(work, 'bare.AppImage')), 'elf-not-appimage');
    const notProbed = await probeArtifact(join(work, 'bare.AppImage'),
        { platform: 'linux', arch: 'x64', session: { can: true } });
    assert.equal(notProbed.state, 'recorded');
    assert.match(notProbed.reason, /NOT PROBED: an ELF without the type-2 AppImage magic/);

    // Not an ELF at all has already been refused by that payload gate, so
    // reaching this code means a test venue, not a release.
    assert.equal(appImageShape(script('nope.AppImage', 'true')), 'not-elf');
}

{
    // Contents/MacOS with exactly one file needs no plist read; with more
    // than one it must not guess.
    const one = join(work, 'One.app', 'Contents', 'MacOS');
    mkdirSync(one, { recursive: true });
    writeFileSync(join(one, 'XChain Wallet'), '');
    assert.match(macBundleExecutable(join(work, 'One.app')).path, /MacOS\/XChain Wallet$/);

    const none = join(work, 'Empty.app');
    mkdirSync(none, { recursive: true });
    assert.equal(macBundleExecutable(none).path, null);
    assert.match(macBundleExecutable(none).reason, /no Contents\/MacOS/);
}

// --- end to end, on a fake app this host really executes ---------------
//
// The fake is a shell script wearing the packaging of the lane it stands
// in for, so the extraction, the executable resolution, the isolation flag
// and the teardown are all the real code paths rather than stubs. The
// session capability is injected because a shell script needs no window
// server, and the test must not depend on where the suite is run from.

/**
 * Build a lane-shaped fixture around a shell script body and probe it.
 * On macOS that is a real .app zipped with ditto; on Linux a file named
 * .AppImage, which probeAppImage copies, chmods and executes exactly as it
 * would the real thing.
 */
async function probeFakeApp(tag, body, { lane, ...options } = {}) {
    const dir = join(work, `fixture-${tag}`);
    mkdirSync(dir, { recursive: true });
    const which = lane || (process.platform === 'darwin' ? 'mac' : 'linux');
    if (which === 'linux') {
        // The AppImage path, drivable on ANY host: probeAppImage copies the
        // file, sets the executable bit and runs it, and a shell script is
        // carried through all of that exactly as a real image would be.
        // Only an ELF that is not an AppImage is refused, and that case is
        // asserted above.
        const artifact = join(dir, 'xchain-wallet-0.0.0-x86_64.AppImage');
        writeFileSync(artifact, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
        return probeArtifact(artifact, {
            platform: 'linux', arch: process.arch, timeoutMs: 900, session: { can: true }, ...options,
        });
    }
    const app = join(dir, 'XChain Wallet.app');
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(join(app, 'Contents', 'MacOS', 'XChain Wallet'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    const artifact = join(dir, `xchain-wallet-0.0.0-${process.arch === 'arm64' ? 'arm64' : 'x64'}-mac.zip`);
    execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, artifact]);
    return probeArtifact(artifact, { timeoutMs: 900, session: { can: true }, ...options });
}

if (process.platform === 'darwin' || process.platform === 'linux') {
    // 1. It starts and stays up: the only pass. Driven through the host's
    //    own lane and, separately, through the OTHER lane's code path, so
    //    neither the mac expansion nor the AppImage copy-and-exec is left
    //    unexecuted by whichever venue happens to run this suite.
    const good = await probeFakeApp('good', 'echo "Checking for update"; sleep 30');
    assert.equal(good.state, 'ok', `a live fake app must pass, got: ${good.reason}`);

    const linuxLane = await probeFakeApp('good-linux', 'echo up; sleep 30', { lane: 'linux' });
    assert.equal(linuxLane.state, 'ok', `the AppImage path must pass a live app, got: ${linuxLane.reason}`);
    assert.equal(linuxLane.class, 'linux-appimage');
    const linuxDies = await probeFakeApp('dies-linux', 'exit 1', { lane: 'linux' });
    assert.equal(linuxDies.state, 'failed');
    assert.match(linuxDies.reason, /DIED/);

    // 2. It exits immediately: the row-144 case, and the one ONLY the
    //    aliveness comparison catches - there is no crash banner to find.
    const dies = await probeFakeApp('dies', 'exit 0');
    assert.equal(dies.state, 'failed', 'an app that exits at once must fail');
    assert.match(dies.reason, /DIED/);

    // 3. It prints the v0.338.0 fatal and lingers.
    const crashes = await probeFakeApp('crashes',
        'echo "# Fatal process out of memory: Failed to reserve virtual memory for CodeRange" >&2; sleep 30');
    assert.equal(crashes.state, 'failed');
    assert.match(crashes.reason, /CRASHED/);

    // 4. --expect-log, both directions, through the whole tool.
    const wanted = await probeFakeApp('expect-hit', 'echo "Checking for update"; sleep 30',
        { expect: [/Checking for update/] });
    assert.equal(wanted.state, 'ok');
    const unmet = await probeFakeApp('expect-miss', 'echo "nothing to say"; sleep 30',
        { expect: [/Checking for update/] });
    assert.equal(unmet.state, 'failed');
    assert.match(unmet.reason, /NO EXPECTED OUTPUT/);

    // 5. THE ISOLATION, which is not optional: the release Mac holds a real
    //    wallet. The fake app records the profile directory it was handed
    //    and writes into it, and both facts are checked after the probe has
    //    finished: the directory was a throwaway under the temp root, it was
    //    nowhere near the operator's Application Support, and it is gone.
    const record = join(work, 'handed-args.txt');
    const isolated = await probeFakeApp('isolation',
        `printf '%s\\n' "$@" > ${JSON.stringify(record)}\n`
        + 'for a in "$@"; do case "$a" in --user-data-dir=*) UD="${a#--user-data-dir=}";; esac; done\n'
        + 'mkdir -p "$UD" && echo wallet-would-write-here > "$UD/vault.json"\n'
        + 'sleep 30');
    assert.equal(isolated.state, 'ok');
    const handed = readFileSync(record, 'utf8').trim().split('\n');
    const flag = handed.find((a) => a.startsWith('--user-data-dir='));
    assert.ok(flag, `the app must be handed --user-data-dir, got: ${handed.join(' ')}`);
    const profile = flag.slice('--user-data-dir='.length);
    assert.match(profile, /xchain-launch-probe-/, 'the profile must be a probe-owned throwaway');
    assert.ok(profile.startsWith(tmpdir()) || profile.startsWith('/private'),
        `the profile must live under the temp root, got ${profile}`);
    assert.ok(!/Application Support|\.config\/xchain/i.test(profile),
        'the probe must never point the app at a real wallet profile');
    assert.equal(existsSync(profile), false,
        'the throwaway profile must be removed: a release machine must not accumulate wallets');
}

if (process.platform === 'darwin') {
    // A ZIP WITH NO APP IN IT LAUNCHES NOTHING, and the report must say
    // that rather than blame the app for not starting. This is the shape
    // release-tools.smoke.js stages (a real zip carrying only
    // _CodeSignature and an app.asar), and it is not a hole: a bundle with
    // no sealed signature path cannot pass verify-signatures.mjs a row
    // earlier, and on the CI lane that builds it `--require-probed` turns
    // "nothing launched" red.
    const dir = join(work, 'fixture-hollow');
    const app = join(dir, 'XChain Wallet.app', 'Contents', '_CodeSignature');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'CodeResources'), '<plist/>\n');
    const zip = join(dir, 'xchain-wallet-0.0.0-arm64-mac.zip');
    execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent',
        join(dir, 'XChain Wallet.app'), zip]);
    const hollow = await probeArtifact(zip, { timeoutMs: 500, session: { can: true } });
    assert.equal(hollow.state, 'recorded');
    assert.match(hollow.reason, /NOT PROBED: no Contents\/MacOS/);
}

// --- the report counts skips apart from passes -------------------------

{
    const sum = summarise([
        { file: 'a-mac.zip', class: 'mac-app-zip', state: 'ok', reason: '' },
        { file: 'b.AppImage', class: 'linux-appimage', state: 'recorded', reason: 'NOT PROBED: x' },
        { file: 'c.dmg', class: 'mac-dmg', state: 'recorded', reason: 'NOT PROBED: y' },
        { file: 'd.yml', class: 'not-an-app', state: 'recorded', reason: 'NOT PROBED: z' },
        { file: 'e-mac.zip', class: 'mac-app-zip', state: 'failed', reason: 'DIED' },
    ]);
    assert.equal(sum.ok, 1);
    assert.equal(sum.failed, 1);
    // Two skipped apps, and the channel pointer counted apart from them:
    // padding the not-probed number with files that were never apps is the
    // direction that makes a thin run look thorough.
    assert.equal(sum.recorded, 2);
    assert.equal(sum.notApp, 1);
    // None of those skips is a host that failed us: a Linux image on a Mac
    // and a dmg whose app the zip row already launched are both correct
    // silences, and neither may turn a release red.
    assert.equal(sum.blocked.length, 0,
        'platform skips and same-app siblings are not blocked probes');
}

// --- the CLI's own refusals --------------------------------------------

{
    const cli = (args, cwd = root) => spawnSync('node', [join(root, 'tools/release/launch-probe.mjs'), ...args],
        { encoding: 'utf8', cwd });

    assert.equal(cli(['--help']).status, 0, '--help must answer with usage, not with an arity failure');
    assert.match(cli(['--help']).stdout, /--expect-log/);
    assert.equal(cli([]).status, 2, 'no arguments is an argument failure, not a pass');
    assert.equal(cli([work, 'production']).status, 2, 'an unknown release set must be refused');
    assert.equal(cli([work, 'release', '--timeout', 'soon']).status, 2);
    assert.equal(cli([work, 'release', '--expect-log', '(unclosed']).status, 2, 'a bad regex must be refused');
    assert.equal(cli([join(work, 'no-such-dir')]).status, 1, 'an unreadable directory is a failure');

    // A directory with nothing launchable in it: silent success is exactly
    // what row 144 exists to forbid, so the banner must appear...
    const empty = join(work, 'pointers-only');
    mkdirSync(empty, { recursive: true });
    writeFileSync(join(empty, 'stable-mac.yml'), 'version: 0.0.0\n');
    const quiet = cli([empty]);
    assert.equal(quiet.status, 0, 'a release machine holding no launchable artifact is not an error');
    assert.match(quiet.stdout, /LAUNCH PROBE RAN NOTHING/,
        'a run that launched nothing must say so at the top of its voice');

    // ... and where the host and the lane match by construction, it is red.
    const strict = cli([empty, 'release', '--require-probed', '1']);
    assert.equal(strict.status, 1);
    assert.match(strict.stderr, /only 0 artifact\(s\) were launched/);
}

// --- the wiring: a gate nothing invokes is not a gate -------------------

{
    // sign.sh must run the probe AFTER the signature gate and BEFORE the
    // manifest is written. The ordering is the same argument as the
    // signature gate's own: K1 attests the bytes, so once the manifest is
    // signed, every downstream check agrees with it and nothing left in the
    // pipeline can tell that the app never started.
    //
    // Invocation lines are compared, not first mentions: the comment above
    // the call names xr_write_manifest, and an indexOf on the raw text
    // would fail against correct code (the same trap release-signature-
    // gate.smoke.js documents).
    const lines = readFileSync(join(root, 'tools/release/sign.sh'), 'utf8').split('\n');
    const lineOf = (rx) => lines.findIndex((l) => rx.test(l));
    const sigAt = lineOf(/^\s*node .*verify-signatures\.mjs/);
    const probeAt = lineOf(/^\s*node .*launch-probe\.mjs/);
    const manifestAt = lineOf(/^\s*xr_write_manifest\s/);

    assert.ok(probeAt !== -1, 'sign.sh must invoke the launch probe');
    assert.ok(sigAt !== -1 && manifestAt !== -1);
    assert.ok(sigAt < probeAt, 'the launch probe belongs after the signature gate');
    assert.ok(probeAt < manifestAt,
        'the launch probe must run BEFORE the manifest is written: once K1 has attested '
        + 'the bytes, an app that cannot start verifies perfectly forever');

    // It must be passed the staged directory, not a hardcoded path.
    assert.match(lines[probeAt], /"\$INPUT_DIR"/);
}

{
    // Both desktop build lanes in CI must run it, and the mac lane above
    // all: that is the lane v0.338.0 shipped from.
    const wf = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
    const jobs = wf.split(/^  (?=[a-z][a-z0-9-]*:$)/m);
    for (const job of ['desktop-macos', 'desktop-linux']) {
        const block = jobs.find((b) => b.startsWith(`${job}:`));
        assert.ok(block, `release.yml must keep a ${job} job`);
        assert.match(block, /node tools\/release\/launch-probe\.mjs packages\/desktop\/dist/,
            `${job} must run the launch probe on what it just built`);
        assert.match(block, /launch-probe\.mjs[^\n]*--require-probed/,
            `${job}'s host and lane match by construction, so probing nothing there must be red`);
    }

    // And the probe step must come after the upload, so a build that will
    // not start is still collectable for diagnosis.
    const mac = jobs.find((b) => b.startsWith('desktop-macos:'));
    assert.ok(mac.indexOf('name: desktop-macos') < mac.indexOf('launch-probe.mjs'),
        'the probe runs after the artifacts are uploaded, so a red probe still leaves them collectable');
}

// --- "I could not check" must never read as "no check was needed" ------
//
// sign.sh passes no --require-probed, because the release Mac legitimately
// holds Linux artifacts it cannot execute. Without this leg, a signing
// ceremony run over SSH - where macOS reports no Aqua session - would probe
// NOTHING, print the banner into a long ceremony log, and sign a macOS
// release carrying zero launch evidence. That is precisely the ceremony
// row 143's build walked through. Same fail-shut rule row 147 put on the
// §7.5 swap waiver.

{
    const noSession = await probeArtifact(join(work, 'blocked-mac.zip'), {
        platform: 'darwin',
        arch: 'arm64',
        timeoutMs: 500,
        session: { can: false, reason: 'macOS has no logged-in Aqua session here' },
    });
    assert.equal(noSession.state, 'recorded', 'a host with no session probes nothing');
    assert.equal(noSession.blocked, true,
        'a missing host facility is a BLOCKED probe, not an honest platform skip');

    const sum = summarise([noSession]);
    assert.equal(sum.ok, 0);
    assert.equal(sum.blocked.length, 1,
        'the summary must carry the blocked probe forward, or the run exits 0 having checked nothing');

    // A HEADLESS LINUX HOST IS LOUD BUT NOT BLOCKING, and the asymmetry is
    // deliberate: the Linux lane launches under CI with --require-probed 1,
    // so "launched nothing" is already red there, while the macOS ceremony
    // has no such flag and no other backstop. Blocking headless Linux too
    // would only make this suite unrunnable on every venue without xvfb.
    const headlessLinux = await probeArtifact(join(work, 'headless-x86_64.AppImage'), {
        platform: 'linux',
        arch: 'x64',
        timeoutMs: 500,
        session: { can: false, reason: 'no DISPLAY and no xvfb-run on this host' },
    });
    assert.equal(headlessLinux.state, 'recorded');
    assert.ok(!headlessLinux.blocked,
        'headless Linux is covered by --require-probed on the lane that builds there');
    assert.equal(summarise([headlessLinux]).blocked.length, 0);

    // And the honest skip stays honest: a Linux image on this Mac is not
    // blocked, so a mac+Linux release set still signs.
    const wrongPlatform = await probeArtifact(join(work, 'blocked-linux.AppImage'), {
        platform: 'darwin',
        arch: 'arm64',
        timeoutMs: 500,
    });
    assert.equal(wrongPlatform.state, 'recorded');
    assert.ok(!wrongPlatform.blocked,
        'a wrong-platform artifact is a skip nothing can fix and must not fail a release');
    assert.equal(summarise([wrongPlatform]).blocked.length, 0);
}

rmSync(work, { recursive: true, force: true });
process.stdout.write('release-launch-probe.smoke.js: ok\n');
