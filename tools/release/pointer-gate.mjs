// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/pointer-gate.mjs - will the fleet accept these channel
// pointers? (§7.3, run by publish.sh before anything is uploaded.)
//
// The desktop client takes a pointer's `version`, fetches
// RELEASE_HASHES/v<version>.txt, and refuses the install unless every file
// the pointer names is in that manifest (updateVerify.js
// verifyChannelPointer). publish.sh uploads this release's manifest as
// RELEASE_HASHES/<tag>.txt, so a pointer is only installable when:
//   1. its version is exactly the tag without the leading `v`, and
//   2. every file it names is covered by this release's RELEASE_HASHES.txt.
// A stale pointer left in the input directory fails 1 and freezes its fleet
// on the old version; a pointer naming another build's file fails 2 and
// every client downloads, refuses and deletes it. Both publish green unless
// something refuses them here, where nothing has been uploaded yet.
//
// 3. The pointer set is exactly the one the release's lanes need. A missing
// per-arch pointer leaves that fleet reading the previous release's pointer,
// which still matches the previous manifest, so nothing downstream sees it.
// The lanes come from the SIGNED header: `# rehearsal-os:` names the OSes a
// rehearsal covers, `# lanes:` the lanes a partial covers, and no header
// means every updater lane in shipped-lanes.txt. Every check fails shut.
//
// 4. The signed header records `# dev-mock-gate: enforced`. The client refuses
// any other value, an absent header included, so a release signed with the
// gate skipped would publish green and update nobody.
//
// 5. Every file a pointer names carries a sha512 that is the staged file's.
// The client refuses a missing or different one, so a yml and an installer
// from two builds of one version (a re-cut lane) would update nobody.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseManifestText, parseUpdateInfo, sha512File } from './feed-sweep.mjs';
import { classify, pointerNameFor } from './update-info.mjs';

/**
 * Every desktop pointer the build emits, keyed by its `shipped-lanes.txt` lane.
 *
 * Windows and macOS put both arches in one pointer and Linux splits per arch,
 * so the shipped matrix is four pointers over three lanes. The publish gate
 * and the edge probe both read this list, so they cannot disagree on the set.
 */
export const DESKTOP_POINTER_LANES = Object.freeze([
    Object.freeze({ lane: 'windows', os: 'win32' }),
    Object.freeze({ lane: 'mac', os: 'darwin' }),
    Object.freeze({ lane: 'linux', os: 'linux', arch: 'x64' }),
    Object.freeze({ lane: 'linux', os: 'linux', arch: 'arm64' }),
]);

const LANE_FEEDS = new Set(['updater', 'store-only']);

/** A pointer url as the client compares it: no leading `./`. */
function normalizeName(name) {
    return String(name).replace(/^\.\//, '').trim();
}

/** A pointer sha512 as hex, or '' when absent or malformed (port of updateVerify.js normalizeSha512). */
function normalizeSha512(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/^[0-9a-f]{128}$/.test(raw.toLowerCase())) return raw.toLowerCase();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return '';
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length !== 64) return '';
    return decoded.toString('hex');
}

/**
 * Hex sha512 of every file in the flat release directory that a pointer names,
 * each hashed once.
 *
 * @param {string} dir
 * @param {Array<{ name: string, text: string }>} pointers
 * @returns {Map<string, string>}
 */
export function stagedSha512s(dir, pointers) {
    const hashes = new Map();
    for (const { text } of pointers) {
        for (const file of parseUpdateInfo(String(text ?? '')).files) {
            const key = basename(normalizeName(file.url));
            const path = join(dir, key);
            if (hashes.has(key) || !existsSync(path)) continue;
            hashes.set(key, Buffer.from(sha512File(path), 'base64').toString('hex'));
        }
    }
    return hashes;
}

