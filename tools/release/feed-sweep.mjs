// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/feed-sweep.mjs - does the feed still hold what we signed?
// (§7.2, stage 4.) Runs by cron ON the feed host, over the local
// tree; it never fetches, so a compromised edge cannot answer for it.
//
// WHAT THIS IS, STATED PLAINLY. It is a FORENSIC RECORD, not a detection
// control. §7.2 asks for an alert on any change to feed objects outside a
// release window, and there is no receiving channel for one yet (the
// alert-channel decision and the watchdog gap it left open). Until there
// is, this writes a timestamped log that gets read at releases and at
// incidents. Calling it a control before something reads it would be the
// more comfortable lie.
//
// WHY THE UNION, AND NOT THE NEWEST MANIFEST. Comparing the feed against
// only the latest release's manifest would cry wolf during exactly the
// operations that matter most: a §7.4 rollback restores a PREVIOUS
// release's pointer, and retention (§7.3) deliberately keeps the last 3
// releases' binaries on the feed. Both are correct states that a
// newest-only check calls divergence. Alarms that fire during normal
// operations get muted, and a muted alarm is worse than none, so the
// baseline is the union of every published manifest.
//
// THE CHECK THE LINUX LANE ACTUALLY NEEDS. On Windows and macOS the OS
// re-validates a downloaded update's signature, so a rewritten pointer
// gets the client nowhere. On Linux there is no such backstop: the sha512
// inside the yml is the whole story, and it is fetched from the same feed
// as the bytes it describes (§7.2). So the pointer checks below are the
// point of this tool. An attacker who can write to the feed uploads their
// own AppImage and rewrites the pointer to name it, and every value in
// that yml is internally consistent. What they cannot do is get that file
// into a manifest signed by K1 - which lives on detached media - so
// POINTER-UNCOVERED is the line that catches them.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { isUpdateInfoContent } from './update-info.mjs';

// THE ANDROID LANE IS HERE BECAUSE IT IS THE ONLY ONE THAT HAS PUBLISHED.
// This list read ['desktop', 'extension', 'web'] from the day it was written
// and none of those directories has ever held a file, while the direct-APK
// lane went live on 2026-08-06. Measured on origin-host 2026-08-10, the
// hourly cron was reporting "0 artifact(s), 0 pointer(s), 1 manifest(s),
// 0 finding(s)" against a feed holding a published APK and its update
// pointer: a clean bill of health over an empty set. The one binary this
// project has shipped to the public was the one the swap detector could not
// see. (rows 128 and 130 are the same blindness in the edge-cache
// verifier and the store monitor; three tools, one cause - all written for
// desktop, none extended when Android became the lane that shipped.)
//
/** Feed subdirectories that hold published payload. */
export const PAYLOAD_DIRS = ['desktop', 'extension', 'web', 'android'];

/** Where signed manifests live, one per release, append-only (§7.3). */
export const MANIFEST_DIR = 'RELEASE_HASHES';

/**
 * Every finding this sweep can report, with the reading each one wants.
 * Kept as data so the log, the summary and the tests cannot drift on what
 * a code means.
 */
export const FINDINGS = {
    UNCOVERED: 'a published file no manifest covers by name',
    MISMATCH: 'a published file whose bytes match no manifest hash for its name',
    'POINTER-UNPARSEABLE': 'an update-info yml that does not parse',
    'POINTER-DANGLING': 'a pointer naming a file that is not on the feed',
    'POINTER-HASH': "a pointer's sha512 does not match the bytes it names",
    'POINTER-UNCOVERED': 'a pointer names a file no signed manifest covers',
    'POINTER-NO-MANIFEST': "no manifest is published for a live pointer's version",
    'MANIFEST-UNSIGNED': 'a manifest with no detached signature beside it',
    'MANIFEST-BAD-SIG': 'a manifest whose signature did not verify',
};

/** sha256 of a file, hex, streamed (artifacts run to hundreds of MB). */
export function sha256File(path) {
    return hashFile(path, 'sha256', 'hex');
}

/** sha512 of a file, base64 - the encoding electron-updater writes. */
export function sha512File(path) {
    return hashFile(path, 'sha512', 'base64');
}

