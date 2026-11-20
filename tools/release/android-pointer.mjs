// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/android-pointer.mjs - move the direct-Android feed pointer
// (wallet/android/latest.json) to a version whose APKs are already published.
//
// WHY THIS EXISTS. publish.sh writes android/latest.json only for a PARTIAL
// manifest (`# lanes:` header), and a full release manifest carries no lanes
// header, so a full production publish uploads both APKs and leaves the
// pointer on the previous version (v0.343.0 and v0.343.1 both did). The signed
// Android partial cannot fix it afterwards: its manifest is a second signed
// set for a version that is already published, which the immutability rule
// refuses, and its hash is not the one the rehearsal record is bound to.
//
// WHAT THE SHIPPED CLIENT DOES WITH THE POINTER. directUpdateCheck.js reads
// one field, `version`, and shows a notice composed from it. It fetches no
// manifest and no APK; the user downloads the new APK from the site and
// checks it against the published RELEASE_HASHES/v<version>.txt. So the
// pointer is safe to move exactly when that manifest is served, is signed by
// the pinned release key, and covers the APK bytes the site serves.
//
// SO EVERY CHECK READS WHAT IS SERVED, NOT A LOCAL COPY. The manifest, its
// signature and each APK are fetched through --public-base, the address users
// download from, and then:
//   1. verify.sh --artifact proves the K1 signature, the tag anchor and each
//      APK's sha256 against that served manifest;
//   2. verify-apk-play-protection.mjs refuses a Play-signed APK, as publish.sh;
//   3. rehearse.mjs assert requires a rehearsal record bound to that served
//      manifest, which `rehearse.mjs run` writes after probing android-direct
//      on staging (the install-over half stays "not proven", as in publish.sh).
// Only then is android/latest.json written, and it is the only file written.
//
// Usage:
//   node tools/release/android-pointer.mjs --tag vX.Y.Z \
//     --target <release-host>:wallet \
//     --public-base https://downloads.xchain.io/wallet \
//     --rehearsal <REHEARSAL-vX.Y.Z.json> [--release-record <file>] [--dry-run]
//
// Exits 0 written, already current or dry run / 1 refused / 2 usage.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isInvokedDirectly } from './is-invoked-directly.mjs';
import { purgeCloudflareFiles } from './cloudflare-purge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FEED_REL = 'android/latest.json';
const TAG_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const APK_ROW_RE = /^([0-9a-f]{64}) {2}\.\/([A-Za-z0-9._-]+\.apk)$/;

const USAGE = `Usage: node tools/release/android-pointer.mjs --tag vX.Y.Z --target <dir|host:path>
         --public-base <url> --rehearsal <file> [--release-record <file>] [--dry-run]

Moves wallet/android/latest.json to vX.Y.Z after a full production publish,
which uploads the APKs but does not write the pointer. Before writing, it fetches
RELEASE_HASHES/vX.Y.Z.txt, its .asc and every APK that manifest lists through
--public-base, verifies the signature against the pinned release key and each
APK's sha256 with verify.sh, refuses a Play-signed APK, and requires a rehearsal
record bound to the served manifest. Then it writes android/latest.json, the only
file it writes, and purges it at the edge when CLOUDFLARE_ZONE_ID and
CLOUDFLARE_PURGE_TOKEN are set. --dry-run runs every check and writes nothing.

Exits 0 written, already current or dry run / 1 refused / 2 usage.
`;

class Refusal extends Error {}

const say = (line) => process.stderr.write(`android-pointer: ${line}\n`);
const refuse = (line) => { throw new Refusal(line); };