/**
 * Lane name to feed column (`updater` | `store-only`), from shipped-lanes.txt.
 *
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseLaneFeeds(text) {
    const feeds = new Map();
    for (const raw of String(text ?? '').split('\n')) {
        const line = raw.replace(/\r$/, '').trim();
        if (!line || line.startsWith('#')) continue;
        const [lane, , feed] = line.split(/\s+/);
        if (!LANE_FEEDS.has(feed)) throw new Error(`shipped-lanes.txt: cannot read the feed of "${line}"`);
        feeds.set(lane, feed);
    }
    if (feeds.size === 0) throw new Error('shipped-lanes.txt declares no lanes');
    return feeds;
}

/**
 * The lanes a signed manifest covers, read from its header.
 *
 * @param {string} manifestText
 * @param {Map<string, string>} laneFeeds
 * @returns {{ source: string, lanes: string[] }}
 */
export function manifestScope(manifestText, laneFeeds) {
    const text = String(manifestText ?? '').replace(/\r\n/g, '\n');
    for (const key of ['rehearsal-os', 'lanes']) {
        const m = new RegExp(`^# ${key}:(.*)$`, 'm').exec(text);
        if (m) return { source: `signed ${key} header`, lanes: m[1].trim().split(/\s+/).filter(Boolean) };
    }
    const updater = [...laneFeeds].filter(([, feed]) => feed === 'updater').map(([lane]) => lane);
    return { source: 'a full release', lanes: updater };
}

/**
 * The pointer filenames a release covering `lanes` must carry, exactly.
 *
 * @param {{ channel: string, lanes: string[], laneFeeds: Map<string, string> }} input
 * @returns {{ names: Set<string>, problems: string[] }}
 */
export function expectedPointers({ channel, lanes, laneFeeds }) {
    const names = new Set();
    const problems = [];
    for (const lane of lanes) {
        const feed = laneFeeds.get(lane);
        if (!feed) {
            problems.push(`the signed manifest covers lane "${lane}", which shipped-lanes.txt does not declare`);
            continue;
        }
        if (feed !== 'updater') continue;
        const mapped = DESKTOP_POINTER_LANES.filter((entry) => entry.lane === lane);
        if (mapped.length === 0) {
            problems.push(`lane "${lane}" updates through the feed, but no channel pointer is mapped for it`);
        }
        for (const { os, arch } of mapped) names.add(pointerNameFor({ channel, os, arch }));
    }
    return { names, problems };
}

/**
 * Every reason the given channel pointers would be refused by the client,
 * or would leave a lane's fleet without this release.
 *
 * `stagedSha512` maps each staged file's basename to its hex sha512; a file it
 * lacks is refused, so omitting it fails shut.
 *
 * @param {{ pointers: Array<{ name: string, text: string }>, manifestText: string, tag: string,
 *   channel: string, lanesText: string, stagedSha512?: Map<string, string> }} input
 * @returns {string[]} one line per problem, empty when every pointer passes
 */
