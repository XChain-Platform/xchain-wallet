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
// recorded (stage 5).
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
//      check the sha512 the pointer claims, then run the REAL S5
//      gate (`updateVerify.js`) over the bytes against the K1-signed
//      manifest on the same feed. Every step is a property of the FEED,
//      so all eight lanes are checked from one machine, no hardware.
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
// listed FIRST when nothing matches (`findFile`, electron-updater 6.8.9).
// electron-builder omits the arch from x64 names by default, so under
// those defaults every x64 machine matches nothing and takes the first
// entry - correct only for as long as x64 happens to be built first.
// `electron-builder.config.cjs` names every artifact with its arch to
// close that; this re-checks the property on the PUBLISHED feed, which is
// the only place it matters.
//
// THE DIRECT ANDROID LANE IS REHEARSED HERE TOO, by a different probe.
// Its feed is a one-field `latest.json`, nothing is downloaded
// by the app, and the install is performed by the user, so `probeLane`
// above describes none of it. `probeDirectLane` drives the SHIPPED client
// against the feed in both directions and proves the APK the resulting
// notice sends a user to is the one K1 signed. Its third half, whether an
// APK installs OVER its predecessor, is hardware-bound like the desktop
// swap and blocked on the same kind of open question (DD-A).
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
import {
    LANES, DIRECT_LANES, laneById, lanesByOs, ALL_OS_TRIGGER_PATHS,
} from './rehearsal-matrix.mjs';

// fileURLToPath, not `new URL(...).pathname`: the latter leaves a path
// percent-encoded, so a checkout under a directory with a space in it
// resolves to a file that does not exist.
const HERE = dirname(fileURLToPath(import.meta.url));
const UPDATE_VERIFY = resolvePath(HERE, '../../packages/desktop/main/updateVerify.js');
const WALLET_ROOT = resolvePath(HERE, '../..');

export const RECORD_VERSION = 1;

// ------------------------------------------------- the automated swap check
//
// A SECOND KIND OF EVIDENCE, DELIBERATELY NOT THE FIRST. A hosted
// `windows-latest` runner is a free NATIVE x64 Windows machine, which is
// the silicon the largest desktop audience actually has and the one the
// DD4 device for `win-x64` (a Parallels VM on an M3 Ultra) emulates. It
// is worth running the install/update/swap there. It is NOT an
// attestation, and the distinction is the whole point:
//
//   attestation      a person watched the running app be replaced on a
//                    NAMED DEVICE and put their name to it (`attest`,
//                    which demands `--by`). §7.5 requires this per
//                    release, and nothing here weakens it.
//
//   automated check  a machine performed the same swap and reported what
//                    it observed (`check`, which demands `--runner` and
//                    REFUSES `--by`). It can fail a release. It can never
//                    satisfy the swap requirement, because a job that
//                    signs its own homework is the witness removed rather
//                    than the witness automated.
//
// So checks live in their own array, never in `swaps`; they never enter
// the per-OS swap tally; a FAILING check is a release problem; and a
// passing one is reported as a NOTE that names the human half still
// owing. `attest` additionally refuses to run inside CI, because the
// cheapest way to hollow this out is a job calling `attest --by
// "github-actions"`.
export const SWAP_CHECK_VERSION = 1;

/** Result values a check may report. `error` is a check that could not run. */
export const SWAP_CHECK_RESULTS = ['pass', 'fail', 'error'];

/**
 * Validate one automated swap-check result.
 *
 * Written as a shared function rather than as CLI argument parsing
 * because the producer (the drill, on the runner) and the consumer (this
 * tool, on the release machine) are different processes on different
 * operating systems, and the file travels between them as a CI artifact.
 * The refusals below are what stops that file from arriving as, or being
 * edited into, something that reads as a human attestation.
 *
 * @param {any} result
 * @returns {{ok: boolean, reason?: string}}
 */