/** Parse argv into options; throws a usage error string on anything unknown. */
export function parseArgs(argv) {
    const opts = { dryRun: false };
    const take = (i, flag) => {
        if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
        return argv[i + 1];
    };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--tag') { opts.tag = take(i, a); i += 1; }
        else if (a === '--target') { opts.target = take(i, a); i += 1; }
        else if (a === '--public-base') { opts.publicBase = take(i, a).replace(/\/+$/, ''); i += 1; }
        else if (a === '--rehearsal') { opts.rehearsal = take(i, a); i += 1; }
        else if (a === '--release-record') { opts.releaseRecord = take(i, a); i += 1; }
        else if (a === '--dry-run' || a === '-n') opts.dryRun = true;
        else throw new Error(`unknown argument '${a}'`);
    }
    for (const [key, flag] of [['tag', '--tag'], ['target', '--target'],
        ['publicBase', '--public-base'], ['rehearsal', '--rehearsal']]) {
        if (!opts[key]) throw new Error(`${flag} is required`);
    }
    if (!TAG_RE.test(opts.tag)) throw new Error(`--tag must be a plain vMAJOR.MINOR.PATCH, not '${opts.tag}'`);
    if (!/^https?:\/\//.test(opts.publicBase)) throw new Error('--public-base must be an http(s) URL');
    return opts;
}

/** The APK rows of a manifest, as [{ sha256, name }]. */
export function apkRows(manifestText) {
    return manifestText.split(/\r?\n/).map((line) => APK_ROW_RE.exec(line)).filter(Boolean)
        .map((m) => ({ sha256: m[1], name: m[2] }));
}

/** One `# key: value` header field, or ''. */
function headerField(manifestText, key) {
    const m = new RegExp(`^# ${key}: (.*)$`, 'm').exec(manifestText);
    return m ? m[1].trim() : '';
}

/** Is semver `a` newer than `b`? Both plain MAJOR.MINOR.PATCH. */
function isNewer(a, b) {
    const x = a.split('.').map(Number);
    const y = b.split('.').map(Number);
    for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// --- the target: a local directory or an rrsync host:path -----------------
//
// Same rules as publish.sh: a colon before any slash is a remote target,
// everything remote goes through GNU rsync (the K11 key is a forced rrsync
// command, so ssh cannot run), and remote paths stay relative.

const isRemote = (target) => target.includes(':') && !target.startsWith('/') && !target.startsWith('.');

function resolveRsync(target) {
    if (!isRemote(target)) return null;
    const candidates = process.env.XCHAIN_RSYNC
        ? [process.env.XCHAIN_RSYNC]
        : ['/opt/homebrew/bin/rsync', '/usr/local/bin/rsync', 'rsync'];
    for (const candidate of candidates) {
        const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
        if (probe.status !== 0) continue;
        if (/openrsync/i.test(probe.stdout.split('\n')[0])) {
            refuse(`${candidate} is openrsync, which the forced-command rrsync feed rejects; `
                + 'install GNU rsync or set XCHAIN_RSYNC (see publish.sh).');
        }
        return candidate;
    }
    return refuse('no rsync found for a remote target');
}

/** Does `rel` exist at the target? A listing failure is fatal, never "absent". */
function targetExists(target, rsync, rel) {
    if (!isRemote(target)) return existsSync(join(target, rel));
    const [host, base] = [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)];
    const dir = dirname(rel) === '.' ? '' : `${dirname(rel)}/`;
    const listing = spawnSync(rsync, ['--list-only', '-e', 'ssh', `${host}:${base.replace(/\/+$/, '')}/${dir}`],
        { encoding: 'utf8' });
    if (listing.status !== 0) {
        refuse(`cannot list ${target}/${dir}: ${(listing.stderr || '').trim()}`);
    }
    const name = rel.split('/').pop();
    return listing.stdout.split('\n')
        .some((line) => line.trim().split(/\s+/).slice(4).join(' ') === name);
}

function copyToTarget(target, rsync, src, rel) {
    if (!isRemote(target)) {
        mkdirSync(dirname(join(target, rel)), { recursive: true });
        copyFileSync(src, join(target, rel));
        chmodSync(join(target, rel), 0o644);
        return true;
    }
    const [host, base] = [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)];
    const r = spawnSync(rsync, ['-a', '--mkpath', '-e', 'ssh', src, `${host}:${base.replace(/\/+$/, '')}/${rel}`],
        { stdio: ['ignore', 'inherit', 'inherit'] });
    return r.status === 0;
}

