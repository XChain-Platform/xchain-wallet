// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DRILL: watch a real .deb update install itself (§5, §7.5).
//
// WHY THIS EXISTS. The `.deb` was recorded as notify-only for months, on
// the belief that electron-updater's deb path "needs privilege escalation
// at install time" and therefore does not install anything. Reading the
// installed 6.8.9 says otherwise - `DebUpdater` downloads the .deb and runs
// `dpkg -i` under `pkexec` - and the built artifacts agree (our .deb ships
// `resources/package-type: deb`, and both Linux pointers list it). But
// reading is how the wrong claim got written in the first place. This
// drill watches it happen.
//
// It is the install/launch/swap half of a rehearsal (§7.5) for the one lane
// where that half is most load-bearing, because it is the only shipped
// update path that ends in a ROOT-PRIVILEGED package install. The feed-side
// probe in `rehearse.mjs run` cannot exercise any of it.
//
// WHAT IT DOES NOT PROVE, stated up front:
//
//   - It drives `DebUpdater` directly with a stub app adapter rather than
//     inside Electron. The class, the download, the selection out of the
//     real pointer and the install command are the real ones; Electron's
//     own plumbing around them is not exercised.
//   - `pkexec` is replaced by a recording shim (see below), because a
//     polkit prompt cannot be answered on a headless box. The shim proves
//     WHICH command line would have been escalated, and then runs it, so
//     the install that follows is real.
//   - It does not run our `updateVerify.js` gate: that gate refuses
//     everything until K1 is pinned (ceremony A), so a drill that included
//     it could only ever prove the refusal. The ordering of the gate is
//     covered by test/unit/desktop/updaterInstallGate.test.js.
//
// USAGE (inside a throwaway container - it installs and upgrades a system
// package, and it will refuse to run outside one):
//
//   node tools/release/drills/deb-update-swap.mjs <artifact-dir>
//
// The artifact directory holds two real builds of the same package, one
// version apart, plus the newer build's channel pointer:
//
//   xchain-wallet_<v1>_<arch>.deb
//   xchain-wallet_<v2>_<arch>.deb
//   stable-linux-<arch>.yml        (the v2 pointer, as electron-builder wrote it)

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import {
    chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

const USAGE = `deb-update-swap.mjs - DRILL: watch a real .deb update install itself
(§5, §7.5).

Usage:
  node tools/release/drills/deb-update-swap.mjs <artifact-dir>

Arguments:
  <artifact-dir>  a built desktop artifact directory containing the .deb
                  pair and the Linux channel pointers
Options:
  -h, --help      print this and exit 0

INSTALLS AND THEN UPGRADES A SYSTEM PACKAGE. It refuses to run outside a
container unless XCHAIN_DRILL_DISPOSABLE=1 is set, and refuses to run as
root, because root skips the escalation that is half of what is drilled.

This is the install/launch/swap half of a rehearsal for the one shipped
update path that ends in a root-privileged package install. The feed-side
probe in \`rehearse.mjs run\` cannot exercise any of it.

Environment:
  XCHAIN_DRILL_DISPOSABLE=1   allow running outside a container, on a host
                              you are willing to lose
`;

// FIRST, because the sole positional here is a directory this drill INSTALLS
// FROM. Unhandled, `--help` became the artifact directory: outside a
// container the disposability guard below happened to catch it, and inside one
// - which is exactly where this drill is meant to run - it would have been
// read as a real artifact set. An unrecognized flag must never become the
// input to a command that installs system packages.
if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
    process.stdout.write(USAGE);
    process.exit(0);
}

const artifactDir = process.argv[2];
if (!artifactDir) die('usage: deb-update-swap.mjs <artifact-dir>');

// ---------------------------------------------------------------- guards

// This installs and then UPGRADES a system package. Refuse anywhere that
// is not obviously disposable: the drill is worth nothing if the cost of
// running it is "which machine did I just install a wallet on".
if (!existsSync('/.dockerenv') && process.env.XCHAIN_DRILL_DISPOSABLE !== '1') {
    die('refusing to run outside a container. This installs a system package.\n'
        + 'Set XCHAIN_DRILL_DISPOSABLE=1 only on a host you are willing to lose.');
}
if (process.platform !== 'linux') die(`this drill is Linux-only (running on ${process.platform})`);

