// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DRILL: watch a real Windows nsis update install itself, on native x64
// silicon (§7.5, DD4).
//
// WHY THIS EXISTS, AND WHY IT IS NOT AN ATTESTATION. DD4 names a Parallels
// VM on the Mac Studio for both Windows lanes. That VM is an M3 Ultra, so
// `win-arm64` is native there and `win-x64` runs under Windows-on-ARM x64
// emulation - which puts the LARGEST desktop audience on the one lane whose
// attestation does not run on the silicon its users have. The operator took
// that trade deliberately (2026-08-03) and it stands. A hosted
// `windows-latest` runner is a free native x64 Windows machine, so the swap
// can additionally be WATCHED BY A MACHINE there, and this drill is what
// watches it.
//
// It cannot replace the attestation and does not try to. `rehearse.mjs
// attest` demands `--by <who watched it>` because whether the downloaded
// artifact replaced the RUNNING app is an OS-level fact no test in the
// process can observe; a job that attested its own swap would have removed
// that control rather than automated it. So this drill files its result
// through `rehearse.mjs check`, which stores it in `automated-checks`, never
// in `swaps`, and which cannot satisfy §7.5's per-release swap requirement.
//
// WHAT IT PROVES:
//
//   - The previous installer installs unattended on a real Windows machine
//     with no prompt to answer (`perMachine: false`, `oneClick: false`, so
//     `/S` is accepted and no UAC elevation is involved: the deb lane's
//     pkexec has no Windows analogue here).
//   - The REAL `NsisUpdater` from the shipped electron-updater resolves the
//     new installer out of the real channel pointer, downloads it, checks
//     the pointer's sha512, and runs it.
//   - The installed binary on disk is REPLACED: its file hash changes and
//     its ProductVersion becomes the new one. That is the "swap" half, and
//     it is the half the feed-side probe in `rehearse.mjs run` cannot touch.
//
// WHAT IT DOES NOT PROVE, stated up front, same as the deb drill:
//
//   - It drives `NsisUpdater` with a stub app adapter rather than from
//     inside Electron, so Electron's own plumbing around the updater is not
//     exercised.
//   - It does not run our `updateVerify.js` S5 gate: that gate refuses
//     everything until K1 is pinned (ceremony A), so a drill including it
//     could only ever prove the refusal. Its ordering is covered by
//     test/unit/desktop/updaterInstallGate.test.js.
//   - `app-update.yml` is written locally WITHOUT `publisherName`, so
//     electron-updater's Authenticode publisher-match is skipped. The
//     installers a CI swap-check builds are unsigned; the publisher half is
//     rehearsed by the staging lane, which builds signed.
//   - Nobody watched it. That is the whole point of it being a `check`.
//
// USAGE (installs the wallet for the current user, so it refuses any host
// that is not obviously disposable):
//
//   node tools/release/drills/win-update-swap.mjs <artifact-dir> \
//     [--out result.json] [--runner "<what machine this is>"]
//
// The artifact directory holds two real nsis installers of the same app,
// one version apart, plus the newer build's channel pointer:
//
//   xchain-wallet-setup-<v1>-x64.exe
//   xchain-wallet-setup-<v2>-x64.exe
//   stable.yml                        (the v2 pointer, as electron-builder wrote it)
//
// NEVER RUN ON A DEVELOPER MACHINE AS OF 2026-08-13: it was written on
// macOS, where every one of its guards refuses. The `windows-swap-check`
// workflow is its first venue, and the questions "does the two-version swap
// fit in one ephemeral job" and "can a headless runner answer everything the
// installer asks" are what that first run answers. Its pure halves (pairing,
// silicon detection, the disposability guard, the evidence shape) are driven
// off-Windows by test/smoke/audits/windows-swap-check.smoke.js.

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import {
    existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { makeSwapCheck } from '../rehearse.mjs';

const USAGE = `win-update-swap.mjs - DRILL: watch a real Windows nsis update install
itself, on native x64 silicon (§7.5, DD4).

Usage:
  node tools/release/drills/win-update-swap.mjs <artifact-dir> [options]
  node tools/release/drills/win-update-swap.mjs --silicon
  node tools/release/drills/win-update-swap.mjs --help

Arguments:
  <artifact-dir>   holds two nsis installers one version apart, plus the
                   newer build's channel pointer (stable.yml)

Options:
  --out <file>     write the evidence JSON here (default: swap-check.json
                   beside the artifact directory)
  --runner <text>  what machine this is, recorded verbatim in the evidence
  --silicon        print what silicon this process is running on and exit 0
  -h, --help       print this and exit 0

INSTALLS THE WALLET FOR THE CURRENT USER, then lets an updater replace it.
It refuses to run outside CI unless XCHAIN_DRILL_DISPOSABLE=1 is set.

THIS IS NOT AN ATTESTATION. It produces evidence that a machine performed
the swap; §7.5 still requires a person to watch one on the lane's DD4
device. File the result with:

  node tools/release/rehearse.mjs check --record <REHEARSAL-vX.Y.Z.json> \\
    --from-result <file>

Environment:
  XCHAIN_DRILL_DISPOSABLE=1   allow running outside CI, on a host you are
                              willing to lose
`;

// ------------------------------------------------------ the pure halves

/**
 * Which installer is the FROM, which is the TO, and which pointer offers it.
 *
 * Everything here is decided from the pointer rather than from filename
 * ordering: `0.9.0` sorts after `0.10.0` as a string, and a drill that
 * installed the pair backwards would report a downgrade as a passing swap.
 *
 * @param {string[]} names basenames of the artifact directory
 * @returns {{from: string, to: string, fromVersion: string, toVersion: string,
 *            pointer: string, arch: string, lane: string}}
 */
export function pairFromArtifacts(names, pointerText) {
    const exes = names.filter((n) => n.toLowerCase().endsWith('.exe')).sort();
    if (exes.length !== 2) {
        throw new Error(`expected exactly two .exe installers, found ${exes.length}`
            + `${exes.length ? ` (${exes.join(', ')})` : ''}`);
    }
    const pointer = names.find((n) => /\.yml$/i.test(n));
    if (!pointer) throw new Error('no channel pointer (*.yml) in the artifact directory');

    const toVersion = /^version:\s*(.+)$/m.exec(String(pointerText || ''))?.[1]?.trim();
    if (!toVersion) throw new Error(`no version: line in ${pointer}`);

    const parse = (name) => {
        const m = /setup-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-(x64|arm64|ia32)\.exe$/i.exec(name);
        if (!m) {
            throw new Error(`cannot read a version and arch out of ${name}. The drill needs the `
                + 'arch-carrying nsis names electron-builder.config.cjs pins '
                + '(xchain-wallet-setup-<version>-<arch>.exe).');
        }
        return { name, version: m[1], arch: m[2].toLowerCase() };
    };
    const parsed = exes.map(parse);
    if (parsed[0].arch !== parsed[1].arch) {
        throw new Error(`the two installers are different architectures (${parsed[0].arch} and `
            + `${parsed[1].arch}). A swap check updates one lane, from its own arch to its own.`);
    }
    const to = parsed.find((p) => p.version === toVersion);
    if (!to) {
        throw new Error(`the pointer offers ${toVersion}, and neither installer is that version `
            + `(${parsed.map((p) => p.version).join(', ')})`);
    }
    const from = parsed.find((p) => p !== to);
    if (from.version === to.version) {
        throw new Error(`both installers are version ${to.version}; the drill needs one version apart`);
    }
    return {
        from: from.name,
        to: to.name,
        fromVersion: from.version,
        toVersion: to.version,
        pointer,
        arch: to.arch,
        lane: to.arch === 'arm64' ? 'win-arm64' : 'win-x64',
    };
}

/**
 * What silicon is this process really running on?
 *
 * THE ONE QUESTION THIS DRILL EXISTS FOR. `process.arch` says what the
 * BINARY is, not what the CPU is: an x64 Node on Windows-on-ARM reports
 * `x64` and is being emulated, which is exactly the DD4 device for
 * `win-x64`. Windows tells the truth in the environment - an emulated
 * process sees `PROCESSOR_ARCHITECTURE=AMD64` and
 * `PROCESSOR_ARCHITEW6432=ARM64` - so the two are compared rather than
 * assumed, and a check that cannot tell says so instead of claiming native.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} platform
 * @returns {{arch: string, native: boolean|null, label: string}}
 */
export function siliconOf(env = process.env, platform = process.platform, arch = process.arch) {
    if (platform !== 'win32') {
        return { arch, native: null, label: `not Windows (${platform}/${arch})` };
    }
    const running = String(env.PROCESSOR_ARCHITECTURE || '').toUpperCase();
    const under = String(env.PROCESSOR_ARCHITEW6432 || '').toUpperCase();
    if (!running) {
        return { arch, native: null, label: `unknown silicon (${arch}, PROCESSOR_ARCHITECTURE unset)` };
    }
    if (under && under !== running) {
        return { arch, native: false, label: `emulated (${arch} process on ${under.toLowerCase()} silicon)` };
    }
    return { arch, native: true, label: `native ${running.toLowerCase()}` };
}

/**
 * May this host be installed onto?
 *
 * An ephemeral CI runner is disposable by construction, which is the whole
 * reason this lane is worth having; anything else has to say so out loud.
 * The wallet installs per-user here (no elevation), so the blast radius is
 * a profile rather than a machine - smaller than the deb drill's, and still
 * not something to do to a workstation by accident.
 *
 * @returns {{ok: boolean, reason?: string, why: string}}
 */
export function disposabilityVerdict(env = process.env) {
    if (env.GITHUB_ACTIONS === 'true' || env.CI === 'true') {
        return { ok: true, why: 'ephemeral CI runner' };
    }
    if (env.XCHAIN_DRILL_DISPOSABLE === '1') {
        return { ok: true, why: 'XCHAIN_DRILL_DISPOSABLE=1' };
    }
    return {
        ok: false,
        why: 'not disposable',
        reason: 'refusing to run outside CI. This installs the wallet for the current user and '
            + 'then lets an updater replace it. Set XCHAIN_DRILL_DISPOSABLE=1 only on a host you '
            + 'are willing to lose.',
    };
}

// --------------------------------------------------------------- the drill

function log(message) { process.stdout.write(`[win-swap-drill] ${message}\n`); }

function die(message) {
    process.stderr.write(`[win-swap-drill] FATAL: ${message}\n`);
    process.exit(1);
}

/** ProductVersion of an on-disk exe, read from its version resource. */
function productVersion(exe) {
    const out = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`],
    { encoding: 'utf8' });
    return out.status === 0 ? out.stdout.trim() : null;
}

function sha256(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** The one app exe in an install directory, refusing to guess between several. */
function appExeIn(dir) {
    const exes = readdirSync(dir).filter(
        (n) => n.toLowerCase().endsWith('.exe') && !/^uninstall/i.test(n),
    );
    if (exes.length !== 1) {
        die(`expected one application exe in ${dir}, found ${exes.length}: ${exes.join(', ') || '(none)'}`);
    }
    return join(dir, exes[0]);
}

async function main(argv) {
    if (argv.some((a) => a === '--help' || a === '-h')) {
        process.stdout.write(USAGE);
        return 0;
    }

    // Answerable anywhere, including the developer machines where the rest
    // of this file refuses to run, because "what silicon is that runner
    // really" is the question the whole lane turns on and it should never
    // need a full drill run to ask.
    const silicon = siliconOf();
    if (argv.includes('--silicon')) {
        process.stdout.write(`${silicon.label}\n`);
        return 0;
    }

    const artifactDir = positionalOf(argv);
    if (!artifactDir) {
        process.stderr.write('usage: win-update-swap.mjs <artifact-dir> [--out file] [--runner text]\n');
        return 1;
    }

    // Platform first: on a Mac or a Linux box nothing below this line means
    // anything, and the message should say that rather than complain about
    // the artifact directory.
    if (process.platform !== 'win32') {
        die(`this drill is Windows-only (running on ${process.platform}). The swap it watches is `
            + 'an nsis installer replacing a running app, which only happens on Windows.');
    }
    const disposable = disposabilityVerdict();
    if (!disposable.ok) die(disposable.reason);

    if (!existsSync(artifactDir)) die(`no such artifact directory: ${artifactDir}`);
    const names = readdirSync(artifactDir);
    const pointerName = names.find((n) => /\.yml$/i.test(n));
    let pair;
    try {
        pair = pairFromArtifacts(
            names,
            pointerName ? readFileSync(join(artifactDir, pointerName), 'utf8') : '',
        );
    } catch (err) {
        return die(String(err?.message || err));
    }

    const outFile = flagValue(argv, '--out') || join(artifactDir, '..', 'swap-check.json');
    const runner = flagValue(argv, '--runner')
        || (process.env.GITHUB_ACTIONS === 'true'
            ? `GitHub-hosted ${process.env.RUNNER_OS || 'Windows'} runner (${process.env.RUNNER_ARCH || pair.arch})`
            : `unnamed Windows host (${pair.arch})`);
    const notes = [];

    log(`lane:           ${pair.lane}`);
    log(`silicon:        ${silicon.label}`);
    log(`installed-from: ${pair.from} (${pair.fromVersion})`);
    log(`offered:        ${pair.to} (${pair.toVersion}), via ${pair.pointer}`);

    // A check that ran on emulated silicon is still worth having and must
    // not pretend otherwise: the reason this lane exists is that the DD4
    // device emulates x64, so an emulated runner adds nothing the
    // attestation will not already cover.
    if (silicon.native === false) {
        notes.push('this check ran on EMULATED silicon, so it does not close the native-x64 gap '
            + 'that motivated it');
    } else if (silicon.native === null) {
        notes.push('the silicon could not be determined, so treat this as unknown rather than native');
    }

    const write = (result) => {
        const evidence = makeSwapCheck({
            lane: pair.lane,
            from: pair.fromVersion,
            to: pair.toVersion,
            result: result.result,
            runner,
            silicon: silicon.label,
            observed: result.observed,
            notes: [...notes, ...(result.notes || [])],
        });
        writeFileSync(outFile, `${JSON.stringify(evidence, null, 2)}\n`);
        log(`evidence written to ${outFile}`);
        log('NOT an attestation: §7.5 still owes a human-observed swap on this lane\'s DD4 device.');
    };

    // ------------------------------------------- 1. install the old version
    //
    // A path with no spaces and off the profile's beaten track: NSIS `/D=`
    // takes the rest of the command line verbatim and cannot be quoted.
    const installDir = join(process.env.SystemDrive || 'C:', 'xchain-swap-check', 'app');
    mkdirSync(installDir, { recursive: true });
    // Absolute: NSIS takes everything after `/D=` verbatim, and a relative
    // installer path spawned from a different cwd is the kind of failure that
    // reads as "the installer is broken".
    const first = spawnSync(resolve(artifactDir, pair.from), ['/S', `/D=${installDir}`],
        { encoding: 'utf8' });
    if (first.status !== 0) {
        write({ result: 'error', observed: {}, notes: [`the ${pair.fromVersion} installer exited `
            + `${first.status}: ${(first.stderr || '').trim() || 'no output'}`] });
        return die(`installing ${pair.from} exited ${first.status}`);
    }
    const exe = appExeIn(installDir);
    const versionBefore = productVersion(exe);
    const hashBefore = sha256(exe);
    log(`installed ${exe} (ProductVersion ${versionBefore})`);
    if (!versionBefore) {
        notes.push('the installed ProductVersion could not be read, so the version half of the '
            + 'proof rests on the installer filename alone');
    } else if (!versionBefore.startsWith(pair.fromVersion)) {
        notes.push(`the installed ProductVersion is ${versionBefore}, and the installer is named `
            + `${pair.fromVersion}`);
    }

    // ------------------------------------------------------ 2. serve the feed
    const server = createServer((req, res) => {
        const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1));
        const path = join(artifactDir, name);
        if (!existsSync(path) || !statSync(path).isFile()) {
            res.writeHead(404).end('no');
            return;
        }
        res.writeHead(200, {
            'content-type': 'application/octet-stream',
            'content-length': String(statSync(path).size),
        });
        res.end(readFileSync(path));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const feedUrl = `http://127.0.0.1:${server.address().port}/`;
    log(`feed: ${feedUrl}`);

    // ------------------------------------------ 3. drive the real NsisUpdater
    //
    // Resolved from packages/desktop so this is the SAME electron-updater the
    // shipped app carries, not whatever the workspace root hoists.
    const desktopRequire = createRequire(
        new URL('../../../packages/desktop/package.json', import.meta.url),
    );
    const { NsisUpdater } = desktopRequire('electron-updater');
    const { NodeHttpExecutor } = desktopRequire('builder-util');
    const { configureRequestUrl, configureRequestOptions } = desktopRequire('builder-util-runtime');

    const cacheDir = mkdtempSync(join(tmpdir(), 'xchain-win-drill-'));
    mkdirSync(join(cacheDir, 'pending'), { recursive: true });
    // The channel name comes from the pointer's own filename, so a staging
    // pair drills the staging channel without a flag to forget.
    const channel = pair.pointer.replace(/\.yml$/i, '');
    writeFileSync(join(cacheDir, 'app-update.yml'), [
        'provider: generic',
        `url: ${feedUrl}`,
        `channel: ${channel}`,
        'updaterCacheDirName: xchain-wallet-swap-check',
        '',
    ].join('\n'));

    const app = {
        version: pair.fromVersion,
        name: 'XChain Wallet',
        isPackaged: true,
        appUpdateConfigPath: join(cacheDir, 'app-update.yml'),
        userDataPath: cacheDir,
        baseCachePath: cacheDir,
        whenReady: async () => {},
        relaunch: () => log('app.relaunch() called'),
        quit: () => log('app.quit() called'),
        onQuit: () => {},
    };

    // Constructed WITHOUT a feed, then `setFeedURL`: a custom app adapter
    // makes electron-updater null its httpExecutor, and the provider
    // captures the executor at setFeedURL time. Same trap the deb drill
    // documents; handing options to the constructor builds a provider around
    // the null and every request dies on it.
    const updater = new NsisUpdater(null, app);
    const executor = new NodeHttpExecutor();
    executor.download = (url, destination, options) => options.cancellationToken
        .createPromise((resolve, reject, onCancel) => {
            const requestOptions = { headers: options.headers || undefined, redirect: 'manual' };
            configureRequestUrl(url, requestOptions);
            configureRequestOptions(requestOptions);
            executor.doDownload(requestOptions, {
                destination,
                options,
                onCancel,
                callback: (error) => (error == null ? resolve(destination) : reject(error)),
                responseHandler: null,
            }, 0);
        });
    updater.httpExecutor = executor;
    updater.setFeedURL({ provider: 'generic', url: feedUrl, channel });
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.logger = {
        info: (m) => log(`updater: ${m}`),
        warn: (m) => log(`updater WARN: ${m}`),
        error: (m) => log(`updater ERROR: ${m}`),
        debug: () => {},
    };

    let downloaded;
    try {
        const check = await updater.checkForUpdates();
        if (!check?.isUpdateAvailable) {
            throw new Error(`no update offered (pointer says ${pair.toVersion}, app says ${pair.fromVersion})`);
        }
        log(`offered version ${check.updateInfo.version}`);
        const files = await updater.downloadUpdate(check.cancellationToken);
        downloaded = Array.isArray(files) ? files[0] : files;
        if (!downloaded || !downloaded.toLowerCase().endsWith('.exe')) {
            throw new Error(`the updater downloaded ${downloaded}, which is not the nsis installer`);
        }
        log(`downloaded ${downloaded}`);
    } catch (err) {
        server.close();
        write({ result: 'error', observed: { versionBefore }, notes: [String(err?.message || err)] });
        return die(String(err?.message || err));
    }

    // isSilent: there is nobody to answer a wizard. isForceRunAfter false:
    // the drill wants the files on disk, not a wallet window opening on a
    // runner. Note what is NOT here - no elevation, because `perMachine:
    // false` means the installer writes a per-user tree and never asks for
    // UAC. That absence is the Windows answer to the deb lane's pkexec, and
    // it is the reason a headless runner can do this at all.
    const started = updater.quitAndInstall(true, false);
    if (started === false) {
        server.close();
        write({ result: 'fail', observed: { versionBefore }, notes: ['quitAndInstall() refused'] });
        return die('quitAndInstall() refused');
    }

    // -------------------------------------------------------- 4. the proof
    //
    // The installer is spawned detached, so the swap is observed by polling
    // the file the user runs rather than by waiting on a process. Both the
    // hash AND the version have to move: a version resource can be read from
    // a file that was never rewritten if the installer failed halfway, and a
    // hash change alone would not say the RIGHT build landed.
    const deadline = Date.now() + 180_000;
    let versionAfter = versionBefore;
    let hashAfter = hashBefore;
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        if (!existsSync(exe)) continue;
        hashAfter = sha256(exe);
        versionAfter = productVersion(exe);
        if (hashAfter !== hashBefore && versionAfter && versionAfter.startsWith(pair.toVersion)) break;
    }
    server.close();

    const observed = {
        exe,
        versionBefore,
        versionAfter,
        binaryReplaced: hashAfter !== hashBefore,
        sha256Before: hashBefore,
        sha256After: hashAfter,
        elevation: 'none (perMachine: false, so the installer writes a per-user tree)',
    };
    log('');
    log('RESULT');
    log(`  ProductVersion before: ${versionBefore}`);
    log(`  ProductVersion after:  ${versionAfter}`);
    log(`  binary replaced:       ${observed.binaryReplaced}`);

    const swapped = observed.binaryReplaced
        && String(versionAfter || '').startsWith(pair.toVersion);
    write({
        result: swapped ? 'pass' : 'fail',
        observed,
        notes: swapped ? [] : [`the app at ${exe} is still ${versionAfter}; the swap did not happen `
            + 'within 180s of the installer being launched'],
    });
    if (!swapped) return die(`the swap did not happen: still ${versionAfter}`);

    log('');
    log(`OK: an nsis install updated itself ${versionBefore} -> ${versionAfter} on `
        + `${silicon.label}, driven by electron-updater, with no prompt to answer.`);
    return 0;
}

function flagValue(argv, name) {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
}

/**
 * The single positional argument, with the values of value-taking flags
 * excluded.
 *
 * Spelled out rather than "the first argument that does not start with
 * `--`", because the sole positional here is a directory this drill
 * INSTALLS FROM: `--runner "some box"` would otherwise donate its value as
 * the artifact directory. The deb drill's `--help` bug is the same family.
 *
 * @param {string[]} argv
 * @returns {string|undefined}
 */
export function positionalOf(argv) {
    const takesValue = new Set(['--out', '--runner']);
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i].startsWith('-')) {
            if (takesValue.has(argv[i])) i += 1;
            continue;
        }
        return argv[i];
    }
    return undefined;
}

// Guards run inside main() rather than at import, so the pure halves above
// can be driven from a test on any platform. Nothing in this module does
// anything on import.
const invokedDirectly = (() => {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
})();

if (invokedDirectly) {
    main(process.argv.slice(2)).then((code) => process.exit(code));
}
