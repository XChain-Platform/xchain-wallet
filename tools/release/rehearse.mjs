// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/rehearse.mjs - the §7.5 staging rehearsal, driven and
// recorded ( stage 5).
//
// THE RULE THIS ENFORCES: "No release's yml goes to wallet/desktop/
// before its staging rehearsal passes." A rule with no artifact behind it
// is a rule that gets skipped on the one release that is running late, so
// this writes a RECORD and `publish.sh` refuses a production publish
// without one that matches the release in hand.
//
// WHAT IS ACTUALLY REHEARSED, AND WHAT CANNOT BE. An update has two
// halves and they fail in different places:
//
//   1. Resolve and prove.  Fetch the channel pointer for an OS/arch,
//      pick the artifact the way electron-updater picks it, download it,
//      check the sha512 the pointer claims, then run the REAL  S5
//      gate (`updateVerify.js`) over the bytes against the K1-signed
//      manifest on the same feed. Every step is a property of the FEED,
//      so all six lanes are checked from one machine, no hardware.
//
//   2. Install and swap.  Whether the downloaded artifact actually
//      replaces the running app. That needs the OS and the arch, so it
//      is attested by a human on a named device (`attest`), and DD4 is
//      the open question of which devices those are.
//
// Splitting them is what makes this useful before DD4 lands: the half
// that historically breaks - a pointer name nothing fetches, an arch
// resolving to the wrong installer, a manifest lookup aimed at the wrong
// feed - is the half that needs no hardware at all.
//
// THE SELECTION CHECK IS NOT DECORATION. Windows puts both arches in one
// `stable.yml` and upstream chooses between them by substring-matching
// `process.arch` against the filename, falling back to whichever file is
// listed FIRST when nothing matches (`findFile`, electron-updater 6.8.3).
// electron-builder omits the arch from x64 names by default, so under
// those defaults every x64 machine matches nothing and takes the first
// entry - correct only for as long as x64 happens to be built first.
// `electron-builder.config.cjs` names every artifact with its arch to
// close that; this re-checks the property on the PUBLISHED feed, which is
// the only place it matters.
//
// WHY NOT DRIVE electron-updater ITSELF. It needs a running Electron app
// (it reads `app.getVersion()`, the userData dir, and the packaged
// `app-update.yml`), so a headless harness cannot call it without faking
// exactly the environment the rehearsal exists to distrust. What this
// does instead is re-implement its selection rule from upstream source,
// pinned by a test that reads the installed copy, and run the parts that
// ARE ours (`updateVerify.js`) as the shipped code, not a copy.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { pointerNameFor } from './update-info.mjs';
import { LANES, laneById, lanesByOs, ALL_OS_TRIGGER_PATHS } from './rehearsal-matrix.mjs';

// fileURLToPath, not `new URL(...).pathname`: the latter leaves a path
// percent-encoded, so a checkout under a directory with a space in it
// resolves to a file that does not exist.
const HERE = dirname(fileURLToPath(import.meta.url));
const UPDATE_VERIFY = resolvePath(HERE, '../../packages/desktop/main/updateVerify.js');

export const RECORD_VERSION = 1;

// ------------------------------------------------------------ yml parsing

/**
 * Parse an electron-updater update-info file.
 *
 * Hand-rolled rather than pulling in js-yaml, for the same reason the
 * pnpm-parity audit hand-rolls its parser: a check that guards the
 * release path should not need the dependency tree it is guarding to be
 * installed correctly. The shape is fixed and narrow - electron-builder
 * writes it, nobody hand-edits it - so the parser only has to handle
 * that shape and must REFUSE anything else rather than guess.
 *
 * Note `sha512` here is BASE64, not hex: that is what app-builder-lib
 * writes and what electron-updater compares against.
 *
 * @param {string} text
 * @returns {{version: string, files: Array<{url: string, sha512: string, size: number|null}>, path: string|null}}
 */