export function checkPointers({ pointers, manifestText, tag, channel, lanesText, stagedSha512 }) {
    const problems = [];
    const want = String(tag ?? '').trim().replace(/^v/, '');
    if (!want) return ['no tag to check the channel pointers against'];
    if (!channel) return ['no channel to name the expected pointers by'];
    const { entries, gate } = parseManifestText(String(manifestText ?? ''), 'RELEASE_HASHES.txt');
    if (entries.size === 0) return ['the signed manifest lists no files, so no pointer can be covered'];
    let laneFeeds;
    try {
        laneFeeds = parseLaneFeeds(lanesText);
    } catch (err) {
        return [err.message];
    }

    const scope = manifestScope(manifestText, laneFeeds);
    if (scope.lanes.length === 0) return [`${scope.source} names no lane, so no pointer set can be expected`];
    const expected = expectedPointers({ channel, lanes: scope.lanes, laneFeeds });
    problems.push(...expected.problems);
    // Refuse a release the client refuses by its gate before any pointer goes up.
    if ((pointers.length > 0 || expected.names.size > 0) && gate !== 'enforced') {
        problems.push(`the signed manifest records the dev-mock gate as '${gate || 'unrecorded'}', not 'enforced'; `
            + 'every desktop client refuses this release. Re-sign with the gate running '
            + '(SIGN_SKIP_DEV_MOCK_CHECK unset). There is no override flag.');
    }
    const present = new Set(pointers.map(({ name }) => basename(name)));
    const scopeText = `lane(s) ${scope.lanes.join(' ')} (${scope.source})`;
    for (const name of [...expected.names].sort()) {
        if (!present.has(name)) problems.push(`${name}: missing, and ${scopeText} need it`);
    }
    for (const name of [...present].sort()) {
        if (!expected.names.has(name)) problems.push(`${name}: unexpected, ${scopeText} ship no such pointer`);
    }

    for (const { name, text } of pointers) {
        const info = parseUpdateInfo(String(text ?? ''));
        if (!info.version || info.files.length === 0) {
            problems.push(`${name}: declares no version or names no files`);
            continue;
        }
        if (info.version !== want) {
            problems.push(`${name}: describes version ${info.version}, not ${want}`);
        }
        for (const file of info.files) {
            const listed = normalizeName(file.url);
            if (!entries.has(basename(listed))) {
                problems.push(`${name}: names ${listed}, which this release's signed manifest does not cover`);
            }
            const claimed = normalizeSha512(file.sha512);
            const staged = stagedSha512 instanceof Map ? stagedSha512.get(basename(listed)) : undefined;
            if (!claimed) {
                problems.push(`${name}: carries no sha512 for ${listed}, which the desktop client refuses`);
            } else if (staged === undefined) {
                problems.push(`${name}: names ${listed}, which is not in the release directory`);
            } else if (staged !== claimed) {
                problems.push(`${name}: sha512 for ${listed} is not the staged file's; the pointer and the `
                    + 'artifact come from different builds, and every client would download, refuse and delete it');
            }
        }
    }
    return problems;
}

const USAGE = `usage: pointer-gate.mjs <release dir> --tag <vX.Y.Z> --manifest <RELEASE_HASHES.txt>
                       --channel <stable|staging> [--lanes <shipped-lanes.txt>]

Checks every channel pointer (*.yml update-info) in <release dir> the way the
desktop client will: its version must be the tag's, and every file it names
must be in the signed manifest and carry the staged file's sha512. Then
checks the set: exactly the pointers the
lanes in the manifest's signed header need, none missing and none extra.
Refuses any pointer set whose manifest does not record the dev-mock gate as
enforced, which the client refuses too.
--lanes defaults to the shipped-lanes.txt beside this script.
Exit 0 all pass, 1 any refused, 2 usage error.
`;

function main(argv) {
    if (argv.includes('--help') || argv.includes('-h')) {
        process.stdout.write(USAGE);
        return 0;
    }
    const valued = ['--tag', '--manifest', '--channel', '--lanes'];
    const dir = argv.find((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]));
    const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
    const tag = flag('--tag');
    const manifestPath = flag('--manifest');
    const channel = flag('--channel');
    const lanesPath = flag('--lanes') ?? fileURLToPath(new URL('./shipped-lanes.txt', import.meta.url));
    if (!dir || !tag || !manifestPath || !channel) {
        process.stderr.write(USAGE);
        return 2;
    }
    let manifestText;
    let lanesText;
    try {
        manifestText = readFileSync(manifestPath, 'utf8');
        lanesText = readFileSync(lanesPath, 'utf8');
    } catch (err) {
        process.stderr.write(`pointer-gate: cannot read ${err.path ?? manifestPath}: ${err.message}\n`);
        return 1;
    }
    const names = classify(dir).pointers;
    const pointers = names.map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
    const stagedSha512 = stagedSha512s(dir, pointers);
    const problems = checkPointers({ pointers, manifestText, tag, channel, lanesText, stagedSha512 });
    for (const p of problems) process.stderr.write(`  POINTER-REFUSED  ${p}\n`);
    if (problems.length) return 1;
    process.stdout.write(`pointer-gate: ${pointers.length} channel pointer(s) name ${tag.replace(/^v/, '')}, `
        + 'only files the signed manifest covers, and every pointer its lanes need\n');
    return 0;
}

// Resolved through realpath so a symlinked or spaced checkout still runs the CLI.
const invokedDirectly = (() => {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
})();

if (invokedDirectly) {
    process.exit(main(process.argv.slice(2)));
}
