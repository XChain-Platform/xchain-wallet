#!/usr/bin/env node
// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/launch-probe.mjs - does the packaged app actually START?
// (row 144.) Every other release gate READS an artifact. This one
// RUNS it.
//
// WHY THIS EXISTS, AND IT IS NOT HYPOTHETICAL. v0.338.0 was built, signed
// with the Developer ID cert, notarized by Apple, stapled, reproduced,
// hash-manifested under K1 and rehearsed through the §7.5 staging feed.
// Every gate was green. The app died about three seconds after launch on
// every Mac, every time:
//
//     Fatal process out of memory: Failed to reserve virtual memory for
//     CodeRange
//     Trace/BPT trap: 5
//
// The cause was one entitlement: `com.apple.security.cs.allow-jit` was
// false under the hardened runtime, so V8 could not map its code range.
// A signature gate reads the signature and finds it perfect. An arch gate
// reads the Mach-O header and finds it perfect. The reproducibility check
// compares bytes with a container and finds them identical. Notarization
// asks Apple whether the binary is malware, not whether it works. The
// rehearsal downloads the artifact and verifies its hash. NOT ONE OF THEM
// EXECUTES IT, so a release that cannot start passed the entire pipeline
// and reached the feed.
//
// WHAT THIS CHECKS, AND WHAT IT DELIBERATELY DOES NOT. It launches the
// packaged app, waits a few seconds, and asks two questions: is the
// process still alive, and did it print anything crash-shaped. That is
// all. It is not a functional test, it does not click anything, and it
// cannot tell a working wallet from a blank window. It is the cheapest
// question nobody was asking, and it is the exact question v0.338.0
// would have failed.
//
// WHERE IT RUNS. From `sign.sh`, immediately after verify-signatures.mjs
// and BEFORE `xr_write_manifest`, for the same reason the signature gate
// sits there: once K1 has signed the manifest, every downstream check
// agrees with it forever. A release that cannot start must be refused
// before it can be attested, not after.
//
// HOST HONESTY IS THE HARD REQUIREMENT HERE. A probe can only run what
// the host can execute: a mac lane cannot be launched on Linux, an
// AppImage cannot be launched on a Mac, and neither can be launched by a
// shell with no display session. Every one of those cases prints a
// NOT PROBED line naming the artifact and the reason, is counted
// separately from the passes, and can never be read as a pass - the same
// discipline verify-signatures.mjs applies to `codesign-dmg` off macOS,
// and a step louder than lib.sh's PAYLOAD-ARCH-UNCHECKED, because this
// gate also prints a standing banner when it probed NOTHING AT ALL.
//
// ISOLATION IS MANDATORY, NOT HYGIENE. The release machine holds a real
// wallet. The app is launched with `--user-data-dir` pointed at a fresh
// temp directory that is deleted afterwards, so the probe cannot read,
// write, migrate or lock the operator's profile. Electron resolves
// `app.getPath('userData')` from that flag, and the single-instance lock
// lives inside it, so a probe can run with the operator's own wallet
// open. Driven on the real v0.339.0 build: the probed app reported
// `getSettings: vault is required` and minted a new updater id, which is
// what a genuinely empty profile looks like.

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * How an artifact can be launched, and by which host.
 *
 * `host` is the process.platform that can run it. A class with `host: null`
 * is not something this gate launches at all, and its `what` must say why
 * in terms a reader can check, because "not probed" is the state this file
 * exists to stop anyone from mistaking for "probed and fine".
 */
export const LAUNCH_CLASSES = {
    'mac-app-zip': {
        host: 'darwin',
        what: 'a zipped .app bundle; expanded and its Contents/MacOS binary is executed directly',
    },
    'linux-appimage': {
        host: 'linux',
        what: 'a self-executing AppImage; run in place with the runtime extracted rather than FUSE-mounted',
    },
    // The dmg carries the SAME app bundle as the mac zip built beside it in
    // the same electron-builder run, so the launch question is answered for
    // both by probing the zip. Mounting a disk image to launch its copy
    // would re-ask a question already answered and add a mount/eject failure
    // mode to a release gate. What the dmg does NOT share with the zip is
    // its container signature, and that is verify-signatures.mjs's
    // `codesign-dmg` row, not this one.
    'mac-dmg': {
        host: null,
        what: 'the disk image wraps the same .app the mac zip does; the zip row probes that app',
    },
    // Same argument, one lane over: the deb and the snap package the same
    // packaged output as the AppImage from the same build. Probing them
    // would mean installing them as root on the release machine.
    'linux-package': {
        host: null,
        what: 'packages the same app the AppImage does; the AppImage row probes that app',
    },
    // NOT IMPLEMENTED, AND SAID SO. The portable win zip is directly
    // runnable and the nsis installer is not, so a Windows probe is a real
    // possibility and a real piece of work. Nothing runs it today: sign.sh
    // runs on the release Mac (§8 keeps K1 off every runner), and the
    // Windows lane of release.yml is not wired to this gate. Declaring the
    // class with an honest reason is the difference between a known gap and
    // an invisible one.
    'windows-app': {
        host: null,
        what: 'NOT IMPLEMENTED: no Windows launch probe exists yet, and no Windows host runs this gate',
    },
    'not-an-app': {
        host: null,
        what: 'not an executable application artifact',
    },
};