function hashFile(path, algorithm, encoding) {
    // Synchronous by design: this is a cron job whose whole output is one
    // verdict, and a streaming-async version would buy nothing but the
    // chance to get the ordering of the log wrong.
    const hash = createHash(algorithm);
    hash.update(readFileSync(path));
    return hash.digest(encoding);
}

/**
 * Parse a release manifest into `{tag, entries: Map<basename, sha256>}`.
 *
 * Manifest lines are `<sha256>  ./name` (lib.sh). The names are relative
 * to the flat staging directory the release was signed from, while the
 * feed sorts the same files into `desktop/`, `extension/` and `web/`, so
 * the index is keyed on basename. That is safe because the artifact names
 * carry the version (`...-v0.333.1.tar.gz`) and are therefore unique
 * across releases; two releases sharing a basename would be the same
 * bytes or an immutability breach, and the second case is what MISMATCH
 * reports.
 *
 * @param {string} path
 * @returns {{tag: string, entries: Map<string,string>}}
 */
/**
 * Which RELEASE a manifest tag names, with any re-sign suffix stripped.
 *
 * The bash half of this rule is `xr_release_tag_of` in lib.sh, and
 * `test/smoke/audits/release-resign-tag.smoke.js` drives both spellings
 * over one table so they cannot drift apart.
 *
 * @param {string} tag
 * @returns {string}
 */
export function releaseTagOf(tag) {
    return String(tag).replace(/-resign\d+$/, '');
}

/**
 * Is this the direct-install lane's JSON update pointer?
 *
 * Deliberately structural rather than name-based: `android/latest.json` is
 * the only one today, but a name test would go blind the moment a second
 * lane publishes under a different filename, which is precisely how the
 * desktop-only assumptions in this file survived so long. A pointer is a
 * JSON object carrying a `version` string; anything else in that directory
 * is payload and is hashed as payload.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isJsonPointerContent(text) {
    return parseJsonPointerVersion(text) !== '';
}

/**
 * The version a JSON pointer names, or '' if it names none.
 *
 * @param {string} text
 * @returns {string}
 */