export function validateSwapCheck(result) {
    if (!result || typeof result !== 'object') return { ok: false, reason: 'not an object' };
    if (result['check-version'] !== SWAP_CHECK_VERSION) {
        return { ok: false, reason: `check-version is not ${SWAP_CHECK_VERSION}` };
    }
    if (result.kind !== 'automated-swap-check') {
        return { ok: false, reason: `kind is "${result.kind}", not "automated-swap-check"` };
    }
    const lane = laneById(result.lane);
    if (!lane) return { ok: false, reason: `unknown lane "${result.lane}"` };
    if (!String(result.runner || '').trim()) {
        return { ok: false, reason: 'no runner named. A machine result that does not say what '
            + 'machine produced it is the same unlocated claim `attest` refuses.' };
    }
    if (!SWAP_CHECK_RESULTS.includes(result.result)) {
        return { ok: false, reason: `result is "${result.result}", not one of ${SWAP_CHECK_RESULTS.join('/')}` };
    }
    // The two fields that would turn a machine's report into a person's.
    // `device` is DD4 vocabulary and `attested-by` is `attest`'s: either
    // one present means somebody is filing CI output as the human half.
    for (const forbidden of ['attested-by', 'device', 'witness']) {
        if (result[forbidden] != null) {
            return { ok: false, reason: `carries "${forbidden}". An automated check names a RUNNER `
                + 'and never a witness or a DD4 device: whether the running app was replaced is an '
                + 'OS-level fact a person attests to, and a record that lets a job claim it has '
                + 'removed the control rather than automated it.' };
        }
    }
    if (!String(result.from || '').trim() || !String(result.to || '').trim()) {
        return { ok: false, reason: 'a swap check must say which version it updated FROM and TO' };
    }
    if (result.from === result.to) {
        return { ok: false, reason: `from and to are both ${result.from}: nothing was swapped` };
    }
    return { ok: true };
}

/**
 * Compose a check result. Used by the drill so the shape is produced in
 * one place and validated in another, rather than hand-built at both ends.
 *
 * @param {Object} params
 * @returns {Object}
 */
export function makeSwapCheck({
    lane, from, to, result, runner, silicon = null, observed = {}, notes = [], at = null,
}) {
    return {
        'check-version': SWAP_CHECK_VERSION,
        kind: 'automated-swap-check',
        lane,
        from,
        to,
        result,
        runner,
        // Recorded because it is the reason this check exists: the DD4
        // device for win-x64 runs that arch under emulation, and a check
        // whose own silicon is unstated cannot answer that.
        silicon,
        observed,
        notes,
        at: at || new Date().toISOString(),
    };
}

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
 * 6.8.9 `out/providers/Provider.js`, including the part that matters:
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
    //
    // The raw text is kept, not just the parse. The shipped gate anchors
    // the pointer against the signed manifest, and handing it a
    // re-serialisation of our own parse would rehearse this harness
    // instead of the wallet.
    let info;
    let pointerText;
    try {
        const res = await doFetch(`${base}desktop/${encodeURIComponent(pointer)}`);
        if (!res?.ok) return fail('pointer', `HTTP ${res?.status ?? 'no response'} for ${pointer}`);
        pointerText = await res.text();
        info = parseUpdateInfo(pointerText);
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
        artifactSha512: createHash('sha512').update(bytes).digest('hex'),
        pointerText,
        ...(pinned === undefined ? {} : { pinned }),
    });
    if (!verdict.ok) return fail('verify', verdict.reason);
    entry.checks.signedManifest = 'ok';

    entry.ok = true;
    return entry;
}

// -------------------------------------------------- the direct-lane probe

/**
 * An in-memory stand-in for the client's `localStorage`.
 *
 * A fresh one per direction, so the prefs one check writes cannot decide
 * the next one's answer. `force` skips the interval but not the opt-out,
 * and sharing a store would make the ORDER of the directions below
 * load-bearing, which is the kind of coupling a rehearsal must not have.
 */
function memoryStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        clear: () => map.clear(),
    };
}

/**
 * Run the feed-side halves of a rehearsal for one DIRECT lane.
 *
 * The desktop probe re-implements electron-updater's selection rule
 * because upstream cannot be driven headlessly. The direct lane has the
 * opposite property and this takes advantage of it: the client is our
 * own module, it takes its `fetch` and its `storage` as arguments, and
 * it is the same file that ships inside the APK. So nothing here is a
 * re-implementation. The shipped `checkForDirectUpdate` is imported and
 * RUN, against the real published feed, and what is recorded is what a
 * phone would have been told.
 *
 * The client hard-codes its production feed URL, deliberately (a wallet
 * that takes its update endpoint from configuration has a remote
 * kill-switch). That is turned into a check rather than an obstacle: the
 * injected fetch REFUSES any URL but the one the client asks for, and
 * only then maps it onto the feed being rehearsed. A release that
 * publishes `latest.json` somewhere the shipped client does not read
 * fails here, which is the one defect no amount of looking at the feed
 * by hand would catch.
 *
 * @param {Object} params
 * @param {import('./rehearsal-matrix.mjs').DirectLane} params.lane
 * @param {string} params.feedBase          e.g. https://downloads.xchain.io/wallet/
 * @param {string} params.tag               vX.Y.Z
 * @param {string|null} [params.previousVersion]  the version an old install reports
 * @param {typeof fetch} [params.fetch]
 * @param {Object} [params.pinned]          { armoredKey, fingerprint } override
 * @returns {Promise<Object>} the lane's record entry
 */