/**
 * Which launch class an artifact belongs to, by filename.
 *
 * Filename-shaped, like every other gate in this directory, because that
 * is what the artifact declaration is keyed on. Order matters: the mac and
 * windows zips are distinguished from the browser-extension zip by an
 * infix, so the specific patterns are tested before the generic one.
 */
export function classifyArtifact(name) {
    const n = name.toLowerCase();
    if (n.endsWith('.dmg')) return 'mac-dmg';
    if (n.endsWith('.appimage')) return 'linux-appimage';
    if (n.endsWith('.deb') || n.endsWith('.snap') || n.endsWith('.rpm')) return 'linux-package';
    if (n.endsWith('.exe') || n.endsWith('.msi') || n.endsWith('.appx') || n.endsWith('.msix')) return 'windows-app';
    if (n.endsWith('.zip')) {
        if (n.includes('mac')) return 'mac-app-zip';
        if (n.includes('win')) return 'windows-app';
        return 'not-an-app';
    }
    return 'not-an-app';
}

/**
 * Output that means the process crashed.
 *
 * KEPT TIGHT ON PURPOSE. A false positive here refuses a good release, so
 * every pattern is a crash banner rather than the word "error": a shipped
 * wallet logs plenty of caught, recoverable errors at boot and none of
 * them are this. The first entry is the verbatim v0.338.0 failure.
 */
export const FATAL_PATTERNS = [
    { rx: /Fatal process out of memory/i, what: 'V8 could not reserve memory (the v0.338.0 allow-jit defect)' },
    { rx: /----- Native stack trace -----/, what: 'V8 printed a native crash dump' },
    { rx: /FATAL ERROR:/, what: 'a V8 or Node fatal error' },
    { rx: /A JavaScript error occurred in the main process/, what: 'the Electron main process threw before it could run' },
    { rx: /(Trace\/BPT trap|Abort trap|Segmentation fault|Bus error)/, what: 'the process trapped' },
    { rx: /EXC_(BAD_ACCESS|CRASH|GUARD|BAD_INSTRUCTION)/, what: 'a Mach exception' },
    { rx: /dyld\b[^\n]*(Library not loaded|Symbol not found|image not found)/, what: 'a dynamic link failure' },
    { rx: /code signature[^\n]*(invalid|not valid|blocked)/i, what: 'the OS rejected the code signature at load' },
];

/**
 * Output that means the HOST could not run it, as distinct from the app
 * being broken. This distinction is the most dangerous thing in the file,
 * because it is the one that turns a red into a skip, so:
 *
 *   - it is consulted ONLY after FATAL_PATTERNS, so an app crash can never
 *     be excused by a host string appearing alongside it;
 *   - it is consulted ONLY when the process died, because a running app is
 *     proof the host could run it whatever it printed;
 *   - every pattern names a HOST FACILITY that is absent (a FUSE mount, an
 *     X display), never a fault in our own code. An app that fails to find
 *     its own asset is not a host limitation and must stay red.
 */
export const HOST_LIMITATION_PATTERNS = [
    {
        rx: /(libfuse|fusermount|dlopen\(\)[^\n]*libfuse|Cannot mount AppImage)/i,
        what: 'this host has no FUSE, so the AppImage runtime could not mount itself',
    },
    {
        rx: /(cannot open display|Missing X server or \$DISPLAY|Unable to open X display|Gtk[^\n]*cannot open display)/i,
        what: 'this host has no X display for a GUI process to attach to',
    },
];

/** Longest crash-shaped excerpt worth putting in a one-line report. */
const EXCERPT = 200;

/** Collapse captured output to a single readable line. */
function excerpt(text, rx) {
    const line = (text.match(rx)?.[0] || text.trim().split('\n').pop() || '').trim();
    return line.replace(/\s+/g, ' ').slice(0, EXCERPT);
}

/** First FATAL_PATTERNS entry present in the captured output, or null. */
export function findFatal(output) {
    for (const p of FATAL_PATTERNS) {
        if (p.rx.test(output)) return { what: p.what, line: excerpt(output, p.rx) };
    }
    return null;
}

/** First HOST_LIMITATION_PATTERNS entry present in the output, or null. */
export function findHostLimitation(output) {
    for (const p of HOST_LIMITATION_PATTERNS) {
        if (p.rx.test(output)) return { what: p.what, line: excerpt(output, p.rx) };
    }
    return null;
}

/**
 * THE CHECK ITSELF. Given what was observed of a launched process, is this
 * artifact a pass, a failure, or something the host could not judge?
 *
 * Pure, and separated from the spawning for exactly that reason: the
 * decision this whole row is about is one comparison - `observation.exited`
 * - and it must be drivable in both directions without a 130MB artifact.
 *
 * @param {{exited: boolean, exitCode: number|null, signal: string|null,
 *          output: string, waitedMs: number}} observation
 * @param {{expect?: RegExp[]}} options
 * @returns {{state: 'ok'|'failed'|'recorded', reason: string}}
 */