// --- reads through the public base ----------------------------------------

async function fetchServed(url) {
    let res;
    try {
        res = await fetch(url, { cache: 'no-store', redirect: 'follow' });
    } catch (e) {
        return { status: 0, error: String(e?.cause?.message || e?.message || e) };
    }
    return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
}

/** The version the served pointer names, or null when it is absent or unreadable. */
async function servedPointerVersion(publicBase) {
    const r = await fetchServed(`${publicBase}/${FEED_REL}?cb=${Date.now()}${process.pid}`);
    if (r.status !== 200) return null;
    try {
        const v = JSON.parse(r.body.toString('utf8')).version;
        return typeof v === 'string' && TAG_RE.test(`v${v}`) ? v : null;
    } catch {
        return null;
    }
}

function runTool(cmd, args) {
    const r = spawnSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    return r.status === 0;
}

async function purge(publicBase) {
    const zone = process.env.CLOUDFLARE_ZONE_ID;
    const token = process.env.CLOUDFLARE_PURGE_TOKEN;
    const url = `${publicBase}/${FEED_REL}`;
    if (!zone || !token) {
        say(`NOT purging - CLOUDFLARE_ZONE_ID / CLOUDFLARE_PURGE_TOKEN unset. Purge ${url} by hand if the edge caches it.`);
        return;
    }
    // The token stays in this process: it is never an argument to anything.
    const result = await purgeCloudflareFiles([url], { zone, token });
    if (result.ok) say('edge cache purged for android/latest.json');
    else say('WARNING - the purge did not report success. The pointer IS written; confirm it through the edge.');
}