// Root would skip escalation entirely (`LinuxUpdater.isRunningAsRoot`), which
// is the one branch a real user never takes. Refuse it here, before anything
// is installed: a green drill that ran as root proves the install and not the
// escalation, which is the half worth watching.
if (process.getuid() === 0) {
    die('run this drill as a NON-root user. As root, LinuxUpdater skips escalation\n'
        + 'entirely, and escalation is half of what is being drilled. The user needs\n'
        + 'passwordless sudo, which is what the pkexec shim escalates through.');
}

const debs = readdirSync(artifactDir).filter((f) => f.endsWith('.deb')).sort();
if (debs.length !== 2) die(`expected exactly two .deb files in ${artifactDir}, found ${debs.length}`);
const pointerName = readdirSync(artifactDir).find((f) => /^stable-linux.*\.yml$/.test(f));
if (!pointerName) die(`no stable-linux*.yml pointer in ${artifactDir}`);

const pointer = readFileSync(join(artifactDir, pointerName), 'utf8');
const pointerVersion = /^version:\s*(.+)$/m.exec(pointer)?.[1]?.trim();
if (!pointerVersion) die(`no version: in ${pointerName}`);

const [oldDeb, newDeb] = debs[0].includes(pointerVersion)
    ? [debs[1], debs[0]] : [debs[0], debs[1]];
const oldVersion = /_([0-9][^_]*)_/.exec(oldDeb)?.[1];
if (!oldVersion) die(`cannot read a version out of ${oldDeb}`);
if (oldVersion === pointerVersion) {
    die(`both .deb files are version ${oldVersion}; the drill needs one version apart`);
}

log(`installed-from: ${oldDeb} (${oldVersion})`);
log(`offered:        ${newDeb} (${pointerVersion}), via ${pointerName}`);

// ------------------------------------------------- 1. install the old one

// Setup, not the thing under test: this one escalates through sudo directly
// rather than through the shim, so the shim's log records only the install
// the UPDATER performed.
run('sudo', ['-n', 'dpkg', '-i', join(artifactDir, oldDeb)], 'installing the starting version');
const installedBefore = packageVersion();
if (installedBefore !== oldVersion) {
    die(`dpkg reports ${installedBefore} after installing ${oldVersion}`);
}
log(`dpkg: xchain-wallet ${installedBefore} installed`);

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

// ------------------------------------- 3. a pkexec that records and obeys

// LinuxUpdater picks the first of gksudo / kdesudo / pkexec / beesu it can
// find, and falls back to `sudo`. On a desktop that is a polkit prompt,
// which is the thing this drill exists to make visible and cannot answer
// headless. The shim records the exact argv that WOULD have been escalated
// and then runs it, so what follows is a real install.
const shimDir = mkdtempSync(join(tmpdir(), 'xchain-drill-'));
const shimLog = join(shimDir, 'pkexec.log');
writeFileSync(join(shimDir, 'pkexec'), [
    '#!/bin/bash',
    `printf '%s\\n' "$*" >> ${shimLog}`,
    'if [ "$1" = "--disable-internal-agent" ]; then shift; fi',
    // pkexec's job is to escalate, and dpkg genuinely needs root, so the
    // shim escalates too - through passwordless sudo, which is the only
    // form of it that works with no one at the keyboard. What the shim
    // replaces is the PROMPT, not the privilege.
    'if [ "$(id -u)" -ne 0 ]; then exec sudo -n "$@"; fi',
    'exec "$@"',
].join('\n'));
chmodSync(join(shimDir, 'pkexec'), 0o755);
process.env.PATH = `${shimDir}:${process.env.PATH}`;

// ------------------------------------------- 4. drive the real DebUpdater

// Resolved from packages/desktop so the drill uses the SAME electron-updater
// the shipped app does, not whatever the workspace root happens to hoist.
const desktopRequire = createRequire(
    new URL('../../../packages/desktop/package.json', import.meta.url),
);
const { DebUpdater } = desktopRequire('electron-updater');

const cacheDir = mkdtempSync(join(tmpdir(), 'xchain-drill-cache-'));
mkdirSync(join(cacheDir, 'pending'), { recursive: true });