export function evaluate(observation, { expect = [] } = {}) {
    const { exited, exitCode, signal, output = '', waitedMs = 0 } = observation;
    const secs = (waitedMs / 1000).toFixed(1);

    // Crash output first, before anything can excuse it, and before the
    // aliveness answer: a process that printed a V8 crash dump and has not
    // finished dying yet is not a pass, and the crash line is the more
    // useful thing to put in the log than the exit status.
    const fatal = findFatal(output);
    if (fatal) {
        return { state: 'failed', reason: `CRASHED (${fatal.what}): ${fatal.line}` };
    }

    if (exited) {
        // Only now may a host limitation speak, and only to say the host
        // never gave the app a chance. Still counted as NOT PROBED, never
        // as a pass.
        const host = findHostLimitation(output);
        if (host) {
            return { state: 'recorded', blocked: true, reason: `NOT PROBED: ${host.what} (${host.line})` };
        }
        // The aliveness comparison. A packaged desktop wallet that is gone
        // seconds after launch has failed to launch, and the exit STATUS is
        // not the question: v0.338.0's successor defect could just as easily
        // exit 0. Presence is the property, the same way presence is the
        // property in verify-signatures.mjs.
        const how = signal ? `killed by ${signal}` : `exited with code ${exitCode}`;
        const tail = output.trim() ? ` last output: ${excerpt(output, /[^\n]+$/)}` : ' it printed nothing.';
        return {
            state: 'failed',
            reason: `DIED: the app ${how} after ${secs}s instead of staying up.${tail}`,
        };
    }

    // Alive. An expected pattern is the caller's extra requirement on top
    // of that, never a substitute for it.
    const missing = expect.filter((rx) => !rx.test(output));
    if (missing.length) {
        return {
            state: 'failed',
            reason: `NO EXPECTED OUTPUT: ran for ${secs}s without printing ${missing.map(String).join(', ')}`,
        };
    }
    const also = expect.length ? `, printed ${expect.length} expected pattern(s)` : '';
    return { state: 'ok', reason: `launched and still running after ${secs}s${also}` };
}

/** Sleep that can be cancelled by clearing the returned timer. */
function delay(ms) {
    let t;
    const p = new Promise((resolve) => { t = setTimeout(resolve, ms); });
    p.cancel = () => clearTimeout(t);
    return p;
}

/**
 * Launch a command, watch it for `timeoutMs`, then stop it.
 *
 * Detached so the child leads its own process group: Electron forks GPU,
 * network and renderer helpers, and killing only the browser process can
 * leave those parented to init on a release machine. The group is signalled
 * instead, TERM then KILL, in a finally.
 *
 * Resolves as soon as the process is gone, so a crash at 0.3s costs 0.3s
 * rather than the full window. `close` rather than `exit` is the trigger,
 * because the crash dump is written to stderr as the process dies and
 * resolving on `exit` would report the failure without the reason for it.
 *
 * @returns {Promise<{exited: boolean, exitCode: number|null, signal: string|null,
 *                    output: string, waitedMs: number, spawnError: string|null}>}
 */
export async function launchAndWatch(cmd, args, { timeoutMs = 8000, env = process.env, cwd } = {}) {
    const started = Date.now();
    let output = '';
    let exited = false;
    let exitCode = null;
    let signal = null;
    let spawnError = null;

    const child = spawn(cmd, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env, cwd });
    const capture = (chunk) => {
        output += chunk.toString('utf8');
        // A crashing Electron can emit a long native stack; keep the tail,
        // which is where the trace is, and the head, which is where the
        // banner is. 64KB of each is far more than any report needs.
        if (output.length > 131072) output = `${output.slice(0, 65536)}\n...\n${output.slice(-65536)}`;
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);

    const closed = new Promise((resolve) => {
        child.on('error', (err) => { spawnError = String(err?.message || err); exited = true; resolve(); });
        child.on('close', (code, sig) => { exited = true; exitCode = code; signal = sig; resolve(); });
    });

    // THE OBSERVATION IS SNAPSHOT BEFORE THE PROBE INTERVENES, and this is
    // not a nicety. Killing the app at the end of the window sets `exited`
    // too, so reading that flag after the teardown reports every healthy
    // app as one that died. Measured against the real v0.339.0 build, which
    // this file's first draft failed with "exited with code 0 after 8.7s":
    // the code was the probe's own SIGTERM being reported as the app's
    // verdict. What is answered here is the question at the deadline.
    const window = delay(timeoutMs);
    let observed;
    try {
        await Promise.race([closed, window]);
        observed = { exited, exitCode, signal, waitedMs: Date.now() - started };
    } finally {
        window.cancel();
        if (!exited) {
            // Signal the GROUP (negative pid). Failure to signal is not an
            // error worth failing the release over, but a survivor is worth
            // one more, harder attempt.
            try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
            await Promise.race([closed, delay(3000)]);
            if (!exited) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } }
        }
    }
    // `output` is read after teardown on purpose, unlike the exit state: a
    // crash dump written as the process dies is evidence about the app, and
    // dropping it would report a failure with no reason attached.
    return { ...observed, output, spawnError };
}

/**
 * The CPU architecture a Mach-O file is built for, read from its header.
 *
 * Read from the FILE rather than inferred from the artifact's name, because
 * the decision it feeds - whether this host needs Rosetta to run it - must
 * not be answered by a filename that could be wrong. lib.sh's arch gate
 * already documents that a name is not evidence.
 *
 * Returns 'arm64' | 'x64' | 'universal' | null (not a Mach-O).
 */