export function parseJsonPointerVersion(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch { return ''; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
    return typeof parsed.version === 'string' ? parsed.version.trim() : '';
}

/** The client's cap on the whole feed body (directUpdateCheck.js MAX_FEED_BYTES). */
const DIRECT_FEED_MAX_CHARS = 4096;

/** The client's version rule (directUpdateCheck.js SEMVER_RE), verbatim. */
const DIRECT_SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Why the SHIPPED client would discard this pointer body, or '' if it
 * would accept it.
 *
 * Deliberately a COPY of `packages/web/src/update/directUpdateCheck.js`'s
 * rule rather than an import of it, on the same grounds
 * `store-version-monitor.mjs` states for its own copy: this file is
 * deployed standalone as /opt/xchain/feed-sweep.mjs and an import
 * reaching into packages/web makes it unloadable there. The copy is held
 * to the original by an equivalence table in
 * `test/smoke/audits/feed-sweep.smoke.js`, which drives BOTH functions
 * over one set of bodies wherever both files exist.
 *
 * The size is measured the client's way - `text.length` on the decoded
 * body, not a stat of the file - because that is the comparison
 * `checkForDirectUpdate` actually makes before it parses anything.
 *
 * @param {string} text
 * @returns {string} the reason, or '' when the client accepts it
 */
export function directFeedRejection(text) {
    if (typeof text !== 'string') return 'not text';
    if (text.length > DIRECT_FEED_MAX_CHARS) {
        return `${text.length} characters, over the client's `
            + `${DIRECT_FEED_MAX_CHARS}-character cap`;
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch { return 'not parseable as JSON'; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return 'body is not a JSON object';
    }
    const version = parsed.version;
    if (typeof version !== 'string') return 'missing a string "version"';
    // The RAW value, never the trimmed one. `parseJsonPointerVersion`
    // trims so classification stays forgiving, and that trim is exactly
    // what hid `{"version":" 1.2.3 "}`: the sweep matched a real manifest
    // while the client's anchored regex rejected the padding.
    if (!DIRECT_SEMVER_RE.test(version)) {
        return `"${version.slice(0, 32)}" is not a plain MAJOR.MINOR.PATCH`;
    }
    return '';
}

/**
 * Parse manifest text a caller ALREADY HOLDS.
 *
 * Split out from the path form so the sweep can verify and parse one
 * buffer. Re-reading the file after gpg has verified it makes the bytes
 * that were signed and the bytes that enter the baseline two separate
 * reads of a directory a writer can change in between.
 *
 * @param {string} text
 * @param {string} name  the manifest's file name, for the tag fallback
 * @returns {{tag: string, entries: Map<string,string>}}
 */
export function parseManifestText(text, name) {
    const entries = new Map();
    let tag = '';

    for (const rawLine of text.split('\n')) {
        // STRIP THE CARRIAGE RETURN, as every other reader of these files
        // already does (updateVerify.js `parseManifest` at :197 and
        // `parseChannelPointer` at :337, rehearse.mjs at :235). `.` never
        // matches \r and `$` is not multiline here, so a CRLF manifest
        // matched NO line at all: zero entries, an empty baseline, and
        // every published file reported UNCOVERED - while the desktop
        // client read the very same bytes without complaint. A producer
        // and a consumer disagreeing about a line ending aims a tampering
        // alarm at the operator rather than at an attacker, and an alarm
        // that fires on a good feed is one that gets muted.
        const line = rawLine.replace(/\r$/, '');
        const header = /^# tag:\s*(.+)$/.exec(line);
        if (header) { tag = header[1].trim(); continue; }
        if (line.startsWith('#') || line.trim() === '') continue;
        const m = /^([0-9a-fA-F]{64})\s\s(.+)$/.exec(line);
        if (!m) continue;
        entries.set(basename(m[2].trim()), m[1].toLowerCase());
    }
    return { tag: tag || name.replace(/\.txt$/, ''), entries };
}

export function parseManifest(path) {
    return parseManifestText(readFileSync(path, 'utf8'), basename(path));
}

/**
 * Extract what an electron-updater yml claims, without a YAML dependency.
 *
 * The shape is fixed by electron-builder's own writer: a top-level
 * `version`, a `files:` sequence of `- url:` / `sha512:` / `size:`, and a
 * legacy top-level `path` + `sha512` duplicating the first entry. Both
 * halves are returned because electron-updater reads BOTH depending on
 * client version, so a tamper that edits only one of them is still a
 * tamper the sweep has to see.
 *
 * @param {string} text
 * @returns {{version: string, files: Array<{url: string, sha512: string}>}}
 */
export function parseUpdateInfo(text) {
    const out = { version: '', files: [] };
    const lines = text.split('\n');

    let current = null;
    for (const rawLine of lines) {
        // Same carriage-return rule as parseManifestText, and for the same
        // reason: `parseChannelPointer` (updateVerify.js:337) is a port of
        // THIS function that strips \r, so a CRLF pointer the shipped
        // client accepts came back here with no version and no files and
        // was reported POINTER-UNPARSEABLE. The two halves of one contract
        // must read a pointer the same way, or the sweep's findings are
        // about the sweep.
        const line = rawLine.replace(/\r$/, '');
        const version = /^version:\s*(.+)$/.exec(line);
        if (version) { out.version = unquote(version[1]); continue; }

        const url = /^\s+-\s+url:\s*(.+)$/.exec(line);
        if (url) {
            current = { url: unquote(url[1]), sha512: '' };
            out.files.push(current);
            continue;
        }
        const nested = /^\s+sha512:\s*(.+)$/.exec(line);
        if (nested && current) { current.sha512 = unquote(nested[1]); continue; }

        // Top-level `path:`/`sha512:` (column 0). Recorded as another file
        // entry when it names something the `files:` list did not, so an
        // edit to the legacy pair alone cannot slip past.
        const path = /^path:\s*(.+)$/.exec(line);
        if (path) {
            current = null;
            const name = unquote(path[1]);
            if (!out.files.some((f) => f.url === name)) out.files.push({ url: name, sha512: '' });
            continue;
        }
        const top = /^sha512:\s*(.+)$/.exec(line);
        if (top) {
            const last = out.files[out.files.length - 1];
            if (last && !last.sha512) last.sha512 = unquote(top[1]);
        }
    }
    return out;
}

function unquote(value) {
    return value.trim().replace(/^['"]|['"]$/g, '');
}

/**
 * Verify a manifest's detached signature, if the operator asked for it.
 *
 * WITHOUT THIS, THE BASELINE IS ONLY AS GOOD AS THE DIRECTORY. Whoever
 * can write to the feed can also drop a new `RELEASE_HASHES/vX.txt`
 * covering the file they just uploaded, and every check below would go
 * green: the sweep would be checking the attacker's payload against the
 * attacker's manifest. `--gpg-key` closes that by anchoring the baseline
 * to K1. It is optional only because a feed host with no gpg and no
 * keyring is a real deployment, and a sweep that refuses to run there
 * reports nothing at all; the summary says which mode it ran in rather
 * than letting a reader assume the stronger one.
 *
 * VERIFY THE BYTES THE CALLER HOLDS, never a path. Handing gpg a path
 * makes gpg open the file itself, so the run that was signed and the run
 * that is parsed are two reads of a directory whose whole threat model is
 * "someone can write here". A writer who replaces the manifest between
 * them gets hashes nobody signed into a baseline the summary reports as
 * `gpg-verified against <fpr>`, which is the anchor's own failure mode
 * wearing the anchor's badge. gpg takes the signed data on stdin when the
 * data argument is `-`; the detached signature stays a path because it is
 * the one file gpg must read for itself, and swapping IT can only fail
 * closed against bytes we already hold.
 *
 * @param {Buffer|string} manifestBytes  the exact bytes that will be parsed
 * @param {string} signaturePath         the detached `.asc` beside them
 * @returns {'ok'|'bad'|'skipped'}
 */
export function verifyManifestSignature(manifestBytes, signaturePath, keyFingerprint,
    run = spawnSync) {
    if (!keyFingerprint) return 'skipped';
    if (!existsSync(signaturePath)) return 'bad';

    const result = run('gpg', ['--status-fd=1', '--verify', signaturePath, '-'], {
        input: manifestBytes,
        encoding: 'utf8',
    });
    if (result.error || typeof result.stdout !== 'string') return 'bad';

    // Read the machine-readable status, never the human text: gpg exits 0
    // for a good signature from an UNTRUSTED key, which is precisely the
    // case an attacker with their own key produces. VALIDSIG carries the
    // fingerprint that actually signed, so it is the only line that
    // answers "was this K1".
    //
    // MATCH THE PRIMARY KEY AS WELL AS THE SIGNING ONE, because they are
    // different fingerprints and the world only ever sees one of them. K1
    // signs with a subkey, so VALIDSIG's FIRST field is that subkey
    // (27A15936…) while `xchain.io/security`, SECURITY.md, the docs recipe
    // and every instruction a user is given publish the PRIMARY
    // (1A29E7C4…). Matching field 1 alone made the documented value wrong:
    // driven against the live feed, `--gpg-key <primary>` reported
    // MANIFEST-BAD-SIG on a perfectly good K1 signature AND dropped the
    // manifest from the baseline, so every published file would have gone
    // UNCOVERED behind it. That is this file's own "alarms that fire during
    // normal operations get muted" failure, aimed at the one operator who
    // followed the instructions. GnuPG's last VALIDSIG field is the primary
    // key fingerprint precisely so a caller can do this.
    const validsig = /^\[GNUPG:\] VALIDSIG (.+)$/m.exec(result.stdout);
    if (!validsig) return 'bad';
    const fields = validsig[1].trim().split(/\s+/);
    const signing = fields[0] || '';
    const primary = fields.length > 1 ? fields[fields.length - 1] : '';
    const want = keyFingerprint.replace(/\s+/g, '').toUpperCase();
    // FULL-FINGERPRINT EQUALITY, never a suffix. Matching by suffix meant a
    // configured 8- or 16-hex key id (the value gpg prints most often)
    // accepted ANY key whose fingerprint happened to end in those
    // characters, and short-id collisions are cheaply minted. The manifest
    // this decides on is what enters the union baseline the whole feed is
    // judged against, so a collision key would have laundered its own
    // payload clean. cws-upload.mjs's attributeSignature and verify.sh's
    // --key gate both demand 40 hex with strict equality; this is the same
    // rule, and the three must not drift apart again.
    const matches = (fpr) => /^[0-9A-F]{40}$/.test(fpr.toUpperCase())
        && fpr.toUpperCase() === want;
    return matches(signing) || matches(primary) ? 'ok' : 'bad';
}

/**
 * Sweep a feed root and return every finding.
 *
 * @param {string} root
 * @param {{gpgKey?: string, run?: Function}} [options]
 * @returns {{findings: Array<{code: string, path: string, detail: string}>,
 *            checked: number, manifests: number, pointers: number,
 *            signatureMode: string}}
 */
export function sweep(root, options = {}) {
    const findings = [];
    const add = (code, path, detail) => findings.push({ code, path, detail });

    // ---- baseline: the union of every published manifest ---------------
    const manifestDir = join(root, MANIFEST_DIR);
    const union = new Map();        // basename -> Set<sha256>
    const tagsSeen = new Set();
    let manifestCount = 0;
    let signaturesChecked = 0;

    if (existsSync(manifestDir)) {
        for (const name of readdirSync(manifestDir).sort()) {
            if (!name.endsWith('.txt')) continue;
            const full = join(manifestDir, name);
            if (!statSync(full).isFile()) continue;

            // ONE READ, used for both decisions. Everything below judges
            // these bytes: the signature check and the baseline entries
            // come from the same buffer, so there is no window in which
            // the file can become something else after it has been
            // verified. Do not reintroduce a second read of `full` in
            // this loop.
            const bytes = readFileSync(full);
            const state = verifyManifestSignature(bytes, `${full}.asc`, options.gpgKey,
                options.run);
            if (state === 'bad') {
                add(existsSync(`${full}.asc`) ? 'MANIFEST-BAD-SIG' : 'MANIFEST-UNSIGNED',
                    `${MANIFEST_DIR}/${name}`,
                    'not counted toward the baseline');
                // Deliberately NOT folded into the union. A manifest whose
                // signature does not check is exactly what an attacker
                // would plant, so trusting it would turn this sweep into
                // the attacker's alibi.
                continue;
            }
            if (state === 'ok') signaturesChecked += 1;
            if (!existsSync(`${full}.asc`)) {
                add('MANIFEST-UNSIGNED', `${MANIFEST_DIR}/${name}`,
                    'counted toward the baseline, but nothing anchors it to K1');
            }

            manifestCount += 1;
            const { tag, entries } = parseManifestText(bytes.toString('utf8'), name);
            // The RELEASE, not the signature. A re-sign tag
            // (`v0.336.0-resign1`) is the release tag's tree with the release
            // tooling corrected and nothing else, cut because the dev-mock gate
            // that stamps the manifest header comes from the tag and so cannot
            // be fixed for a release already published. Its manifest is
            // republished under the release's own name, and a channel pointer
            // still names the plain version - so recording the header verbatim
            // here would make the corrected manifest read as NO manifest and
            // raise POINTER-NO-MANIFEST against the release that was just
            // repaired. Both spellings are kept: the pointer check asks for the
            // release, and nothing else reads this set.
            tagsSeen.add(tag);
            tagsSeen.add(releaseTagOf(tag));
            for (const [file, hash] of entries) {
                if (!union.has(file)) union.set(file, new Set());
                union.get(file).add(hash);
            }
        }
    }

    // ---- every published file, against that baseline -------------------
    const pointers = [];
    let checked = 0;

    for (const dir of PAYLOAD_DIRS) {
        const full = join(root, dir);
        if (!existsSync(full)) continue;

        for (const name of readdirSync(full).sort()) {
            const file = join(full, name);
            if (!statSync(file).isFile()) continue;
            const rel = `${dir}/${name}`;

            // The text a pointer is CLASSIFIED from is the text it is
            // later judged against, carried on the record rather than
            // re-read below. Two reads of one file is how the manifest
            // lane grew a check/use window, and a pointer is no less
            // writable than a manifest.
            if (name.endsWith('.yml')) {
                const text = readFileSync(file, 'utf8');
                if (isUpdateInfoContent(text)) {
                    pointers.push({ rel, file, dir, kind: 'yml', text });
                    continue;
                }
            }
            // The direct-APK lane's pointer is JSON, not an electron-updater
            // yml, so the test above cannot see it. Classifying it matters
            // twice over: unclassified it would be hashed as payload and
            // reported UNCOVERED forever (no manifest names a pointer, by
            // §7.1 design), and the check it actually needs would never run.
            if (name.endsWith('.json')) {
                const text = readFileSync(file, 'utf8');
                if (isJsonPointerContent(text)) {
                    pointers.push({ rel, file, dir, kind: 'json', text });
                    continue;
                }
            }

            checked += 1;
            const known = union.get(name);
            if (!known) {
                add('UNCOVERED', rel, 'no signed manifest names this file');
                continue;
            }
            const actual = sha256File(file);
            if (!known.has(actual)) {
                add('MISMATCH', rel, `sha256 ${actual} is in no manifest for this name`);
            }
        }
    }

    // ---- the pointers, which no manifest covers by design --------------
    //
    // §7.1 excludes them from the manifest because a rollback re-points
    // them, which would make every rollback look like tampering. That
    // exclusion is safe only if something else checks them, and this is
    // that something.
    //
    // AN EMPTY BASELINE IS A FINDING, NOT A PASS. Both lanes below asked
    // `tagsSeen.size > 0 &&` first until 2026-09-05, so a feed whose
    // manifests were gone disabled the one check that reads its pointers:
    // a tree holding only `android/latest.json` at version 9.9.9 swept
    // clean, 0 findings and exit 0, while that pointer was still sending
    // every direct install at a version whose payload and provenance had
    // both vanished. There is no legitimate feed state it protected. A
    // pointer exists only after a release and a release always publishes
    // a manifest beside it (§7.3, append-only), so "live pointer, no
    // manifests" is precisely the loss this sweep is a record of. The
    // guard was also worst where it mattered most: `tagsSeen` is empty
    // when the --gpg-key anchor REFUSES every manifest entry to the
    // baseline, which is the attacker-plants-a-manifest case the anchor
    // exists to catch.
    for (const { rel, dir, kind, text } of pointers) {
        // A JSON pointer carries a version and nothing else - no file list,
        // no hashes - so only the version check applies to it. Stated rather
        // than silently skipped: this lane's pointer names no bytes, so
        // DANGLING/HASH/UNCOVERED have nothing to read, and the protection
        // that remains is that the version it sends every direct install to
        // must be one a K1-signed manifest actually covers.
        // There is deliberately no POINTER-UNPARSEABLE case here. Carrying a
        // version is what makes a JSON file a pointer at all, so one that
        // lost its version is not an unparseable pointer, it is an
        // unexplained file on the feed - and payload is exactly what it is
        // then treated as, which UNCOVERED reports. Driven: emptying
        // `latest.json` to `{}` moves it from `pointers=1` to
        // `UNCOVERED:android/latest.json`. POINTER-UNREADABLE below is the
        // other question and not that one: the file IS a pointer, and the
        // shipped client still throws it away.
        if (kind === 'json') {
            // ASK THE QUESTION THE CLIENT ASKS FIRST. Structural
            // classification is deliberately lenient so a second lane's
            // pointer is still seen, but leniency here made the sweep
            // report health on feeds every direct install DISCARDS:
            // `{"version":" 1.2.3 "}` was trimmed into a version that
            // matched a real manifest, and a body over the client's
            // 4096-char cap was read straight through it. Both swept
            // clean with zero findings while checkForDirectUpdate
            // returned null, so the one channel a sideloaded install has
            // for a security fix was dead and the record said fine.
            const rejection = directFeedRejection(text);
            if (rejection) {
                add('POINTER-UNREADABLE', rel,
                    `the shipped client discards this feed: ${rejection}`);
                continue;
            }
            const version = parseJsonPointerVersion(text);
            if (!tagsSeen.has(`v${version}`)) {
                add('POINTER-NO-MANIFEST', rel,
                    `names version ${version}, no RELEASE_HASHES/v${version}.txt`);
            }
            continue;
        }

        const info = parseUpdateInfo(text);
        if (!info.version || info.files.length === 0) {
            add('POINTER-UNPARSEABLE', rel, 'no version or no files entry');
            continue;
        }
        if (!tagsSeen.has(`v${info.version}`)) {
            add('POINTER-NO-MANIFEST', rel,
                `names version ${info.version}, no RELEASE_HASHES/v${info.version}.txt`);
        }

        // The payload a yml names sits beside the yml. This was a literal
        // `desktop/` until the lane list grew; deriving it keeps the message
        // honest and cannot change today's readings, since every yml pointer
        // this feed carries lives in desktop/.
        for (const entry of info.files) {
            const target = join(root, dir, entry.url);
            if (!existsSync(target)) {
                add('POINTER-DANGLING', rel, `names ${dir}/${entry.url}, which is absent`);
                continue;
            }
            if (entry.sha512 && sha512File(target) !== entry.sha512) {
                add('POINTER-HASH', rel, `sha512 does not match ${dir}/${entry.url}`);
            }
            if (!union.has(entry.url)) {
                add('POINTER-UNCOVERED', rel,
                    `names ${dir}/${entry.url}, which no signed manifest covers`);
            }
        }
    }

    return {
        findings,
        checked,
        manifests: manifestCount,
        pointers: pointers.length,
        signatureMode: options.gpgKey
            ? `gpg-verified against ${options.gpgKey} (${signaturesChecked} manifest(s))`
            : 'NOT gpg-verified (baseline trusts the directory; see --gpg-key)',
    };
}

// ------------------------------------------------------------------ CLI

const USAGE = `usage: feed-sweep.mjs --root <feed root> [--gpg-key <40-hex fingerprint>] [--json]

Validates every object under a release feed against the UNION of the
signed manifests published beside them (§7.2). Runs on the feed
host, over the local tree, by cron:

  30 * * * * /usr/bin/node /opt/xchain/feed-sweep.mjs \\
    --root /srv/downloads/wallet --gpg-key <K1 full 40-hex fingerprint> \\
    >> /var/log/xchain-feed-sweep.log 2>&1

Exit 0 clean, 1 on any finding, 2 on a usage or environment error.
`;

function main(argv) {
    const flag = (name) => {
        const i = argv.indexOf(name);
        return i === -1 ? undefined : argv[i + 1];
    };

    if (argv.includes('--help') || argv.includes('-h')) {
        process.stdout.write(USAGE);
        return 0;
    }
    const root = flag('--root');
    if (!root) { process.stderr.write(`feed-sweep.mjs: --root is required\n\n${USAGE}`); return 2; }
    if (!existsSync(root)) { process.stderr.write(`feed-sweep.mjs: no such root: ${root}\n`); return 2; }

    // --gpg-key is a FULL fingerprint or it is a usage error. The matcher
    // already refuses anything shorter, but refusing here too is what makes
    // the refusal readable: a short id would otherwise turn every manifest
    // into MANIFEST-BAD-SIG and every file into UNCOVERED, which in a cron
    // log is indistinguishable from a compromised feed, and this file's own
    // rule is that alarms firing during normal operation get muted. The
    // flag being present with no value is the same error, not a silent
    // downgrade to the unanchored mode.
    let gpgKey;
    if (argv.includes('--gpg-key')) {
        gpgKey = String(flag('--gpg-key') ?? '').replace(/\s+/g, '').toUpperCase();
        if (!/^[0-9A-F]{40}$/.test(gpgKey)) {
            process.stderr.write(
                'feed-sweep.mjs: --gpg-key must be a full 40-character fingerprint.\n'
                + '  A short id or an email selects a key without identifying it, and short\n'
                + '  ids are cheap to collide, so the baseline this sweep builds could end up\n'
                + '  anchored to a key that is not K1. Run `gpg --fingerprint <key>` and pass\n'
                + '  the 40 hex characters with the spaces removed.\n');
            return 2;
        }
    }

    const stamp = new Date().toISOString();
    const result = sweep(root, { gpgKey });

    if (argv.includes('--json')) {
        process.stdout.write(`${JSON.stringify({ stamp, root, ...result }, null, 2)}\n`);
        return result.findings.length === 0 ? 0 : 1;
    }

    // One timestamp per LINE, not per run. The log is read months later
    // beside other logs, and a run header scrolls out of the grep that
    // finds the finding.
    for (const f of result.findings) {
        process.stdout.write(`${stamp} ${f.code}  ${f.path}: ${f.detail}\n`);
    }
    process.stdout.write(
        `${stamp} swept ${root}: ${result.checked} artifact(s), ${result.pointers} pointer(s), `
        + `${result.manifests} manifest(s), ${result.findings.length} finding(s); `
        + `${result.signatureMode}\n`);

    return result.findings.length === 0 ? 0 : 1;
}

const invokedDirectly = (() => {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
})();

if (invokedDirectly) process.exit(main(process.argv.slice(2)));
