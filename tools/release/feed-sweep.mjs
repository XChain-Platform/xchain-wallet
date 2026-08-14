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

export function parseManifest(path) {
    const text = readFileSync(path, 'utf8');
    const entries = new Map();
    let tag = '';

    for (const line of text.split('\n')) {
        const header = /^# tag:\s*(.+)$/.exec(line);
        if (header) { tag = header[1].trim(); continue; }
        if (line.startsWith('#') || line.trim() === '') continue;
        const m = /^([0-9a-fA-F]{64})\s\s(.+)$/.exec(line);
        if (!m) continue;
        entries.set(basename(m[2].trim()), m[1].toLowerCase());
    }
    return { tag: tag || basename(path).replace(/\.txt$/, ''), entries };
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
    for (const line of lines) {
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
 * @returns {'ok'|'bad'|'skipped'}
 */
export function verifyManifestSignature(manifestPath, keyFingerprint, run = spawnSync) {
    if (!keyFingerprint) return 'skipped';
    const sig = `${manifestPath}.asc`;
    if (!existsSync(sig)) return 'bad';

    const result = run('gpg', ['--status-fd=1', '--verify', sig, manifestPath], {
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
    const matches = (fpr) => /^[0-9A-F]+$/.test(fpr) && fpr.toUpperCase().endsWith(want);
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

            const state = verifyManifestSignature(full, options.gpgKey, options.run);
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
            const { tag, entries } = parseManifest(full);
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

            if (name.endsWith('.yml') && isUpdateInfoContent(readFileSync(file, 'utf8'))) {
                pointers.push({ rel, file, dir, kind: 'yml' });
                continue;
            }
            // The direct-APK lane's pointer is JSON, not an electron-updater
            // yml, so the test above cannot see it. Classifying it matters
            // twice over: unclassified it would be hashed as payload and
            // reported UNCOVERED forever (no manifest names a pointer, by
            // §7.1 design), and the check it actually needs would never run.
            if (name.endsWith('.json') && isJsonPointerContent(readFileSync(file, 'utf8'))) {
                pointers.push({ rel, file, dir, kind: 'json' });
                continue;
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
    for (const { rel, file, dir, kind } of pointers) {
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
        // `UNCOVERED:android/latest.json`.
        if (kind === 'json') {
            const version = parseJsonPointerVersion(readFileSync(file, 'utf8'));
            if (tagsSeen.size > 0 && !tagsSeen.has(`v${version}`)) {
                add('POINTER-NO-MANIFEST', rel,
                    `names version ${version}, no RELEASE_HASHES/v${version}.txt`);
            }
            continue;
        }

        const info = parseUpdateInfo(readFileSync(file, 'utf8'));
        if (!info.version || info.files.length === 0) {
            add('POINTER-UNPARSEABLE', rel, 'no version or no files entry');
            continue;
        }
        if (tagsSeen.size > 0 && !tagsSeen.has(`v${info.version}`)) {
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

const USAGE = `usage: feed-sweep.mjs --root <feed root> [--gpg-key <fingerprint>] [--json]

Validates every object under a release feed against the UNION of the
signed manifests published beside them (§7.2). Runs on the feed
host, over the local tree, by cron:

  30 * * * * /usr/bin/node /opt/xchain/feed-sweep.mjs \\
    --root /srv/downloads/wallet --gpg-key <K1 fingerprint> \\
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

    const stamp = new Date().toISOString();
    const result = sweep(root, { gpgKey: flag('--gpg-key') });

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