// The download path re-reads the bundled `app-update.yml`, so the drill
// needs one. Same shape electron-builder bakes into the package, pointed at
// the local feed rather than the production one - a drill that read the real
// file would be one typo away from asking downloads.xchain.io for an update.
writeFileSync(join(cacheDir, 'app-update.yml'), [
    'provider: generic',
    `url: ${feedUrl}`,
    'channel: stable',
    'updaterCacheDirName: xchain-wallet-drill-updater',
    '',
].join('\n'));

/** The AppAdapter surface electron-updater actually uses. */
const app = {
    version: installedBefore,
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

// Constructed WITHOUT a feed, on purpose. Passing a custom app adapter makes
// electron-updater set `httpExecutor = null` (it assumes Electron's `net`
// session is unavailable, which here is true), and `setFeedURL` captures the
// executor into the provider's runtime options at the moment it is called.
// Handing options to the constructor therefore builds a provider around the
// null, and every request dies on "Cannot read properties of null".
const updater = new DebUpdater(null, app);

// Node's HTTP executor, the one electron-builder itself uses. This is the
// seam where the drill stops being the shipped app: transport is Node's
// here and Chromium's there. Everything downstream of the response -
// selection out of the pointer, the hash check, the install - is the real
// code path.
const { NodeHttpExecutor } = desktopRequire('builder-util');
const { configureRequestUrl, configureRequestOptions } = desktopRequire('builder-util-runtime');
const executor = new NodeHttpExecutor();

// `download(url, destination, options)` lives on ElectronHttpExecutor, not on
// the shared base, so the Node one has to grow it. This is upstream's own
// implementation, verbatim in shape: same `doDownload`, same null response
// handler, which is what routes it through `configurePipes` - and that is
// where the DigestTransform checking the pointer's sha512 lives. Skipping it
// would have made the drill prove less than the real path does.
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
updater.setFeedURL({ provider: 'generic', url: feedUrl, channel: 'stable' });
updater.autoDownload = false;
updater.autoInstallOnAppQuit = false;
updater.allowDowngrade = false;
updater.logger = { info: (m) => log(`updater: ${m}`), warn: (m) => log(`updater WARN: ${m}`),
    error: (m) => log(`updater ERROR: ${m}`), debug: () => {} };

const check = await updater.checkForUpdates();
if (!check?.isUpdateAvailable) die(`no update offered (pointer says ${pointerVersion})`);
log(`offered version ${check.updateInfo.version}`);

const downloaded = await updater.downloadUpdate(check.cancellationToken);
const file = Array.isArray(downloaded) ? downloaded[0] : downloaded;
if (!file || !file.endsWith('.deb')) {
    die(`DebUpdater downloaded ${file}, which is not the .deb - selection is wrong`);
}
log(`downloaded ${file}`);

const installed = updater.quitAndInstall(false, false);
if (installed === false) die('install() refused');

// ---------------------------------------------------------- 5. the proof

const escalation = existsSync(shimLog) ? readFileSync(shimLog, 'utf8').trim() : '';
const installedAfter = packageVersion();

log('');
log('RESULT');
log(`  package version before: ${installedBefore}`);
log(`  package version after:  ${installedAfter}`);
log(`  escalated command:      ${escalation || '(none - pkexec was never called)'}`);

if (!escalation) {
    die('the install ran without escalation. Either the shim was not found or the '
        + 'updater took a different path; either way the drill proved nothing.');
}
if (installedAfter !== pointerVersion) {
    die(`the package is still ${installedAfter}; the swap did not happen`);
}
log('');
log(`OK: a .deb install updated itself ${installedBefore} -> ${installedAfter}, `
    + 'through an escalated dpkg, driven by electron-updater.');
server.close();
process.exit(0);

// ------------------------------------------------------------- helpers

function packageVersion() {
    const out = spawnSync('dpkg-query', ['-W', "-f=${Version}", 'xchain-wallet'],
        { encoding: 'utf8' });
    return out.status === 0 ? out.stdout.trim() : null;
}

function run(cmd, args, why) {
    log(`${why}: ${cmd} ${args.join(' ')}`);
    const out = spawnSync(cmd, args, { encoding: 'utf8', stdio: 'inherit' });
    if (out.status !== 0) die(`${cmd} exited ${out.status}`);
}

function log(message) { process.stdout.write(`[deb-swap-drill] ${message}\n`); }

function die(message) {
    process.stderr.write(`[deb-swap-drill] FATAL: ${message}\n`);
    process.exit(1);
}