export function machoArch(path) {
    let fd;
    try {
        fd = openSync(path, 'r');
        const buf = Buffer.alloc(8);
        readSync(fd, buf, 0, 8, 0);
        const magic = buf.readUInt32BE(0);
        // FAT_MAGIC / FAT_CIGAM: a universal binary, which by construction
        // runs natively whatever this host is.
        if (magic === 0xcafebabe || magic === 0xbebafeca) return 'universal';
        // MH_MAGIC_64 is little-endian on both arches we ship.
        if (buf.readUInt32LE(0) !== 0xfeedfacf) return null;
        const cpu = buf.readUInt32LE(4);
        if (cpu === 0x0100000c) return 'arm64';
        if (cpu === 0x01000007) return 'x64';
        return null;
    } catch {
        return null;
    } finally {
        if (fd !== undefined) closeSync(fd);
    }
}

/**
 * The CPU architecture an ELF file is built for, read from e_machine.
 *
 * The AppImage's runtime IS an ELF, so its own header answers this with no
 * extractor, exactly as lib.sh's `xr_elf_machine` does for the arch gate.
 * Needed here for a different reason than there: an aarch64 AppImage on an
 * x86-64 runner does not fail to LAUNCH, it fails to EXEC, and reporting
 * "Exec format error" as a broken release would be this gate inventing a
 * defect out of a host limit.
 *
 * Returns 'x64' | 'arm64' | 'armv7l' | 'ia32' | null.
 */
export function elfArch(path) {
    let fd;
    try {
        fd = openSync(path, 'r');
        const buf = Buffer.alloc(20);
        readSync(fd, buf, 0, 20, 0);
        if (buf.readUInt32BE(0) !== 0x7f454c46) return null;   // \x7fELF
        // e_machine is at 0x12, and little-endian on every target we ship.
        const machine = buf.readUInt16LE(0x12);
        return { 0x3e: 'x64', 0xb7: 'arm64', 0x28: 'armv7l', 0x03: 'ia32' }[machine] || null;
    } catch {
        return null;
    } finally {
        if (fd !== undefined) closeSync(fd);
    }
}

/**
 * What shape is this supposed-AppImage, by its own first bytes?
 *
 * The type-2 runtime stamps 'AI' + 0x02 into the ELF header's e_ident
 * padding at offset 8, and that is what makes the file self-executing
 * rather than merely an ELF.
 *
 * Three answers rather than a boolean, because the two negative cases are
 * owned by different files. An ELF WITHOUT the magic is a plausible object
 * that lib.sh's payload gate accepts (it reads e_machine, not this magic),
 * so this gate must say out loud that it did not launch it. A file that is
 * not an ELF at all has ALREADY been refused by that same payload gate -
 * "does not start with an ELF magic, so it is not the self-executing image
 * an AppImage must be" - so it cannot reach a real release, and running it
 * here risks nothing that gate has not already caught.
 *
 * @returns {'appimage'|'elf-not-appimage'|'not-elf'}
 */
export function appImageShape(path) {
    let fd;
    try {
        fd = openSync(path, 'r');
        const buf = Buffer.alloc(11);
        if (readSync(fd, buf, 0, 11, 0) < 11) return 'not-elf';
        if (buf.readUInt32BE(0) !== 0x7f454c46) return 'not-elf';
        return (buf[8] === 0x41 && buf[9] === 0x49 && buf[10] === 0x02) ? 'appimage' : 'elf-not-appimage';
    } catch {
        return 'not-elf';
    } finally {
        if (fd !== undefined) closeSync(fd);
    }
}

/** Is a command on PATH? */
function haveCommand(cmd) {
    return spawnSync('command', ['-v', cmd], { shell: true, encoding: 'utf8' }).status === 0;
}

/**
 * Can this shell start a GUI application at all?
 *
 * On macOS a process in a Background launchd session (which is what an SSH
 * shell gets) cannot connect to the window server, so a perfectly good app
 * fails to come up and would read as a broken release. `launchctl
 * managername` answers 'Aqua' in a desktop session and 'Background'
 * otherwise, so the difference is checkable rather than guessed at.
 *
 * On Linux the equivalent is a display: DISPLAY or WAYLAND_DISPLAY, or
 * xvfb-run to manufacture one, which is how a headless CI runner gets to
 * probe at all.
 *
 * @returns {{can: true, note?: string} | {can: false, reason: string}}
 */
export function hostSessionCapability({ platform = process.platform, env = process.env, has = haveCommand } = {}) {
    if (platform === 'darwin') {
        const res = spawnSync('launchctl', ['managername'], { encoding: 'utf8' });
        const name = (res.stdout || '').trim();
        if (name === 'Aqua') return { can: true };
        return {
            can: false,
            reason: `this shell has no macOS GUI session (launchctl managername = ${name || 'unknown'});`
                + ' run the signing ceremony from a Terminal on the release Mac\'s own desktop'
                + ' so the packaged app can actually come up',
        };
    }
    if (platform === 'linux') {
        if (env.DISPLAY || env.WAYLAND_DISPLAY) return { can: true };
        if (has('xvfb-run')) return { can: true, note: 'no display, using xvfb-run' };
        return {
            can: false,
            reason: 'this host has no DISPLAY or WAYLAND_DISPLAY and xvfb-run is not installed'
                + ' (apt install xvfb), so a GUI process has nothing to attach to',
        };
    }
    return { can: false, reason: `no launch probe implementation for platform '${platform}'` };
}