export async function run(argv) {
    let opts;
    try {
        opts = parseArgs(argv);
    } catch (e) {
        process.stderr.write(`android-pointer: ${e.message}\n\n${USAGE}`);
        return 2;
    }
    const { tag, target, publicBase, rehearsal, releaseRecord, dryRun } = opts;
    const version = tag.slice(1);
    const work = mkdtempSync(join(tmpdir(), 'xap-'));
    try {
        const rsync = resolveRsync(target);

        // The §6 record gate publish.sh applies to every production write.
        say('checking the §6 release record ...');
        if (!runTool(process.execPath, [join(HERE, 'release-record.mjs'), 'assert', '--tag', tag,
            ...(releaseRecord ? ['--record', releaseRecord] : [])])) {
            refuse('no instantiated §6 release record for this tag (see above).');
        }

        // This tool writes the production pointer; the staging feed takes it
        // from `publish.sh --staging` of the Android partial instead.
        if (targetExists(target, rsync, '.staging-feed')) {
            refuse(`${target} is the STAGING feed (.staging-feed is present); this tool writes only the production pointer.`);
        }

        // 1. The signed manifest, as served.
        const manifestUrl = `${publicBase}/RELEASE_HASHES/${tag}.txt`;
        say(`fetching the served manifest ${manifestUrl} (+ .asc) ...`);
        const manifest = await fetchServed(manifestUrl);
        const signature = await fetchServed(`${manifestUrl}.asc`);
        if (manifest.status !== 200 || signature.status !== 200) {
            refuse(`${tag} is not published: RELEASE_HASHES/${tag}.txt returned `
                + `${manifest.status || manifest.error}, its .asc ${signature.status || signature.error}. `
                + 'The pointer may only name a version whose signed manifest is already served.');
        }
        const manifestText = manifest.body.toString('utf8');
        writeFileSync(join(work, 'RELEASE_HASHES.txt'), manifest.body);
        writeFileSync(join(work, 'RELEASE_HASHES.txt.asc'), signature.body);
        if (headerField(manifestText, 'rehearsal-os')) refuse('the served manifest is a rehearsal manifest.');
        if (headerField(manifestText, 'dev-mock-gate') !== 'enforced') {
            refuse(`the served manifest records the dev-mock gate as '${headerField(manifestText, 'dev-mock-gate') || 'unrecorded'}', not 'enforced'.`);
        }
        const apks = apkRows(manifestText);
        if (apks.length === 0) refuse(`the served ${tag} manifest lists no .apk, so no direct-Android build exists to point at.`);

        // 2. Every APK it lists, as served, against that manifest.
        for (const { sha256: want, name } of apks) {
            const url = `${publicBase}/android/${encodeURIComponent(name)}`;
            say(`fetching ${url} ...`);
            const apk = await fetchServed(url);
            if (apk.status !== 200) refuse(`android/${name} is not served (HTTP ${apk.status || apk.error}).`);
            const got = sha256(apk.body);
            if (got !== want) {
                refuse(`android/${name} as served hashes to ${got}, but the signed manifest says ${want}.`);
            }
            writeFileSync(join(work, name), apk.body);
        }
        for (const { name } of apks) {
            say(`verifying ${name} against the served manifest and its signature ...`);
            if (!runTool('bash', [join(HERE, 'verify.sh'), '--input', work, '--tag', tag, '--artifact', name])) {
                refuse(`verify.sh refused ${name} or the served manifest's signature (see above).`);
            }
            if (!runTool(process.execPath, [join(HERE, 'verify-apk-play-protection.mjs'), join(work, name)])) {
                refuse(`${name} is not the ceremony's own build (see above).`);
            }
        }

        // 3. The rehearsal record bound to this served manifest.
        say('checking the §7.5 rehearsal record against the served manifest ...');
        if (!runTool(process.execPath, [join(HERE, 'rehearse.mjs'), 'assert',
            '--record', rehearsal, '--tag', tag, '--prod-input', work])) {
            refuse('the rehearsal record does not cover the served manifest (see above).');
        }

        // Never move the pointer backwards: older installs would stop hearing
        // about the newer release. A pointer already at this version is done.
        const current = await servedPointerVersion(publicBase);
        if (current === version) {
            say(`ok - ${FEED_REL} already names ${version}; nothing to write.`);
            return 0;
        }
        if (current && isNewer(current, version)) {
            refuse(`${FEED_REL} names ${current}, which is newer than ${version}; refusing to move it backwards.`);
        }

        say(`plan for ${tag} -> ${target}`);
        say(`  verified: ${apks.map((a) => a.name).join(', ')} against RELEASE_HASHES/${tag}.txt (served, signed)`);
        say(`  write ${FEED_REL}: ${current ?? '(none)'} -> ${version}, the only file written, last`);
        say('  purge it from the edge, then read it back through the public base');
        if (dryRun) {
            say('--dry-run, nothing written.');
            return 0;
        }

        // Same body and mode as publish.sh Phase 3b.
        const body = join(work, 'latest.json');
        writeFileSync(body, `{"version": "${version}"}\n`);
        chmodSync(body, 0o644);
        say(`uploading ${FEED_REL} naming ${version} (direct feed pointer, last)`);
        if (!copyToTarget(target, rsync, body, FEED_REL)) {
            say(`the upload of ${FEED_REL} to ${target} failed; check what the origin now holds before re-running.`);
            return 1;
        }
        await purge(publicBase);

        const served = await servedPointerVersion(publicBase);
        if (served !== version) {
            say(`${FEED_REL} was written, but the public base serves ${served ?? 'nothing readable'}, not ${version}.`);
            return 1;
        }
        say(`ok - ${publicBase}/${FEED_REL} names ${version}`);
        return 0;
    } catch (e) {
        if (!(e instanceof Refusal)) throw e;
        say(`REFUSED - ${e.message} Nothing was written.`);
        return 1;
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

if (isInvokedDirectly(import.meta.url)) {
    const argv = process.argv.slice(2);
    if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
        process.stdout.write(USAGE);
        process.exit(0);
    }
    process.exit(await run(argv));
}