export async function probeDirectLane({
    lane, feedBase, tag, previousVersion = null, fetch: fetchImpl, pinned,
}) {
    const doFetch = fetchImpl || globalThis.fetch;
    const base = String(feedBase).replace(/\/*$/, '/');
    const entry = {
        id: lane.id,
        os: lane.os,
        arch: lane.arch,
        feed: lane.feed,
        ok: false,
        checks: {},
    };
    const fail = (step, reason) => {
        entry.ok = false;
        entry.failed = step;
        entry.reason = reason;
        return entry;
    };

    const client = await import(
        pathToFileURL(resolvePath(WALLET_ROOT, lane.client)).href
    );

    const feedUrl = String(client.UPDATE_FEED_URL || '');
    let feedPath;
    try {
        feedPath = new URL(feedUrl).pathname.replace(/^\/+/, '');
    } catch {
        return fail('client-feed-url', `${lane.client} exports no usable UPDATE_FEED_URL`);
    }
    if (!feedPath.endsWith(lane.feed)) {
        return fail(
            'client-feed-url',
            `the shipped client reads ${feedUrl}, but this lane publishes ${lane.feed}. `
            + 'One of the two moved and the other did not, and every direct install would '
            + 'read the wrong path (or a 404) forever.',
        );
    }
    entry.checks.clientFeedUrl = feedUrl;

    // The URL the client asks for is checked here, not assumed: this is the
    // only place the shipped constant and the published path are compared
    // against each other rather than against a memory of each other.
    let requested = 0;
    const clientFetch = async (url, init) => {
        requested += 1;
        if (String(url) !== feedUrl) {
            throw new Error(`the client asked for ${String(url)}, not its own feed URL`);
        }
        return doFetch(`${base}${lane.feed}`, init);
    };

    let published;
    try {
        const res = await doFetch(`${base}${lane.feed}`);
        if (!res?.ok) return fail('feed', `HTTP ${res?.status ?? 'no response'} for ${lane.feed}`);
        const text = await res.text();
        // The client refuses a body over its own cap and returns null, which
        // is indistinguishable from being offline. Checked separately so an
        // oversized feed reads as "the feed is wrong", not "no notice today".
        if (text.length > client.UPDATE_FEED_MAX_BYTES) {
            return fail('feed', `${lane.feed} is ${text.length} bytes; the shipped client `
                + `reads at most ${client.UPDATE_FEED_MAX_BYTES} and would ignore it silently`);
        }
        published = client.parseUpdateFeed(JSON.parse(text));
    } catch (err) {
        return fail('feed', String(err?.message || err));
    }
    entry.checks.feed = 'ok';

    const want = tag.replace(/^v/, '');
    if (published !== want) {
        return fail('version', `${lane.feed} says ${published}, rehearsing ${want}`);
    }
    entry.checks.version = published;

    // Direction 1: an install already on this release must be told NOTHING.
    // A notice here would be a wallet nagging every user on the current
    // version to go and re-download it, which is both useless and exactly
    // the shape a download-something-now phishing prompt takes.
    try {
        const same = await client.checkForDirectUpdate({
            currentVersion: want, fetchImpl: clientFetch, storage: memoryStorage(), force: true,
        });
        if (same !== null) {
            return fail('direction-current', `an install on ${want} was offered `
                + `${JSON.stringify(same)}; a current install must get null`);
        }
    } catch (err) {
        return fail('direction-current', String(err?.message || err));
    }
    entry.checks.currentInstall = 'silent';

    // Direction 2: an install on the previous release must be told about
    // this one, by name, in text this process composed.
    if (previousVersion) {
        try {
            const older = await client.checkForDirectUpdate({
                currentVersion: previousVersion,
                fetchImpl: clientFetch,
                storage: memoryStorage(),
                force: true,
            });
            if (!older) {
                return fail('direction-previous', `an install on ${previousVersion} was `
                    + `offered nothing, with ${want} on the feed`);
            }
            if (older.version !== want) {
                return fail('direction-previous', `the notice names ${older.version}, not ${want}`);
            }
            // Byte-for-byte against the local composer. The feed is untrusted
            // input into a wallet UI, and "no feed bytes are rendered" is the
            // property that keeps an update notice from becoming a phishing
            // surface. It is worth re-checking against the LIVE feed and not
            // only in a unit test with a fixture body.
            if (older.notice !== client.updateNoticeText(want)) {
                return fail('direction-previous', 'the notice text is not the one composed '
                    + 'locally from the version number, so something from the feed reached it');
            }
            entry.checks.previousInstall = older.version;
            entry.checks.notice = older.notice;
        } catch (err) {
            return fail('direction-previous', String(err?.message || err));
        }
    } else {
        entry.checks.previousInstall = 'skipped: no previous release to notify';
    }

    // Direction 3: an install AHEAD of the feed is told nothing either. A
    // wallet that announces an older version as "available" is telling its
    // user to downgrade past a fix, and the comparison that prevents it is
    // numeric per field, which is exactly the comparison a string compare
    // gets wrong at 0.9.0 -> 0.10.0.
    try {
        const ahead = bumpMinor(want);
        const newer = await client.checkForDirectUpdate({
            currentVersion: ahead, fetchImpl: clientFetch, storage: memoryStorage(), force: true,
        });
        if (newer !== null) {
            return fail('direction-newer', `an install on ${ahead} was offered ${want}`);
        }
        entry.checks.aheadInstall = 'silent';
    } catch (err) {
        return fail('direction-newer', String(err?.message || err));
    }

    entry.checks.feedRequests = requested;

    // The notice sends a user to download the APK by hand. If that file is
    // not there, or is not the one K1 signed for this tag, the notice is an
    // instruction to nowhere and the fingerprint step it tells them to do
    // cannot succeed. Same shipped gate the desktop lanes run, over the
    // artifact a person would fetch rather than one an updater would.
    //
    // The ARTIFACT half by name, because this lane has no channel pointer
    // to anchor: the direct APK lane is not electron-updater,
    // nothing emits a `<channel>*.yml` for it, and Android re-checks the
    // package signature at install. Asking for the weaker gate explicitly
    // is the point - the desktop entry point demands a pointer, so no
    // desktop caller can land here by leaving an argument out.
    const { fetchReleaseManifest, parseManifest, verifyDownloadedArtifact } = await import(
        pathToFileURL(UPDATE_VERIFY).href
    );
    const fetched = await fetchReleaseManifest({ feedBaseUrl: base, tag, fetch: doFetch });
    if (!fetched.ok) return fail('manifest', fetched.reason);

    const parsed = parseManifest(Buffer.from(fetched.manifestBytes).toString('utf8'));
    if (!parsed.ok) return fail('manifest', parsed.reason);
    const apks = [...parsed.entries.keys()].filter((n) => n.toLowerCase().endsWith('.apk'));
    if (apks.length !== 1) {
        return fail('artifact', `the signed manifest for ${tag} covers ${apks.length} .apk `
            + 'files; the direct lane is exactly one universal APK');
    }
    const apk = apks[0];
    entry.selected = apk;

    let bytes;
    try {
        const res = await doFetch(`${base}android/${encodeURIComponent(apk)}`);
        if (!res?.ok) return fail('download', `HTTP ${res?.status ?? 'no response'} for ${apk}`);
        bytes = Buffer.from(await res.arrayBuffer());
    } catch (err) {
        return fail('download', String(err?.message || err));
    }
    entry.checks.bytes = bytes.length;

    const verdict = await verifyDownloadedArtifact({
        manifestBytes: fetched.manifestBytes,
        armoredSignature: fetched.armoredSignature,
        expectedTag: tag,
        artifactPath: apk,
        artifactSha256: createHash('sha256').update(bytes).digest('hex'),
        ...(pinned === undefined ? {} : { pinned }),
    });
    if (!verdict.ok) return fail('verify', verdict.reason);
    entry.checks.signedManifest = 'ok';

    entry.ok = true;
    return entry;
}

/** The next minor of a strict MAJOR.MINOR.PATCH, for the downgrade direction. */
function bumpMinor(version) {
    const [major, minor] = String(version).split('.');
    return `${major}.${Number(minor) + 1}.0`;
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

/**
 * Is this process running inside a CI job?
 *
 * Read from the environment every runner sets, and read at CALL time
 * rather than at import, so a test can drive both answers without
 * reloading the module.
 */
export function inCi(env = process.env) {
    return Boolean(env.GITHUB_ACTIONS || env.CI || env.BUILDKITE || env.GITLAB_CI);
}

// ------------------------------------------------------------- the record

/**
 * Check a record against the release actually in hand.
 *
 * Called by publish.sh before a PRODUCTION publish. Every check here
 * exists to stop one specific way a record can be true of something
 * other than this release.
 *
 * `releaseArtifacts` is the artifact basenames the release actually
 * contains, and it decides WHICH lane sets have to be answered for.
 * Omitting it keeps the historical behaviour: every desktop
 * lane is demanded and the direct lane is not considered. Passing it can
 * only add requirements, with one deliberate exception - a release that
 * positively carries an APK and no electron-updater artifact is not
 * asked for desktop evidence, because there is no desktop lane in it.
 * An empty or unrecognised listing takes the strict branch rather than
 * the permissive one: "I could not tell what this release is" must never
 * be the sentence that waives a gate.
 *
 * @param {Object} params
 * @param {Object} params.record
 * @param {string} params.tag
 * @param {string} params.prodManifestSha256
 * @param {string[]} [params.releaseArtifacts]
 * @returns {{ok: boolean, problems: string[], notes: string[]}}
 */
export function assertRecord({ record, tag, prodManifestSha256, releaseArtifacts }) {
    const problems = [];
    const notes = [];

    if (!record || record['record-version'] !== RECORD_VERSION) {
        return { ok: false, problems: [`record-version is not ${RECORD_VERSION}`], notes };
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

    const { desktop: desktopInRelease, direct: directInRelease } = lanesInRelease(releaseArtifacts);

    const lanes = Array.isArray(record.lanes) ? record.lanes : [];
    if (desktopInRelease) {
        const missing = LANES.filter((l) => !lanes.some((r) => r.id === l.id));
        if (missing.length) {
            problems.push(`no result for lane(s): ${missing.map((l) => l.id).join(', ')}`);
        }
    }
    for (const lane of lanes) {
        if (!lane.ok) problems.push(`lane ${lane.id} failed at ${lane.failed}: ${lane.reason}`);
    }

    // The swap half.
    const swaps = Array.isArray(record.swaps) ? record.swaps : [];

    // An attestation whose witness is a machine is not an attestation, and
    // the only way one arrives is by hand or by a job that called `attest`
    // (which refuses to run in CI). Refused here too, because this is the
    // gate publish.sh runs and it is the last place the substitution can
    // be caught.
    for (const swap of swaps) {
        if (/^\s*(github[ -]?actions?|ci|runner|automation|automated|bot|robot)\b/i
            .test(String(swap['attested-by'] || ''))) {
            problems.push(
                `the swap on ${swap.lane} is attested by "${swap['attested-by']}", which names a `
                + 'CI system rather than a person. Whether the download replaced the running app '
                + 'is an OS-level fact no job in the process can observe; file a machine result '
                + 'with `rehearse.mjs check` instead, which records it as separate evidence.',
            );
        }
    }

    // AUTOMATED CHECKS ARE READ HERE AND ARE DELIBERATELY ABSENT FROM THE
    // TALLY BELOW. They can add a problem (a check that watched the swap
    // NOT happen is the strongest possible reason to stop) and they add a
    // note, but no number of them moves an OS into `swappedOs`.
    const automated = Array.isArray(record['automated-checks']) ? record['automated-checks'] : [];
    for (const auto of automated) {
        const valid = validateSwapCheck(auto);
        if (!valid.ok) {
            problems.push(`automated swap check for lane "${auto?.lane}": ${valid.reason}`);
            continue;
        }
        const lane = laneById(auto.lane);
        if (auto.result === 'pass') {
            notes.push(
                `${auto.lane}: an automated swap check PASSED on ${auto.runner}`
                + `${auto.silicon ? ` (${auto.silicon})` : ''}, ${auto.from} -> ${auto.to}. `
                + 'That is a machine result and not an attestation: §7.5 still requires a person '
                + `to watch the swap on ${lane.device}.`,
            );
        } else {
            problems.push(
                `the automated swap check on ${auto.lane} reported ${auto.result} on `
                + `${auto.runner}: ${auto.notes?.join('; ') || 'no reason recorded'}. A machine `
                + 'cannot attest a swap, but it can witness one failing, and this one did.',
            );
        }
    }

    const swappedOs = new Set(
        swaps.map((s) => laneById(s.lane)?.os).filter(Boolean),
    );
    const requirement = record['swap-requirement'];
    // Checked whatever the release contains: this is the record's SHAPE,
    // not a claim about a lane, and an unrecognised value must not become
    // readable by being on a release that has no desktop half.
    if (!['all-os', 'one-os', 'bootstrap'].includes(requirement)) {
        problems.push(`unknown swap-requirement "${requirement}"`);
    }
    if (!desktopInRelease) {
        // Nothing in this release resolves out of a channel pointer, so
        // the one-OS / all-OS calculus has no lane to range over. The
        // direct lane below answers for it instead.
    } else if (requirement === 'all-os') {
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
    }

    // The direct lanes, demanded only of a release that ships
    // the artifact they distribute.
    if (directInRelease) {
        const direct = Array.isArray(record['direct-lanes']) ? record['direct-lanes'] : [];
        for (const lane of DIRECT_LANES) {
            const result = direct.find((r) => r.id === lane.id);
            if (!result) {
                problems.push(
                    `this release ships a .${lane.format} and the record has no result for lane `
                    + `${lane.id}. Its feed is not rehearsed by the desktop probe: run `
                    + `rehearse.mjs run --lane ${lane.id}.`,
                );
                continue;
            }
            if (!result.ok) {
                problems.push(`lane ${result.id} failed at ${result.failed}: ${result.reason}`);
                continue;
            }
            const observed = swaps.find((s) => s.lane === lane.id);
            if (observed && !lane.device) {
                // `attest` refuses this, so it can only arrive by hand. An
                // install-over that names no device is a claim about
                // nothing, and it would otherwise silence the note below.
                problems.push(
                    `the record claims an install-over on ${lane.id}, which the matrix names `
                    + 'no device for. Name the device before recording what watched it.',
                );
            } else if (lane.device && !observed) {
                problems.push(
                    `${lane.id} names ${lane.device} and has no observed install-over for this `
                    + 'release. An APK signed by a different key cannot install over the one on '
                    + 'the device, and the only way out of that is an uninstall that destroys '
                    + 'the vault; no feed-side check can see it.',
                );
            } else if (!lane.device) {
                // The waiver is keyed to the matrix naming no device, not to
                // a flag, so it disappears the day one is named. It is said
                // out loud on every publish for the same reason publish.sh
                // says it on a partial release: a quiet waiver turns "not
                // built yet" into "rehearsed", which is the substitution
                // §7.5 exists to prevent.
                notes.push(
                    `${lane.id}: the feed and the shipped client are rehearsed, the install-over `
                    + 'is NOT. rehearsal-matrix.mjs names no device for it (DD-A), so no one '
                    + 'watched an APK install over its predecessor. That half is unrehearsed, '
                    + 'not proven.',
                );
            }
        }
    }

    return { ok: problems.length === 0, problems, notes };
}

/**
 * Which lane sets a release contains, from its artifact basenames.
 *
 * Both answers default to the demanding side when the listing is absent
 * or says nothing recognisable, because this function's output waives
 * gates and the failure mode of guessing wrong is a silent one.
 *
 * @param {string[]|undefined} releaseArtifacts
 * @returns {{desktop: boolean, direct: boolean}}
 */
export function lanesInRelease(releaseArtifacts) {
    if (!Array.isArray(releaseArtifacts)) return { desktop: true, direct: false };
    const names = releaseArtifacts.map((n) => String(n).split('/').pop().toLowerCase());
    const formats = new Set(LANES.map((l) => l.format.toLowerCase()));
    const desktop = names.some((n) => formats.has(n.slice(n.lastIndexOf('.') + 1)));
    const direct = DIRECT_LANES.some(
        (l) => names.some((n) => n.endsWith(`.${l.format.toLowerCase()}`)),
    );
    // A release with an APK and no update-capable desktop artifact is the
    // only shape that gets to skip the desktop half.
    return { desktop: desktop || !direct, direct };
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
      rehearsal record. Exits 1 if any lane fails. The direct lanes
      (android-direct) are probed when the release contains their
      artifact, or when named with --lane.

  attest --record <file> --lane <id> --from <version> --by <name>
      Record that a human watched the update install and swap on that
      lane's named device. Refuses a lane DD4 has not named a device for,
      and refuses to run inside CI: a job cannot be the witness.

  check --record <file> --from-result <file>
  check --record <file> --lane <id> --from <version> --runner <what ran it>
        --result pass|fail|error [--silicon native|emulated]
      File an AUTOMATED swap check as evidence, separate from the human
      attestation. A failing check stops a publish; a passing one never
      satisfies §7.5's swap requirement, which stays owed to a person on
      the lane's named device.

  assert --record <file> --tag <vX.Y.Z> --prod-input <dir>
      Check a record covers the release in hand. This is the gate
      publish.sh runs; exits 1 with the reasons. Which lane sets it
      demands is read from the release directory, so an APK-only release
      is asked for the direct lane and not for eight desktop ones.

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

/**
 * The artifact basenames of the release directory in hand.
 *
 * Read from the DIRECTORY rather than from the manifest header, because
 * `manifestSha` has already established that the manifest is the thing
 * being published and this only has to say what shape the release is.
 * The manifest and its signature are not artifacts and would otherwise
 * count as "unrecognised", which is the strict branch either way.
 */
function releaseArtifactsIn(prodInput) {
    if (!existsSync(prodInput)) return [];
    return readdirSync(prodInput).filter((n) => !/^RELEASE_HASHES\.txt(\.asc)?$/.test(n));
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

        // The direct lanes are probed when the release CONTAINS the artifact
        // they distribute, not on request. Making it a flag would mean an
        // Android release is rehearsed only by whoever remembers the flag,
        // which is the same reliance on memory that left the lane
        // unrehearsed for its first release.
        const shipping = lanesInRelease(releaseArtifactsIn(prodInput));
        const previousVersion = previousTag ? String(previousTag).replace(/^v/, '') : null;
        const directLanes = [];
        for (const lane of DIRECT_LANES) {
            if (only.length ? !only.includes(lane.id) : !shipping.direct) continue;
            process.stderr.write(`rehearse.mjs: ${lane.id} ... `);
            const entry = await probeDirectLane({
                lane, feedBase: feed, tag, previousVersion, pinned,
            });
            directLanes.push(entry);
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
            'direct-lanes': directLanes,
            swaps: [],
            // Present and empty from the start, so an older record and a
            // record with no checks are the same shape rather than two
            // cases every reader has to remember.
            'automated-checks': [],
        };
        await writeFile(out, `${JSON.stringify(record, null, 2)}\n`);
        process.stderr.write(`rehearse.mjs: record written to ${out}\n`);

        const bad = [...lanes, ...directLanes].filter((l) => !l.ok);
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
        for (const lane of DIRECT_LANES.filter((l) => directLanes.some((r) => r.id === l.id))) {
            process.stderr.write(lane.device
                ? `rehearse.mjs: ${lane.id} still needs an observed install-over on ${lane.device}.\n`
                : `rehearse.mjs: ${lane.id}'s feed and client are rehearsed; its INSTALL-OVER is\n`
                  + '  not, because rehearsal-matrix.mjs names no device for it (DD-A). That\n'
                  + '  half is unrehearsed, not proven.\n');
        }
        return 0;
    }

    if (command === 'attest') {
        const file = flag(argv, '--record') || fail('attest needs --record <file>');
        const laneId = flag(argv, '--lane') || fail('attest needs --lane <id>');
        const from = flag(argv, '--from') || fail('attest needs --from <version installed before the swap>');
        const by = flag(argv, '--by') || fail('attest needs --by <who watched it>');

        // THE CONTROL, NOT A CONVENIENCE CHECK. `--by` exists because
        // whether the downloaded artifact replaced the RUNNING app is an
        // OS-level fact no test in this process can observe. A CI job that
        // calls this command has not automated the witness, it has removed
        // one, and it is the obvious thing to reach for once a runner is
        // performing the swap. The runner files its result with `check`.
        if (inCi()) {
            fail('refusing to attest from CI. `--by` names the person who WATCHED the running\n'
                + '  app be replaced, which is the one half of a rehearsal no process can\n'
                + '  observe about itself. A job attesting its own swap deletes that control\n'
                + '  rather than automating it.\n'
                + '  File the machine result instead: rehearse.mjs check --record <file> --lane '
                + `${laneId} --runner <what ran it> --result pass|fail`);
        }
        if (/^\s*(github[ -]?actions?|ci|runner|automation|automated|bot|robot)\b/i.test(by)) {
            fail(`--by "${by}" names a CI system, not a person. See above: use \`check\`.`);
        }

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

    if (command === 'check') {
        const file = flag(argv, '--record') || fail('check needs --record <file>');
        if (flag(argv, '--by') !== undefined) {
            fail('check takes --runner, never --by. `--by` is a person who watched the swap and\n'
                + '  belongs to `attest`; this command records what a MACHINE observed, which is\n'
                + '  separate evidence and not a substitute for the attestation.');
        }
        const resultFile = flag(argv, '--from-result');

        let result;
        if (resultFile) {
            try {
                result = JSON.parse(readFileSync(resultFile, 'utf8'));
            } catch (err) {
                return fail(`${resultFile} is not readable JSON: ${String(err?.message || err)}`);
            }
        } else {
            const laneId = flag(argv, '--lane') || fail('check needs --lane <id> (or --from-result <file>)');
            result = makeSwapCheck({
                lane: laneId,
                from: flag(argv, '--from') || fail('check needs --from <version installed before the swap>'),
                to: flag(argv, '--to') || '',
                result: flag(argv, '--result') || fail(`check needs --result ${SWAP_CHECK_RESULTS.join('|')}`),
                runner: flag(argv, '--runner') || fail('check needs --runner <what machine ran it>'),
                silicon: flag(argv, '--silicon') || null,
                notes: flags(argv, '--note'),
            });
        }

        const record = JSON.parse(readFileSync(file, 'utf8'));
        // Defaulted from the record rather than demanded twice: the drill
        // knows the version it updated to, and a manual invocation should
        // not be able to file a check against a version this record is not
        // about.
        if (!result.to) result.to = String(record.tag).replace(/^v/, '');

        const valid = validateSwapCheck(result);
        if (!valid.ok) fail(`this is not a usable swap check: ${valid.reason}`);
        if (result.to !== String(record.tag).replace(/^v/, '')) {
            fail(`the check updated to ${result.to}, and this record is for ${record.tag}.\n`
                + '  Evidence is bound to the release it was produced against, the same way the\n'
                + '  record is bound to its manifest.');
        }

        record['automated-checks'] = record['automated-checks'] || [];
        record['automated-checks'].push(result);
        writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);

        const lane = laneById(result.lane);
        process.stdout.write(
            `ok   automated swap check filed for ${result.lane}: ${result.result} on `
            + `${result.runner}${result.silicon ? ` (${result.silicon})` : ''}, `
            + `${result.from} -> ${result.to}\n`,
        );
        // Said on the way out, every time, because the whole risk of having
        // this command at all is that its output starts reading as the
        // rehearsal it stands beside.
        process.stderr.write(
            `rehearse.mjs: this is NOT an attestation. ${result.lane} still owes an observed swap `
            + `on ${lane.device}, watched by a person (rehearse.mjs attest).\n`,
        );
        return result.result === 'pass' ? 0 : 1;
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
        const { ok, problems, notes } = assertRecord({
            record,
            tag,
            prodManifestSha256: manifestSha(prodInput),
            releaseArtifacts: releaseArtifactsIn(prodInput),
        });
        if (!ok) {
            process.stderr.write(`rehearse.mjs: the rehearsal record does not cover this release.\n`);
            for (const p of problems) process.stderr.write(`  - ${p}\n`);
            return 1;
        }
        // Printed BEFORE the ok line, and to stderr, so a passing publish
        // cannot be read as a fully proven one just because the last line
        // said ok.
        for (const n of notes) process.stderr.write(`rehearse.mjs: NOT PROVEN - ${n}\n`);
        const swaps = record.swaps.map((s) => `${s.lane} on ${s.device}`).join(', ');
        const direct = Array.isArray(record['direct-lanes']) ? record['direct-lanes'] : [];
        process.stdout.write(
            `ok   rehearsal ${record.tag}: ${record.lanes.length} lane(s) probed`
            + `${direct.length ? ` + ${direct.length} direct` : ''}, `
            + `requirement ${record['swap-requirement']}`
            + `${swaps ? `, swap observed: ${swaps}` : ''}\n`,
        );
        return 0;
    }

    if (command === 'coverage') {
        const dir = flag(argv, '--records') || 'release-artifacts';
        const seen = new Map();
        const checked = new Map();
        if (existsSync(dir)) {
            for (const name of readdirSync(dir)) {
                if (!/^REHEARSAL-.*\.json$/.test(name)) continue;
                let record;
                try { record = JSON.parse(readFileSync(join(dir, name), 'utf8')); } catch { continue; }
                for (const swap of record.swaps || []) {
                    seen.set(swap.lane, { tag: record.tag, device: swap.device, at: swap.at });
                }
                for (const auto of record['automated-checks'] || []) {
                    if (!validateSwapCheck(auto).ok) continue;
                    checked.set(auto.lane, { tag: record.tag, ...auto });
                }
            }
        }
        let blocked = 0;
        // The direct lane is listed alongside the desktop ones, with its
        // own open question named. Leaving it off this table is how it
        // stayed invisible: a coverage report that ranges over exactly the
        // lanes someone thought of is a report about that person.
        for (const lane of [...LANES, ...DIRECT_LANES]) {
            const hit = seen.get(lane.id);
            const dd = DIRECT_LANES.includes(lane) ? 'DD-A' : 'DD4';
            const verb = DIRECT_LANES.includes(lane) ? 'installed over' : 'swapped';
            // An automated check is reported BESIDE the box, never inside
            // it. It is the one line of this table where a reader could
            // talk themselves into treating a machine's result as the
            // rehearsal, so it says which it is on the same line.
            const auto = checked.get(lane.id);
            const machine = auto
                ? `  [automated swap check: ${auto.result} at ${auto.tag} on ${auto.runner}`
                  + `${auto.silicon ? `, ${auto.silicon}` : ''} - NOT an attestation]`
                : '';
            if (hit) {
                process.stdout.write(`✅ ${lane.id.padEnd(22)} ${verb} at ${hit.tag} on ${hit.device}${machine}\n`);
            } else {
                blocked += 1;
                const why = lane.device ? `device ${lane.device}, never rehearsed` : `NO DEVICE NAMED (${dd})`;
                process.stdout.write(`⬜ ${lane.id.padEnd(22)} ${why}${machine}\n`);
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