/** The x64-on-arm64 case: is Rosetta 2 installed to translate it? */
function haveRosetta() {
    return spawnSync('arch', ['-x86_64', '/usr/bin/true'], { encoding: 'utf8' }).status === 0;
}

/**
 * The executable inside a .app bundle.
 *
 * Contents/MacOS usually holds exactly one file, and when it does that is
 * the answer without parsing anything. When it does not, Info.plist's
 * CFBundleExecutable is the definitive one and PlistBuddy reads it whether
 * the plist is XML or binary.
 */
export function macBundleExecutable(appDir) {
    const macOsDir = join(appDir, 'Contents', 'MacOS');
    let entries = [];
    try {
        entries = readdirSync(macOsDir, { withFileTypes: true }).filter((d) => d.isFile());
    } catch (err) {
        return { path: null, reason: `no Contents/MacOS in the bundle: ${String(err?.message || err)}` };
    }
    if (entries.length === 1) return { path: join(macOsDir, entries[0].name) };
    const res = spawnSync('/usr/libexec/PlistBuddy',
        ['-c', 'Print :CFBundleExecutable', join(appDir, 'Contents', 'Info.plist')], { encoding: 'utf8' });
    const name = (res.stdout || '').trim();
    if (res.status === 0 && name) return { path: join(macOsDir, name) };
    return { path: null, reason: `cannot tell which of ${entries.length} files in Contents/MacOS is the app` };
}

/**
 * Probe one macOS app zip.
 *
 * `ditto -x -k` rather than `unzip`, because it is the extractor Apple's
 * own tooling uses and it preserves the symlinks inside a framework bundle
 * and the extended attributes the signature seals. An `unzip` round-trip
 * can produce a bundle that fails to load for reasons that are the
 * extractor's fault, which would be a probe reporting its own bug as a
 * broken release.
 */
async function probeMacZip(path, ctx) {
    const appRoot = join(ctx.work, 'app');
    const ex = spawnSync('ditto', ['-x', '-k', path, appRoot], { encoding: 'utf8' });
    if (ex.status !== 0) {
        return { state: 'failed', reason: `could not expand the archive: ${(ex.stderr || '').trim().slice(0, EXCERPT)}` };
    }
    // A ZIP THAT IS NOT AN APP BUNDLE IS A FORMAT QUESTION, NOT A LAUNCH
    // ONE, and this gate answers only the second. There is nothing here to
    // start, so there is nothing to say about whether it starts, and the
    // honest report is a named skip. The shape is not covered anywhere: a
    // mac zip with no bundle inside cannot contain the sealed
    // `_CodeSignature/CodeResources` path that verify-signatures.mjs
    // requires, so it is refused a row earlier; and on the CI lane that
    // builds it, `--require-probed` turns "nothing launched" red. Failing
    // here instead would mean a synthetic fixture could never exercise
    // sign.sh at all, which buys nothing and costs the pipeline's own test.
    const app = readdirSync(appRoot).find((n) => n.endsWith('.app'));
    if (!app) return { state: 'recorded', reason: 'NOT PROBED: the archive contains no .app bundle to launch' };
    const { path: exe, reason } = macBundleExecutable(join(appRoot, app));
    if (!exe) return { state: 'recorded', reason: `NOT PROBED: ${reason}` };
    try {
        statSync(exe);
    } catch {
        return { state: 'recorded', reason: `NOT PROBED: the bundle names an executable that is not there (${basename(exe)})` };
    }

    // Cross-architecture: an x64 bundle on Apple silicon runs only under
    // Rosetta 2, which is not installed by default. Without it the honest
    // answer is NOT PROBED naming the missing translator, not a failure -
    // the artifact is fine and this host simply cannot execute it.
    const built = machoArch(exe);
    const hostArch = ctx.arch === 'arm64' ? 'arm64' : 'x64';
    let cmd = exe;
    let args = [];
    let translated = false;
    if (built && built !== 'universal' && built !== hostArch) {
        if (built === 'x64' && hostArch === 'arm64' && haveRosetta()) {
            cmd = 'arch';
            args = ['-x86_64', exe];
            translated = true;
        } else {
            return {
                state: 'recorded',
                blocked: built === 'x64' && hostArch === 'arm64',
                reason: `NOT PROBED: built for ${built} and this host is ${hostArch}`
                    + (built === 'x64' ? ' with no Rosetta 2 installed (softwareupdate --install-rosetta)' : ''),
            };
        }
    }
    const obs = await launchAndWatch(cmd, [...args, ...ctx.appArgs], { timeoutMs: ctx.timeoutMs });
    if (obs.spawnError) return { state: 'failed', reason: `could not execute the bundle: ${obs.spawnError}` };
    const res = evaluate(obs, { expect: ctx.expect });
    // A TRANSLATED PASS IS WEAKER EVIDENCE THAN A NATIVE ONE, and this is
    // measured, not cautious: the v0.338.0 x64 bundle - the same build,
    // from the same allow-jit defect - starts perfectly well under Rosetta
    // 2 on Apple silicon and stays up, while its arm64 twin dies in three
    // seconds. Hardened-runtime JIT restrictions bite differently per
    // architecture, so a green line from a translated run must say what it
    // was, or the arch it did not cover reads as covered.
    if (res.state === 'ok' && translated) {
        return { ...res, reason: `${res.reason} (under Rosetta 2, translated: weaker evidence than a native run)` };
    }
    return res;
}