export function parseUpdateInfo(text) {
    if (typeof text !== 'string' || !text.trim()) {
        throw new Error('update-info is empty');
    }
    const out = { version: '', files: [], path: null };
    let inFiles = false;
    let current = null;

    const push = () => {
        if (current) {
            if (!current.url) throw new Error('update-info file entry has no url');
            if (!current.sha512) throw new Error(`update-info entry ${current.url} has no sha512`);
            out.files.push(current);
        }
        current = null;
    };

    for (const raw of text.split('\n')) {
        const line = raw.replace(/\r$/, '');
        if (!line.trim()) continue;

        // A top-level key ends the files block. Checked before the
        // in-block branches so a malformed file cannot swallow the rest.
        const top = /^([A-Za-z0-9_]+):[ \t]*(.*)$/.exec(line);
        if (top) {
            push();
            inFiles = false;
            const [, key, value] = top;
            if (key === 'files') { inFiles = true; continue; }
            if (key === 'version') out.version = unquote(value);
            if (key === 'path') out.path = unquote(value);
            continue;
        }

        if (!inFiles) continue;

        const item = /^ +- +([A-Za-z0-9_]+):[ \t]*(.*)$/.exec(line);
        if (item) {
            push();
            current = { url: '', sha512: '', size: null };
            assign(current, item[1], unquote(item[2]));
            continue;
        }
        const cont = /^ +([A-Za-z0-9_]+):[ \t]*(.*)$/.exec(line);
        if (cont && current) {
            assign(current, cont[1], unquote(cont[2]));
            continue;
        }
    }
    push();

    if (!out.version) throw new Error('update-info has no version');
    // The `path`/`sha512` top-level pair is electron-builder's legacy
    // single-file form. getFileList() falls back to it when `files` is
    // absent, so a pointer with neither is not merely odd, it is one no
    // client can use.
    if (out.files.length === 0) throw new Error('update-info lists no files');
    return out;
}

function unquote(v) {
    return String(v ?? '').trim().replace(/^['"]|['"]$/g, '');
}

function assign(entry, key, value) {
    if (key === 'url') entry.url = value;
    else if (key === 'sha512') entry.sha512 = value;
    else if (key === 'size') entry.size = Number(value);
}

// --------------------------------------------------------- arch selection

/**
 * Which file an OS/arch resolves out of a pointer.
 *
 * A faithful re-implementation of `findFile` from electron-updater
 * 6.8.3 `out/providers/Provider.js`, including the part that matters:
 *
 *     filtered.find(f => f.url.includes(process.arch)) ?? filtered.shift()
 *
 * The fallback is the dangerous half. When no filename carries the
 * running arch, upstream silently takes the FIRST listed file, so an
 * x64 machine can be handed an arm64 installer with nothing logged
 * anywhere. `selection` reports which of the two branches fired so a
 * rehearsal can refuse the fallback rather than pass on a coin flip.
 *
 * `candidates` is reported because the fallback is only DANGEROUS when
 * there was a choice to get wrong. Linux gets one pointer per arch, so
 * its ymls list a single AppImage and taking the first is taking the only
 * one; Windows and macOS put both arches in one file, where the same
 * branch silently hands a machine the other architecture's installer.
 * Same upstream code path, opposite consequence, so the caller needs the
 * count to tell them apart.
 *
 * @param {Array<{url: string}>} files
 * @param {string} arch      a process.arch value
 * @param {string} extension the update-capable format for the lane
 * @returns {{file: {url: string}|null, selection: 'by-arch'|'first-listed'|'none', candidates: number}}
 */
export function selectFileForArch(files, arch, extension) {
    const filtered = files.filter(
        (f) => f.url.toLowerCase().endsWith(`.${String(extension).toLowerCase()}`),
    );
    if (filtered.length === 0) return { file: null, selection: 'none', candidates: 0 };
    const byArch = filtered.find((f) => f.url.includes(arch));
    if (byArch) return { file: byArch, selection: 'by-arch', candidates: filtered.length };
    return { file: filtered[0], selection: 'first-listed', candidates: filtered.length };
}

// ------------------------------------------------------------- the probe

/**
 * Run the feed-side half of a rehearsal for one lane.
 *
 * @param {Object} params
 * @param {import('./rehearsal-matrix.mjs').Lane} params.lane
 * @param {string} params.feedBase   e.g. https://downloads.xchain.io/wallet-staging/
 * @param {string} params.channel    the channel the rehearsal set was built for
 * @param {string} params.tag        vX.Y.Z
 * @param {typeof fetch} [params.fetch]
 * @param {Object} [params.pinned]   { armoredKey, fingerprint } override
 * @returns {Promise<Object>} the lane's record entry
 */
export async function probeLane({ lane, feedBase, channel, tag, fetch: fetchImpl, pinned }) {
    const doFetch = fetchImpl || globalThis.fetch;
    const base = String(feedBase).replace(/\/*$/, '/');
    const pointer = pointerNameFor({ channel, os: lane.os, arch: lane.arch });
    const entry = {
        id: lane.id,
        os: lane.os,
        arch: lane.arch,
        pointer,
        ok: false,
        checks: {},
    };

    const fail = (step, reason) => {
        entry.ok = false;
        entry.failed = step;
        entry.reason = reason;
        return entry;
    };

    // --- 1. the pointer exists and parses -------------------------------
    let info;
    try {
        const res = await doFetch(`${base}desktop/${encodeURIComponent(pointer)}`);
        if (!res?.ok) return fail('pointer', `HTTP ${res?.status ?? 'no response'} for ${pointer}`);
        info = parseUpdateInfo(await res.text());
    } catch (err) {
        return fail('pointer', String(err?.message || err));
    }
    entry.checks.pointer = 'ok';

    // --- 2. it names the version being rehearsed ------------------------
    const want = tag.replace(/^v/, '');
    if (info.version !== want) {
        return fail('version', `pointer says ${info.version}, rehearsing ${want}`);
    }
    entry.checks.version = info.version;

    // --- 3. selection resolves BY NAME, not by list order ---------------
    const { file, selection, candidates } = selectFileForArch(info.files, lane.arch, lane.format);
    if (!file) {
        return fail('selection', `pointer lists no .${lane.format} for ${lane.id}`);
    }
    entry.selected = file.url;
    entry.checks.selection = selection;
    entry.checks.candidates = candidates;
    if (selection === 'first-listed' && candidates > 1) {
        // Not "probably fine". With more than one candidate, which
        // installer this lane receives is decided by the order
        // electron-builder happened to write the files in, and nothing
        // anywhere pins that order.
        return fail(
            'selection',
            `${lane.arch} matched no filename and fell back to the first of ${candidates} `
            + `listed .${lane.format} files (${file.url}). electron-updater would hand this `
            + 'machine that artifact whatever arch it is. Artifact names must carry their arch.',
        );
    }

    // --- 4. the bytes are there and are the bytes the pointer claims ----
    let bytes;
    try {
        const res = await doFetch(`${base}desktop/${encodeURIComponent(file.url)}`);
        if (!res?.ok) return fail('download', `HTTP ${res?.status ?? 'no response'} for ${file.url}`);
        bytes = Buffer.from(await res.arrayBuffer());
    } catch (err) {
        return fail('download', String(err?.message || err));
    }
    const sha512 = createHash('sha512').update(bytes).digest('base64');
    if (sha512 !== file.sha512) {
        return fail('sha512', `${file.url} does not match the sha512 in ${pointer}`);
    }
    if (file.size != null && Number.isFinite(file.size) && file.size !== bytes.length) {
        return fail('size', `${file.url} is ${bytes.length} bytes, pointer says ${file.size}`);
    }
    entry.checks.sha512 = 'ok';
    entry.checks.bytes = bytes.length;

    // --- 5. the SHIPPED S5 gate, over the real bytes --------------------
    //
    // Imported, not reimplemented. This is the code the installed wallet
    // runs between download and install, and the stage-3 seam - a staging
    // build fetching its proof from the production feed - was invisible
    // precisely because nothing ever ran it against a staging feed.
    const { fetchReleaseManifest, verifyDownloadedUpdate } = await import(
        pathToFileURL(UPDATE_VERIFY).href
    );
    const fetched = await fetchReleaseManifest({ feedBaseUrl: base, tag, fetch: doFetch });
    if (!fetched.ok) return fail('manifest', fetched.reason);

    const verdict = await verifyDownloadedUpdate({
        manifestBytes: fetched.manifestBytes,
        armoredSignature: fetched.armoredSignature,
        expectedTag: tag,
        artifactPath: file.url,
        artifactSha256: createHash('sha256').update(bytes).digest('hex'),
        ...(pinned === undefined ? {} : { pinned }),
    });
    if (!verdict.ok) return fail('verify', verdict.reason);
    entry.checks.signedManifest = 'ok';

    entry.ok = true;
    return entry;
}

// ------------------------------------------------- per-release requirement

/**
 * How many OSes must show a real swap for THIS release (§7.5).
 *
 * @param {Object} params
 * @param {string} params.repo
 * @param {string} params.tag
 * @param {string|null} params.previousTag
 * @returns {{requirement: 'one-os'|'all-os'|'bootstrap', reason: string, paths?: string[]}}
 */
export function swapRequirement({ repo, tag, previousTag, run = gitRun }) {
    if (!previousTag) {
        return {
            requirement: 'bootstrap',
            reason: 'no previous release: there is no earlier staging build to update FROM, '
                + 'so no swap can be performed. The feed-side probes still run.',
        };
    }
    let changed = [];
    try {
        changed = run(repo, ['diff', '--name-only', `${previousTag}..${tag}`])
            .split('\n').map((s) => s.trim()).filter(Boolean);
    } catch (err) {
        // Cannot tell => assume the expensive answer. The cheap answer is
        // the one that ships an unrehearsed swap to two thirds of the fleet.
        return {
            requirement: 'all-os',
            reason: `could not diff ${previousTag}..${tag} (${String(err?.message || err)}); `
                + 'defaulting to the strict requirement',
        };
    }
    const hits = changed.filter((f) => ALL_OS_TRIGGER_PATHS.some(
        (p) => (p.endsWith('/') ? f.startsWith(p) : f === p),
    ));
    if (hits.length > 0) {
        return {
            requirement: 'all-os',
            reason: `this release touches updater / vault / release-path code`,
            paths: hits,
        };
    }
    return { requirement: 'one-os', reason: 'no updater, vault or release-path files changed' };
}

function gitRun(repo, args) {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

// ------------------------------------------------------------- the record

/**
 * Check a record against the release actually in hand.
 *
 * Called by publish.sh before a PRODUCTION publish. Every check here
 * exists to stop one specific way a record can be true of something
 * other than this release.
 *
 * @param {Object} params
 * @param {Object} params.record
 * @param {string} params.tag
 * @param {string} params.prodManifestSha256
 * @returns {{ok: boolean, problems: string[]}}
 */
export function assertRecord({ record, tag, prodManifestSha256 }) {
    const problems = [];

    if (!record || record['record-version'] !== RECORD_VERSION) {
        return { ok: false, problems: [`record-version is not ${RECORD_VERSION}`] };
    }
    if (record.tag !== tag) {
        problems.push(`record is for ${record.tag}, publishing ${tag}`);
    }

    // THE BINDING THAT MAKES A RECORD UNREUSABLE. A rehearsal proves
    // something about a specific set of signed bytes. Re-cutting a
    // release under the same tag (a rebuild after a failed lane, say)
    // produces a different manifest, and without this the old record
    // would still read as green for bytes nobody rehearsed.
    if (record['prod-manifest-sha256'] !== prodManifestSha256) {
        problems.push(
            'the record was made against a different production manifest '
            + `(recorded ${short(record['prod-manifest-sha256'])}, in hand ${short(prodManifestSha256)}). `
            + 'Re-rehearse: these are not the bytes that were rehearsed.',
        );
    }

    // A rehearsal run against a key the shipped app does not pin proves
    // the plumbing and nothing about trust.
    if (record['pinned-key-override']) {
        problems.push(
            'the rehearsal used a pinned-key override, so the K1 path it '
            + 'exercised is not the one the shipped app uses',
        );
    }

    const lanes = Array.isArray(record.lanes) ? record.lanes : [];
    const missing = LANES.filter((l) => !lanes.some((r) => r.id === l.id));
    if (missing.length) {
        problems.push(`no result for lane(s): ${missing.map((l) => l.id).join(', ')}`);
    }
    for (const lane of lanes) {
        if (!lane.ok) problems.push(`lane ${lane.id} failed at ${lane.failed}: ${lane.reason}`);
    }

    // The swap half.
    const swaps = Array.isArray(record.swaps) ? record.swaps : [];
    const swappedOs = new Set(
        swaps.map((s) => laneById(s.lane)?.os).filter(Boolean),
    );
    const requirement = record['swap-requirement'];
    if (requirement === 'all-os') {
        for (const os of lanesByOs().keys()) {
            if (!swappedOs.has(os)) {
                problems.push(
                    `this release requires an observed swap on every OS (${record['requirement-reason']}), `
                    + `and ${os} has none`,
                );
            }
        }
    } else if (requirement === 'one-os') {
        if (swappedOs.size === 0) {
            problems.push('no observed swap on any OS; §7.5 requires at least one per release');
        }
    } else if (requirement !== 'bootstrap') {
        problems.push(`unknown swap-requirement "${requirement}"`);
    }

    return { ok: problems.length === 0, problems };
}

function short(v) {
    return String(v ?? '(none)').slice(0, 12);
}

// ------------------------------------------------------------------- CLI

const USAGE = `usage: rehearse.mjs <command> [args]

  run --feed <url> --tag <vX.Y.Z> --channel <name> --prod-input <dir>
      [--repo <dir>] [--previous-tag <vX.Y.Z>] [--out <file>]
      [--pinned-key <file> --pinned-fingerprint <hex>] [--lane <id>]...
      Probe every shipped lane against the staging feed and write the
      rehearsal record. Exits 1 if any lane fails.

  attest --record <file> --lane <id> --from <version> --by <name>
      Record that a human watched the update install and swap on that
      lane's named device. Refuses a lane DD4 has not named a device for.

  assert --record <file> --tag <vX.Y.Z> --prod-input <dir>
      Check a record covers the release in hand. This is the gate
      publish.sh runs; exits 1 with the reasons.

  requirement --repo <dir> --tag <vX.Y.Z> [--previous-tag <vX.Y.Z>]
      Print whether this release needs a swap on one OS or on all of
      them, and why.

  coverage [--records <dir>]
      Which lanes have ever had an observed swap, and which are still
      blocked on DD4 hardware. Exits 1 if any shipped lane has never
      been swapped - the §7.5 pre-launch condition.
`;

function fail(msg) {
    process.stderr.write(`rehearse.mjs: ${msg}\n`);
    process.exit(1);
}

function flag(argv, name) {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
}

function flags(argv, name) {
    const out = [];
    argv.forEach((a, i) => { if (a === name) out.push(argv[i + 1]); });
    return out;
}

/** `previousTagOf`, with its ambiguous cases turned into a hard stop. */
function resolvePrevious(repo, tag) {
    try {
        return previousTagOf(repo, tag);
    } catch (err) {
        return fail(String(err?.message || err));
    }
}

function manifestSha(prodInput) {
    const path = join(prodInput, 'RELEASE_HASHES.txt');
    if (!existsSync(path)) {
        fail(`${path} does not exist. Sign the production release first: a rehearsal\n`
            + '  record is bound to the manifest it was made against, so there has to\n'
            + '  be one. Order is sign prod -> sign staging -> rehearse -> publish prod.');
    }
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function main(argv) {
    const command = argv[0];
    if (!command || command === '--help' || command === '-h') {
        process.stdout.write(USAGE);
        return 0;
    }

    if (command === 'requirement') {
        const repo = flag(argv, '--repo') || process.cwd();
        const tag = flag(argv, '--tag') || fail('requirement needs --tag');
        const previousTag = flag(argv, '--previous-tag') ?? resolvePrevious(repo, tag);
        const r = swapRequirement({ repo, tag, previousTag });
        process.stdout.write(`${r.requirement}\n${r.reason}\n`);
        if (r.paths) for (const p of r.paths) process.stdout.write(`  ${p}\n`);
        return 0;
    }

    if (command === 'run') {
        const feed = flag(argv, '--feed') || fail('run needs --feed <url>');
        const tag = flag(argv, '--tag') || fail('run needs --tag');
        const channel = flag(argv, '--channel') || 'staging';
        const prodInput = flag(argv, '--prod-input') || fail('run needs --prod-input <dir>');
        const repo = flag(argv, '--repo') || process.cwd();
        const only = flags(argv, '--lane');
        const out = flag(argv, '--out') || join(prodInput, '..', `REHEARSAL-${tag}.json`);

        const keyFile = flag(argv, '--pinned-key');
        let pinned;
        if (keyFile) {
            pinned = {
                armoredKey: readFileSync(keyFile, 'utf8'),
                fingerprint: flag(argv, '--pinned-fingerprint') || '',
            };
            process.stderr.write(
                'rehearse.mjs: WARNING - using a pinned-key override. This exercises the\n'
                + '  plumbing but NOT the key the shipped app trusts, and `assert` will\n'
                + '  refuse the resulting record for a production publish.\n',
            );
        }

        const previousTag = flag(argv, '--previous-tag') ?? resolvePrevious(repo, tag);
        const requirement = swapRequirement({ repo, tag, previousTag });

        const lanes = [];
        for (const lane of LANES) {
            if (only.length && !only.includes(lane.id)) continue;
            process.stderr.write(`rehearse.mjs: ${lane.id} ... `);
            const entry = await probeLane({ lane, feedBase: feed, channel, tag, pinned });
            lanes.push(entry);
            process.stderr.write(entry.ok ? 'ok\n' : `FAIL (${entry.failed}: ${entry.reason})\n`);
        }

        const record = {
            'record-version': RECORD_VERSION,
            tag,
            'staging-feed': feed,
            channel,
            'prod-manifest-sha256': manifestSha(prodInput),
            'previous-tag': previousTag,
            'swap-requirement': requirement.requirement,
            'requirement-reason': requirement.reason,
            'requirement-paths': requirement.paths ?? [],
            'pinned-key-override': pinned ? { fingerprint: pinned.fingerprint } : null,
            'generated-at': new Date().toISOString(),
            lanes,
            swaps: [],
        };
        await writeFile(out, `${JSON.stringify(record, null, 2)}\n`);
        process.stderr.write(`rehearse.mjs: record written to ${out}\n`);

        const bad = lanes.filter((l) => !l.ok);
        if (bad.length) {
            process.stderr.write(`rehearse.mjs: ${bad.length} lane(s) failed; nothing may be published.\n`);
            return 1;
        }
        if (requirement.requirement !== 'bootstrap') {
            process.stderr.write(
                `rehearse.mjs: feed-side checks pass. Still required: an observed swap on `
                + `${requirement.requirement === 'all-os' ? 'EVERY OS' : 'at least one OS'} `
                + `(${requirement.reason}).\n  Record each with: rehearse.mjs attest --record ${out} --lane <id> ...\n`,
            );
        }
        return 0;
    }

    if (command === 'attest') {
        const file = flag(argv, '--record') || fail('attest needs --record <file>');
        const laneId = flag(argv, '--lane') || fail('attest needs --lane <id>');
        const from = flag(argv, '--from') || fail('attest needs --from <version installed before the swap>');
        const by = flag(argv, '--by') || fail('attest needs --by <who watched it>');

        const lane = laneById(laneId);
        if (!lane) fail(`unknown lane "${laneId}"`);
        if (!lane.device) {
            fail(`lane ${laneId} has no named smoke device (DD4 is unanswered for it).\n`
                + '  Attesting a swap without saying what it ran on is the thing DD4\n'
                + '  exists to prevent: "no named device for a lane = that lane does not\n'
                + '  ship". Name the device in tools/release/rehearsal-matrix.mjs first.');
        }
        const record = JSON.parse(readFileSync(file, 'utf8'));
        const laneResult = (record.lanes || []).find((l) => l.id === laneId);
        if (!laneResult?.ok) {
            fail(`lane ${laneId} did not pass its feed-side probe, so there is nothing\n`
                + '  a swap on it would prove. Fix the probe failure and re-run.');
        }
        record.swaps = record.swaps || [];
        record.swaps.push({
            lane: laneId,
            device: lane.device,
            from,
            to: String(record.tag).replace(/^v/, ''),
            'attested-by': by,
            at: new Date().toISOString(),
        });
        writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
        process.stdout.write(`ok   swap attested on ${laneId} (${lane.device}), ${from} -> ${record.tag}\n`);
        return 0;
    }

    if (command === 'assert') {
        const file = flag(argv, '--record') || fail('assert needs --record <file>');
        const tag = flag(argv, '--tag') || fail('assert needs --tag');
        const prodInput = flag(argv, '--prod-input') || fail('assert needs --prod-input <dir>');
        if (!existsSync(file)) {
            fail(`no rehearsal record at ${file}.\n`
                + '  No release publishes to the live feed before its staging rehearsal\n'
                + '  passes (§7.5). Run: rehearse.mjs run --feed <staging> --tag ' + tag);
        }
        let record;
        try {
            record = JSON.parse(readFileSync(file, 'utf8'));
        } catch (err) {
            fail(`${file} is not readable JSON: ${String(err?.message || err)}`);
        }
        const { ok, problems } = assertRecord({
            record, tag, prodManifestSha256: manifestSha(prodInput),
        });
        if (!ok) {
            process.stderr.write(`rehearse.mjs: the rehearsal record does not cover this release.\n`);
            for (const p of problems) process.stderr.write(`  - ${p}\n`);
            return 1;
        }
        const swaps = record.swaps.map((s) => `${s.lane} on ${s.device}`).join(', ');
        process.stdout.write(
            `ok   rehearsal ${record.tag}: ${record.lanes.length} lane(s) probed, `
            + `requirement ${record['swap-requirement']}`
            + `${swaps ? `, swap observed: ${swaps}` : ''}\n`,
        );
        return 0;
    }

    if (command === 'coverage') {
        const dir = flag(argv, '--records') || 'release-artifacts';
        const seen = new Map();
        if (existsSync(dir)) {
            for (const name of readdirSync(dir)) {
                if (!/^REHEARSAL-.*\.json$/.test(name)) continue;
                let record;
                try { record = JSON.parse(readFileSync(join(dir, name), 'utf8')); } catch { continue; }
                for (const swap of record.swaps || []) {
                    seen.set(swap.lane, { tag: record.tag, device: swap.device, at: swap.at });
                }
            }
        }
        let blocked = 0;
        for (const lane of LANES) {
            const hit = seen.get(lane.id);
            if (hit) {
                process.stdout.write(`✅ ${lane.id.padEnd(12)} swapped at ${hit.tag} on ${hit.device}\n`);
            } else {
                blocked += 1;
                const why = lane.device ? `device ${lane.device}, never rehearsed` : 'NO DEVICE NAMED (DD4)';
                process.stdout.write(`⬜ ${lane.id.padEnd(12)} ${why}\n`);
            }
        }
        if (blocked) {
            process.stdout.write(
                `\n${blocked} lane(s) have never had an observed swap. §7.5 requires every\n`
                + 'shipped OS/arch to be rehearsed at least once before launch, and DD4\n'
                + 'says a lane with no named device does not ship.\n',
            );
            return 1;
        }
        return 0;
    }

    fail(`unknown command "${command}"\n\n${USAGE}`);
    return 1;
}

/**
 * The tag before this one, by version order, or null if this really is
 * the first release.
 *
 * THROWS rather than returning null when it cannot tell, and that
 * distinction is load-bearing. A null answer means `bootstrap`, and
 * `bootstrap` WAIVES the swap requirement entirely - correctly, because
 * a first release has no earlier build to update from. But every other
 * reason this function could come back empty (the tag has not been
 * created yet, the rehearsal is being run from a checkout that has no
 * tags fetched, git is not available) would silently claim that same
 * waiver for a release that simply has not been rehearsed. Found by
 * running the CLI against this repo before the first tag existed: the
 * ambiguous case and the legitimate case were indistinguishable in the
 * output, and the ambiguous one is the common one.
 *
 * A caller who genuinely knows better passes `--previous-tag`.
 */
function previousTagOf(repo, tag) {
    let tags;
    try {
        tags = gitRun(repo, ['tag', '--list', 'v*', '--sort=-v:refname'])
            .split('\n').map((s) => s.trim()).filter(Boolean);
    } catch (err) {
        throw new Error(
            `cannot list tags in ${repo} (${String(err?.message || err)}). Pass `
            + '--previous-tag explicitly; guessing here would waive the swap requirement.',
        );
    }
    if (tags.length === 0) return null;
    const i = tags.indexOf(tag);
    if (i === -1) {
        throw new Error(
            `${tag} is not a tag in ${repo}, but ${tags.length} other v* tag(s) are.\n`
            + '  This is not the first release, so treating it as one would waive the\n'
            + '  swap requirement for a release nobody has rehearsed. Tag the commit\n'
            + '  first (§6 step 2), or pass --previous-tag if you know better.',
        );
    }
    return tags[i + 1] ?? null;
}

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