/**
 * Probe one Linux AppImage.
 *
 * APPIMAGE_EXTRACT_AND_RUN=1 rather than a FUSE mount, because the runner
 * images and containers this is likely to run in have no /dev/fuse and the
 * probe should be measuring the app, not the kernel module list. The
 * AppImage is copied out of the staging directory before its executable bit
 * is set, so the gate never mutates an artifact it is about to hash.
 *
 * --no-sandbox because Chromium's SUID sandbox needs unprivileged user
 * namespaces, which Ubuntu 24.04 restricts by AppArmor profile and most
 * containers deny outright. The sandbox is a runtime security boundary for
 * a real user; whether it can be entered on a build runner says nothing
 * about whether this release starts.
 */
async function probeAppImage(path, ctx) {
    // Cross-architecture on Linux has no Rosetta to fall back on: an
    // aarch64 image on an x86-64 runner cannot be executed at all, so the
    // honest answer is a named skip rather than the exec failure the
    // launcher would otherwise report as a broken app.
    const built = elfArch(path);
    const hostArch = ctx.arch === 'arm64' ? 'arm64' : ctx.arch === 'x64' ? 'x64' : ctx.arch;
    if (built && built !== hostArch) {
        return {
            state: 'recorded',
            reason: `NOT PROBED: built for ${built} and this host is ${hostArch};`
                + ' Linux has no user-mode translator for it here',
        };
    }
    // IS IT ACTUALLY AN APPIMAGE? Type 2 stamps 'AI' followed by 0x02 into
    // the ELF header's padding at offset 8, which is what makes the file
    // self-executing rather than merely an ELF. Checked BEFORE anything is
    // chmod +x'd and run, for two reasons: this gate must not execute
    // arbitrary bytes out of a staging directory, and an exec that fails
    // with "Exec format error" would otherwise be reported as an app that
    // cannot start when the truth is that the file is not that format. Same
    // reasoning as the no-bundle case on the mac lane: the format question
    // belongs to the payload gates in lib.sh, which read this same header.
    if (appImageShape(path) === 'elf-not-appimage') {
        return {
            state: 'recorded',
            reason: 'NOT PROBED: an ELF without the type-2 AppImage magic (AI\\x02 at offset 8),'
                + ' so there is no self-executing image here to launch',
        };
    }
    const copy = join(ctx.work, basename(path));
    const cp = spawnSync('cp', ['-p', path, copy], { encoding: 'utf8' });
    if (cp.status !== 0) return { state: 'failed', reason: `could not stage a copy: ${(cp.stderr || '').trim()}` };
    chmodSync(copy, 0o755);

    const env = { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1' };
    const appArgs = ['--no-sandbox', ...ctx.appArgs];
    let cmd = copy;
    let args = appArgs;
    if (ctx.needsXvfb) {
        cmd = 'xvfb-run';
        args = ['-a', copy, ...appArgs];
    }
    const obs = await launchAndWatch(cmd, args, { timeoutMs: ctx.timeoutMs, env });
    if (obs.spawnError) return { state: 'failed', reason: `could not execute the AppImage: ${obs.spawnError}` };
    return evaluate(obs, { expect: ctx.expect });
}

/**
 * Probe one artifact end to end: classify it, decide whether this host can
 * launch it, launch it in a throwaway profile, and clean up.
 *
 * Returns { file, class, state, reason } with the same three states
 * verify-signatures.mjs uses, so the two gates' output reads the same way.
 */
export async function probeArtifact(path, {
    platform = process.platform,
    arch = process.arch,
    timeoutMs = 8000,
    expect = [],
    session,
} = {}) {
    const file = basename(path);
    const cls = classifyArtifact(file);
    const spec = LAUNCH_CLASSES[cls];
    if (!spec.host) return { file, class: cls, state: 'recorded', reason: `NOT PROBED: ${spec.what}` };
    if (spec.host !== platform) {
        return {
            file,
            class: cls,
            state: 'recorded',
            reason: `NOT PROBED: ${cls} runs on ${spec.host} and this host is ${platform}`,
        };
    }
    const sess = session ?? hostSessionCapability({ platform });
    if (!sess.can) {
        // BLOCKING IS SCOPED TO macOS ON PURPOSE, and the two lanes differ in
        // what stands behind them. The release Mac signs by hand, sign.sh
        // passes no --require-probed there (the set holds Linux artifacts no
        // Mac can execute), so a ceremony run over SSH - no Aqua session -
        // would otherwise probe nothing and sign a macOS release with zero
        // launch evidence. Nothing else would catch it. The Linux lane has a
        // backstop already: it launches under CI with --require-probed 1, so
        // "launched nothing" is red there by that flag. Blocking headless
        // Linux as well would only make the suite unrunnable on every venue
        // in the pool that has no xvfb, buying no honesty the flag does not
        // already buy.
        const blocked = platform === 'darwin';
        return { file, class: cls, state: 'recorded', blocked, reason: `NOT PROBED: ${sess.reason}` };
    }

    const work = mkdtempSync(join(tmpdir(), 'xchain-launch-probe-'));
    const userData = join(work, 'user-data');
    const ctx = {
        work,
        arch,
        timeoutMs,
        expect,
        needsXvfb: Boolean(sess.note),
        // THE ISOLATION. Electron reads this before the app's own code runs,
        // so the wallet's vault, settings and single-instance lock all land
        // in a directory that is deleted below and never in the operator's.
        appArgs: [`--user-data-dir=${userData}`],
    };
    try {
        const res = cls === 'mac-app-zip' ? await probeMacZip(path, ctx) : await probeAppImage(path, ctx);
        return { file, class: cls, ...res };
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

/**
 * Summarise for the release log, counting probed and not-probed apart.
 * Same shape and same reason as verify-signatures.mjs's summarise: a run
 * that launched nothing must not read like a run that launched everything.
 */
export function summarise(results) {
    const ok = results.filter((r) => r.state === 'ok');
    const failed = results.filter((r) => r.state === 'failed');
    // A channel pointer or a web tarball is not an app that failed to be
    // probed, it is a file with nothing to probe, and counting the two
    // together would pad the not-probed number with files whose absence
    // from the launch report is correct. That padding is the direction
    // that makes a thin run look thorough.
    const notApp = results.filter((r) => r.class === 'not-an-app');
    const recorded = results.filter((r) => r.state === 'recorded' && r.class !== 'not-an-app');
    // NOT EVERY "not probed" IS THE SAME KIND OF SILENCE. A macOS artifact on
    // a Linux host, or a .deb that packages the app its AppImage sibling
    // already launched, is a skip nothing can fix and nothing should fail
    // for. A missing Aqua session, a missing display, a missing Rosetta 2 is
    // a check this host WAS supposed to run and could not - and that must
    // never read as a check that was not needed. Same fail-shut rule row 147
    // put on the swap waiver.
    const blocked = recorded.filter((r) => r.blocked);
    return {
        ok: ok.length,
        failed: failed.length,
        recorded: recorded.length,
        notApp: notApp.length,
        failures: failed,
        blocked,
    };
}

/**
 * Probe every artifact in `dir`. Returns an exit code and prints a report
 * shaped like the other release gates.
 *
 * `requireProbed` is a MINIMUM NUMBER OF LAUNCHES, for a venue where the
 * host and the lane match by construction: release.yml's mac job on a mac
 * runner, its linux job on a linux runner. There, probing nothing is a
 * broken venue rather than an honest host limit, and this turns it red.
 *
 * A count rather than "no skips allowed", because a legitimate skip
 * survives even in that venue: the x64 mac zip needs Rosetta 2 on an Apple
 * silicon runner, and an arm64 AppImage cannot be executed on an x86-64
 * one. Demanding zero skips would make those jobs fail for the host being
 * what GitHub gives us, and a gate that cannot be satisfied gets removed.
 *
 * It is deliberately unset for sign.sh, which runs on the release Mac
 * against a set containing Linux artifacts no Mac can launch; there,
 * silence is prevented by the banner rather than by refusal.
 */
export async function run(dir, { releaseSet = 'release', timeoutMs = 8000, expect = [], requireProbed = 0 } = {}) {
    let names;
    try {
        names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
    } catch (err) {
        process.stderr.write(`launch-probe: cannot list ${dir}: ${String(err?.message || err)}\n`);
        return 1;
    }
    process.stdout.write(`launch probe: ${names.length} file(s) in the ${releaseSet} set,`
        + ` host ${process.platform}/${process.arch}, ${timeoutMs / 1000}s window\n`);

    const results = [];
    for (const name of names.sort()) {
        results.push(await probeArtifact(join(dir, name), { timeoutMs, expect }));
    }

    // Everything that is not a plain pass is printed, failures and skips
    // alike, with the skips reading unmistakably as skips.
    for (const r of results.filter((x) => x.state !== 'ok' && x.class !== 'not-an-app')) {
        process.stdout.write(`${r.state === 'failed' ? '✗' : '·'} ${r.file}: ${r.reason}\n`);
    }
    for (const r of results.filter((x) => x.state === 'ok')) {
        process.stdout.write(`✓ ${r.file}: ${r.reason}\n`);
    }

    const sum = summarise(results);
    if (sum.failed) {
        process.stderr.write(`\nlaunch-probe: ${sum.failed} artifact(s) failed the launch probe.\n`
            + '  The release must not be manifest-signed in this state. Every other\n'
            + '  gate reads these artifacts and all of them pass on a build that dies\n'
            + '  at launch: v0.338.0 was signed, notarized, stapled, reproduced and\n'
            + '  rehearsed, and died three seconds in on every Mac.\n'
            + '  Usual causes: a hardened-runtime entitlement (allow-jit, allow-unsigned-\n'
            + '  executable-memory) turned off, a native module missing from the asar\n'
            + '  unpack list, or a main-process throw before the first window.\n');
        return 1;
    }

    // Fail shut BEFORE --require-probed, and independently of it: sign.sh
    // deliberately passes no minimum (the release Mac holds Linux artifacts
    // it cannot execute), so without this a signing ceremony run over SSH
    // would probe nothing, print the banner into a long log, and sign a
    // macOS release with zero launch evidence. That is the exact ceremony
    // row 143's build went through.
    if (sum.blocked.length) {
        process.stderr.write(`\nlaunch-probe: ${sum.blocked.length} artifact(s) could NOT be probed because this host `
            + 'is missing a facility, not because the artifact belongs to another platform.\n'
            + sum.blocked.map((r) => `  ${r.file}: ${r.reason}\n`).join('')
            + '  "I could not check" is not "no check was needed". Fix the host and run\n'
            + '  again: a macOS launch needs a logged-in Aqua session (an SSH shell has\n'
            + '  none), a Linux launch needs a display or xvfb, and an x64 mac artifact\n'
            + '  on Apple silicon needs Rosetta 2.\n');
        return 1;
    }

    if (requireProbed && sum.ok < requireProbed) {
        const skipped = results.filter((r) => r.state === 'recorded' && LAUNCH_CLASSES[r.class].host);
        process.stderr.write(`\nlaunch-probe: --require-probed ${requireProbed}, and only ${sum.ok} artifact(s) were launched.\n`
            + `  launchable class but skipped: ${skipped.length}\n`
            + '  This flag is set where the host and the lane match by construction, so\n'
            + '  too few launches here is a broken venue, not an honest host limit:\n'
            + '  the lane built these artifacts on this very platform.\n');
        return 1;
    }
    if (sum.ok === 0) {
        // The banner. A gate whose green line is indistinguishable from a
        // gate that did nothing is the defect this row exists to remove, so
        // the zero case says so at the top of its voice rather than in a
        // parenthesis.
        process.stdout.write('\n  ****  LAUNCH PROBE RAN NOTHING  ****\n'
            + `  ${sum.recorded} artifact(s) were recorded, ZERO were launched, and this gate\n`
            + '  therefore says NOTHING about whether this release starts. The reasons\n'
            + '  are listed above, one per artifact. If any of them is a missing host\n'
            + '  facility rather than a wrong-platform artifact, fix the host and run\n'
            + '  again before signing.\n');
        return 0;
    }
    process.stdout.write(`launch probe ok (${sum.ok} launched and still alive, `
        + `${sum.recorded} not probed on this host, ${sum.notApp} non-app file(s) ignored)\n`);
    return 0;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('launch-probe.mjs');

const USAGE = `launch-probe.mjs - does the packaged app actually START? (row 144.)

Every other release gate reads an artifact. This one runs it: it launches the
packaged app for the CURRENT HOST platform in a throwaway profile, waits, and
requires the process to still be alive with no crash output.

Usage:
  node tools/release/launch-probe.mjs <artifact-dir> [release-set] [options]

Arguments:
  <artifact-dir>        the staged release directory to probe
  [release-set]         release (default) or staging; reported, not gated on

Options:
  --timeout <seconds>   how long the app must stay up (default 8)
  --expect-log <regex>  require this pattern in the app's combined output.
                        REPEATABLE, and NOT comma-split: a regex may contain
                        a comma. Nothing is required by default.
  --require-probed [n]  fail unless at least n artifacts were LAUNCHED
                        (default 1). For venues where the host and the lane
                        match by construction (CI), not for the release
                        machine, which holds artifacts for platforms it
                        cannot execute.
  -h, --help            print this and exit 0

An artifact this host cannot launch reports NOT PROBED, is counted apart from
the passes, and a run that launched nothing prints a standing banner saying
so. "We did not look" must never read as "we looked and it was fine".

Exit codes:
  0  every artifact this host could launch stayed up
  1  an artifact died, crashed, or lacked a required pattern
  2  the arguments are unusable
`;

if (invokedDirectly && process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
    process.stdout.write(USAGE);
    process.exit(0);
}

if (invokedDirectly) {
    const argv = process.argv.slice(2);
    const positional = [];
    const expect = [];
    let timeoutMs = 8000;
    let requireProbed = 0;
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--timeout') {
            const secs = Number(argv[i += 1]);
            if (!Number.isFinite(secs) || secs <= 0) {
                process.stderr.write(`launch-probe: --timeout wants a positive number of seconds, got '${argv[i]}'\n`);
                process.exit(2);
            }
            timeoutMs = Math.round(secs * 1000);
        } else if (a === '--expect-log') {
            const pattern = argv[i += 1];
            if (pattern === undefined) {
                process.stderr.write('launch-probe: --expect-log wants a regex\n');
                process.exit(2);
            }
            try {
                expect.push(new RegExp(pattern));
            } catch (err) {
                process.stderr.write(`launch-probe: --expect-log '${pattern}' is not a regex: ${String(err?.message || err)}\n`);
                process.exit(2);
            }
        } else if (a === '--require-probed') {
            // Optional count: `--require-probed` alone means one.
            const next = argv[i + 1];
            if (next !== undefined && /^\d+$/.test(next)) { requireProbed = Number(next); i += 1; } else { requireProbed = 1; }
        } else if (a.startsWith('-')) {
            process.stderr.write(`launch-probe: unknown option '${a}'\n`);
            process.exit(2);
        } else {
            positional.push(a);
        }
    }
    const [dir, releaseSet = 'release'] = positional;
    if (!dir) {
        process.stderr.write('usage: launch-probe.mjs <artifact-dir> [release-set] [--timeout s] [--expect-log rx] [--require-probed]\n');
        process.exit(2);
    }
    if (!['release', 'staging'].includes(releaseSet)) {
        process.stderr.write(`launch-probe: unknown release set '${releaseSet}'\n`);
        process.exit(2);
    }
    process.exit(await run(dir, { releaseSet, timeoutMs, expect, requireProbed }));
}
