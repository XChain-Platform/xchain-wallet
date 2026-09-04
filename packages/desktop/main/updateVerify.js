// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Update-manifest verification (S5, decision D5).
//
// THE HOLE THIS CLOSES. electron-updater downloads an artifact and
// checks its SHA512 against the channel pointer (`stable-linux.yml` and
// friends; §7.1). On Windows and macOS the OS
// code-signature check is a genuine second factor, so a bad binary is
// caught even if the feed lies. On Linux there is no such factor: the
// AppImage is unsigned, and the hash it is checked against is served
// from the same host as the binary. So whoever owns
// downloads.xchain.io, or the Cloudflare account in front of it (K12),
// can serve a matching hash for attacker code and silently update every
// Linux desktop user. The yml is not a signature. It is a checksum from
// the same party that served the file.
//
// The fix is the maintainer's GPG signature, checked against a key that
// ships INSIDE the app. That is the whole idea: the trust root travels
// with the binary the user already chose to install, so compromising
// the download host later buys nothing.
//
// ONE KEY, ONE SIGNATURE. This verifies K1's own detached GPG signature
// over `RELEASE_HASHES.txt`, the same file and the same signature that
// `tools/release/verify.sh` checks and that a user checks by hand
// following https://docs.xchain.io/components/wallet/release/verify-release.
// There is no second signing key and
// no second ceremony to forget. The cost is bundling openpgp.js into
// the desktop app, which is a real dependency in a wallet and was an
// explicit operator decision, not an incidental one.
//
// BYTES, NOT TEXT. The manifest is verified as binary. `gpg
// --detach-sign` produces a binary signature (type 0x00), and verifying
// it as text would let openpgp canonicalize line endings, so a CRLF
// variant of the manifest could verify against a signature made over
// the LF original. Exact bytes or nothing.
//
// FAIL CLOSED, ALWAYS. Every path that cannot prove the update is
// authentic returns { ok: false }. There is no "could not check, carry
// on" branch, because that branch is the vulnerability restated.
//
// THE CHANNEL POINTER IS THE SECOND UNAUTHENTICATED INPUT.
// Everything above authenticates the BYTES that were downloaded. Nothing
// authenticated the file that decided which bytes to download: the
// channel pointer (`stable-linux.yml` and friends) is fetched over TLS
// Cloudflare terminates, and every value inside it is internally
// consistent by construction, because whoever serves the binary serves
// its sha512 too. §7.2 accepted that residual for launch; this is
// the deferred half.
//
// COVERED, NOT SIGNED-IN-PLACE, AND THE DIFFERENCE IS DELIBERATE. The
// pointer is excluded from the K1-signed manifest on purpose
// (`tools/release/lib.sh`): a §7.4 rollback re-points it to a PREVIOUS
// release, so a manifest covering the pointer's own bytes would make
// every legitimate rollback look like tampering. A pointer is anchored
// instead by what it NAMES: every file it lists must appear in the
// K1-signed manifest for the version it declares, and the file this
// install actually downloaded must be one of them, at the sha512 the
// pointer claims. That is the same test `tools/release/feed-sweep.mjs`
// applies on the host as POINTER-UNCOVERED, moved to the one place that
// can refuse an install rather than write a log line.
//
// WHAT IT BUYS, STATED HONESTLY. It does not remove the feed from the
// TCB, and §7.2 never claimed a verifier would. It removes the pointer
// from the set of inputs an attacker can author freely: a validly-hashed
// pointer naming anything K1 did not sign for that version is refused
// before install, so a feed-level attacker is confined to artifacts K1
// signed. Version FREEZE (replaying an older genuinely-signed pointer)
// is outside what any per-release signature can answer and stays open.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import * as openpgp from 'openpgp';

/**
 * The maintainer's release public key (K1), ASCII-armored.
 *
 * EMPTY UNTIL THE KEY CEREMONY RUNS (S3). While it is empty every
 * verification fails with `update-key-not-pinned`, so the desktop app
 * cannot self-update. That is correct rather than unfortunate: there are
 * no signed releases to update to yet either (G180), and the ordering is
 * ceremony, then pin, then build, then first release. Shipping a build
 * with this empty and an install path that ignored it would be the
 * actual bug.
 *
 * Paste the output of `gpg --armor --export <fingerprint>` here. It must
 * include the signing subkey: K1's primary key is certify-only and lives
 * offline, so the signature is made by the subkey and verified through
 * the primary.
 *
 * Rotating this key means shipping a wallet update. That is what pinning
 * costs and what it buys.
 */
export const UPDATE_PINNED_PUBKEY_ARMORED = '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nmDMEanQNkhYJKwYBBAHaRw8BAQdAJRcbWezADtAe44CMZDuthZ3B5kZp+LyqxCsS\ny5iSM9+0NFhDaGFpbiBXYWxsZXQgUmVsZWFzZSBTaWduaW5nIDxyZWxlYXNlc0Bk\nYW5rZXN0LmxsYz6ItQQTFgoAXRYhBBop58TCKPDlXUCow7Ww5a2v2nznBQJqdA2S\nGxSAAAAAAAQADm1hbnUyLDIuNSsxLjEyLDAsMwIbAQUJA8JnAAULCQgHAgIiAgYV\nCgkICwIEFgIDAQIeBwIXgAAKCRC1sOWtr9p85zWCAQC+MgPXFdCRpMEDkcqeJypa\n9fxTsJPb3cUJKPsfHN0yIwEAxYmjQ2Syu8uxPRUIOn2tIOL9NR54ZHatrMb+dN5N\n7wu4MwRqdA2bFgkrBgEEAdpHDwEBB0B9igf82CjFb/Lzz/FwMIhPlyLqgwMGKxwn\nhiH6LEX5SYkBEQQYFgoAQhYhBBop58TCKPDlXUCow7Ww5a2v2nznBQJqdA2bGxSA\nAAAAAAQADm1hbnUyLDIuNSsxLjEyLDAsMwIbAgUJA8JnAACBCRC1sOWtr9p853Yg\nBBkWCgAdFiEEJ6FZNgfIKJA+9n2tEK33mJm0FXMFAmp0DZsACgkQEK33mJm0FXNr\n+gD9FJRaj0xvax+379J08dxoyswgCdiSJ2JFXJm54dyiPh0A/3cZAJRZK4qBIFer\n/i1XsEZz9yGYTyZ05hVwWoNE/M8B2EoBAJ9P/Fzuj9V+bI+KqxugnuqG7/d+qWlm\ny7XRQuGi81pbAQCTIZQe/aM+Ph+jzExxMDAqX91DORgoS3fqaOiC/rxZAw==\n=jPNC\n-----END PGP PUBLIC KEY BLOCK-----\n';

/**
 * K1's PRIMARY key fingerprint, uppercase hex, no spaces.
 *
 * Cross-checks the armored block above against the fingerprint published
 * in SECURITY.md and on xchain.io. Pinning the key alone would be
 * enough cryptographically; pinning the fingerprint too means a swapped
 * armored block fails loudly here instead of silently trusting whatever
 * key someone pasted in.
 */
export const UPDATE_PINNED_FINGERPRINT = '1A29E7C4C228F0E55D40A8C3B5B0E5ADAFDA7CE7';

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const MANIFEST_LINE = /^([0-9a-f]{64}) {2}(.+)$/i;

/**
 * Verify K1's detached signature over the manifest bytes.
 *
 * @param {Uint8Array|Buffer} manifestBytes  the manifest exactly as served
 * @param {string} armoredSignature          contents of RELEASE_HASHES.txt.asc
 * @param {Object} [pinned]
 * @param {string} [pinned.armoredKey]
 * @param {string} [pinned.fingerprint]
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function verifyManifestSignature(manifestBytes, armoredSignature, pinned = {}) {
    const armoredKey = pinned.armoredKey ?? UPDATE_PINNED_PUBKEY_ARMORED;
    const wantFingerprint = (pinned.fingerprint ?? UPDATE_PINNED_FINGERPRINT)
        .replace(/\s+/g, '').toUpperCase();

    if (!armoredKey || !armoredKey.trim()) return { ok: false, reason: 'update-key-not-pinned' };
    if (!manifestBytes || manifestBytes.length === 0) {
        return { ok: false, reason: 'empty manifest' };
    }
    if (typeof armoredSignature !== 'string' || !armoredSignature.includes('BEGIN PGP SIGNATURE')) {
        return { ok: false, reason: 'missing or malformed signature' };
    }

    let key;
    try {
        key = await openpgp.readKey({ armoredKey });
    } catch {
        return { ok: false, reason: 'pinned key is not a valid OpenPGP key' };
    }

    if (wantFingerprint && key.getFingerprint().toUpperCase() !== wantFingerprint) {
        return { ok: false, reason: 'pinned key does not match the pinned fingerprint' };
    }

    let signature;
    try {
        signature = await openpgp.readSignature({ armoredSignature });
    } catch {
        return { ok: false, reason: 'signature is not readable' };
    }

    try {
        const result = await openpgp.verify({
            message: await openpgp.createMessage({ binary: new Uint8Array(manifestBytes) }),
            signature,
            verificationKeys: key,
            // Reject a signature whose issuer is not the pinned key
            // rather than reporting it unverified alongside a good one.
            expectSigned: true,
        });
        // openpgp reports failure by REJECTING this promise, not by
        // resolving false. Awaiting it outside a try would surface a bad
        // signature as an unhandled rejection, which in the main process
        // is a crash rather than a refusal.
        await result.signatures[0].verified;
    } catch (err) {
        return { ok: false, reason: `signature does not verify: ${String(err?.message || err)}` };
    }

    return { ok: true };
}

/**
 * Parse a release manifest into its header fields and hash lines.
 * Mirrors `tools/release/lib.sh`, deliberately: the two must agree on
 * what a manifest is, and the shape is pinned by tests on both sides.
 *
 * @param {string} manifestText
 * @returns {{ ok: boolean, reason?: string, header?: Record<string,string>, entries?: Map<string,string> }}
 */
export function parseManifest(manifestText) {
    if (typeof manifestText !== 'string' || !manifestText.trim()) {
        return { ok: false, reason: 'empty manifest' };
    }
    const header = {};
    const entries = new Map();
    for (const rawLine of manifestText.split('\n')) {
        const line = rawLine.replace(/\r$/, '');
        if (!line.trim()) continue;
        if (line.startsWith('#')) {
            const i = line.indexOf(': ');
            if (i > 1) header[line.slice(2, i).trim()] = line.slice(i + 2).trim();
            continue;
        }
        const m = MANIFEST_LINE.exec(line);
        // A malformed line is fatal rather than skipped. Checksum tools
        // skip them and still report success (macOS /sbin/sha256sum
        // exits 0 having verified nothing), which is exactly how a
        // manifest can look checked without being checked.
        if (!m) return { ok: false, reason: 'malformed manifest line' };
        entries.set(normalizeName(m[2]), m[1].toLowerCase());
    }
    if (!header['manifest-version']) return { ok: false, reason: 'manifest has no header' };
    if (entries.size === 0) return { ok: false, reason: 'manifest covers no artifacts' };

    // The header's own count must match. Catches truncation, which
    // otherwise leaves a perfectly valid-looking manifest that simply
    // stops before the artifact you care about.
    const claimed = Number(header.artifacts);
    if (!Number.isInteger(claimed) || claimed !== entries.size) {
        return { ok: false, reason: `manifest claims ${header.artifacts} artifacts but carries ${entries.size}` };
    }
    return { ok: true, header, entries };
}

/** Manifest paths are written `./name`; compare on the bare name. */
function normalizeName(name) {
    return String(name).replace(/^\.\//, '').trim();
}

/**
 * Which RELEASE a manifest tag names, with any re-sign suffix stripped.
 *
 * A re-sign tag is `<release tag>-resign<N>`: the release tag's tree with
 * the release TOOLING corrected and nothing else, cut because the gate
 * that stamps a manifest header comes from the tag and cannot be fixed
 * for a release already published. Its corrected manifest is republished
 * under the release's own name (`RELEASE_HASHES/v0.336.0.txt`) while its
 * header says `v0.336.0-resign1`, and electron-updater only ever reports
 * the plain version - so a verbatim comparison here refuses every install
 * of a release whose signature record was repaired.
 *
 * Two other spellings of this rule exist, `xr_release_tag_of` in
 * `tools/release/lib.sh` and `releaseTagOf` in
 * `tools/release/feed-sweep.mjs`; this one is local rather than imported
 * because this file is bundled into the Electron main process and today
 * imports only node builtins and openpgp.
 *
 * @param {string} tag
 * @returns {string}
 */
export function releaseTagOf(tag) {
    return String(tag).replace(/-resign\d+$/, '');
}

/**
 * The channel pointer THIS build fetches, by electron-builder's rule.
 *
 * `<channel><osSuffix><archSuffix>.yml`, where osSuffix is empty on
 * Windows, `-mac` on macOS and `-linux` on Linux, and archSuffix appears
 * only on non-x64 Linux (§7.1, pinned upstream by
 * `tools/release/update-info.mjs`). The name is DERIVED rather than read
 * off the feed on purpose: the whole point is to fetch the same pointer
 * electron-updater fetched, and a name taken from anything the feed says
 * would let the feed choose which pointer gets checked.
 *
 * Node spells armv7 `arm`, which is also upstream's suffix for it, so no
 * special case is needed here; if that ever diverges the smoke test over
 * the installed app-builder-lib is what says so.
 *
 * @param {Object} params
 * @param {string} params.channel   e.g. 'stable'
 * @param {string} params.platform  a `process.platform` value
 * @param {string} params.arch      a `process.arch` value
 * @returns {string|null} the pointer filename, or null if it cannot be named
 */
export function channelPointerName({ channel, platform, arch }) {
    const ch = String(channel ?? '').trim();
    // A channel with a slash or a dot segment would escape the feed
    // directory when pasted into a URL. Refuse rather than sanitize.
    if (!ch || !/^[A-Za-z0-9._-]+$/.test(ch) || ch.includes('..')) return null;

    if (platform === 'win32') return `${ch}.yml`;
    if (platform === 'darwin') return `${ch}-mac.yml`;
    if (platform !== 'linux') return null;
    if (arch === 'x64') return `${ch}-linux.yml`;
    if (!arch || !/^[a-z0-9]+$/.test(String(arch))) return null;
    return `${ch}-linux-${arch}.yml`;
}

/**
 * The release LANE this install belongs to, in `shipped-lanes.txt`'s
 * vocabulary, derived from `process.platform` alone.
 *
 * Same rule the pointer name already follows: never taken from anything
 * the feed returned, because a lane the feed can choose is a lane an
 * attacker can choose. Returns null for a platform that names no desktop
 * lane, which the gate treats as "cannot answer" and refuses on.
 *
 * @param {Object} params
 * @param {string} params.platform  a `process.platform` value
 * @returns {string|null}
 */
export function platformLaneName({ platform }) {
    if (platform === 'darwin') return 'mac';
    if (platform === 'linux') return 'linux';
    if (platform === 'win32') return 'windows';
    return null;
}

/**
 * Parse an electron-updater channel pointer into the claims that decide
 * what gets installed.
 *
 * Ported from `tools/release/feed-sweep.mjs`'s `parseUpdateInfo` so the
 * host-side sweep and the client-side gate read a pointer the same way;
 * they are two applications of one rule, and a pointer that means
 * different things to them is a hole in whichever reads it more loosely.
 *
 * The top-level `path:`/`sha512:` pair is recorded as another file entry
 * when `files:` did not already name it, so editing the legacy pair alone
 * cannot slip past a check that only walks `files:`.
 *
 * @param {string} pointerText
 * @returns {{ ok: boolean, reason?: string, version?: string,
 *             files?: Array<{ url: string, sha512: string }> }}
 */
export function parseChannelPointer(pointerText) {
    if (typeof pointerText !== 'string' || !pointerText.trim()) {
        return { ok: false, reason: 'empty channel pointer' };
    }
    const unquote = (v) => v.trim().replace(/^['"]|['"]$/g, '');
    const files = [];
    let version = '';
    let current = null;

    for (const rawLine of pointerText.split('\n')) {
        const line = rawLine.replace(/\r$/, '');

        const versionMatch = /^version:\s*(.+)$/.exec(line);
        if (versionMatch) { version = unquote(versionMatch[1]); continue; }

        const urlMatch = /^\s+-\s+url:\s*(.+)$/.exec(line);
        if (urlMatch) {
            current = { url: unquote(urlMatch[1]), sha512: '' };
            files.push(current);
            continue;
        }
        const nestedSha = /^\s+sha512:\s*(.+)$/.exec(line);
        if (nestedSha && current) { current.sha512 = unquote(nestedSha[1]); continue; }

        const pathMatch = /^path:\s*(.+)$/.exec(line);
        if (pathMatch) {
            current = null;
            const name = unquote(pathMatch[1]);
            if (!files.some((f) => f.url === name)) files.push({ url: name, sha512: '' });
            continue;
        }
        const topSha = /^sha512:\s*(.+)$/.exec(line);
        if (topSha) {
            const last = files[files.length - 1];
            if (last && !last.sha512) last.sha512 = unquote(topSha[1]);
        }
    }

    if (!version) return { ok: false, reason: 'channel pointer declares no version' };
    if (files.length === 0) return { ok: false, reason: 'channel pointer names no files' };
    return { ok: true, version, files };
}

/**
 * Anchor the channel pointer to the K1-signed manifest.
 *
 * Three questions, and a no to any one of them refuses the install:
 *
 *   1. Does this pointer describe the update in hand? Its `version` must
 *      be the version being installed. This is what makes re-fetching the
 *      pointer safe: a feed that serves the verifier a different pointer
 *      than it served the checker gets a refusal, not a second opinion.
 *   2. Does it name the file we downloaded, at the hash it claims? The
 *      sha512 is recomputed from the bytes on disk rather than taken from
 *      electron-updater, so this is a check and not a restatement.
 *   3. Is EVERY file it names covered by the signed manifest? Not just
 *      the one downloaded: a pointer listing an uncovered artifact
 *      alongside a covered one has already been tampered with, and the
 *      lane that would fetch the other entry is somebody else's install.
 *
 * @param {Object} params
 * @param {string} params.pointerText     the pointer exactly as served
 * @param {string} params.expectedVersion the version being installed, no leading `v`
 * @param {string} params.artifactName    basename of the downloaded file
 * @param {string} params.artifactSha512  its SHA-512, lowercase hex
 * @param {Map<string,string>} params.entries  the signed manifest's entries
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifyChannelPointer({
    pointerText,
    expectedVersion,
    artifactName,
    artifactSha512,
    entries,
}) {
    const parsed = parseChannelPointer(pointerText);
    if (!parsed.ok) return parsed;

    const want = String(expectedVersion ?? '').trim().replace(/^v/, '');
    if (!want) return { ok: false, reason: 'no version to check the channel pointer against' };
    if (parsed.version !== want) {
        return {
            ok: false,
            reason: `channel pointer describes ${parsed.version}, not ${want}`,
        };
    }

    const name = normalizeName(artifactName);
    const entry = parsed.files.find((f) => normalizeName(f.url) === name);
    if (!entry) {
        return { ok: false, reason: `channel pointer does not name ${name}` };
    }
    const actual = String(artifactSha512 ?? '').toLowerCase();
    if (!HEX128.test(actual)) {
        return { ok: false, reason: 'downloaded artifact hash is malformed' };
    }
    // Base64 is electron-updater's spelling for the pointer's sha512, and
    // hex is everyone else's. Normalize to hex rather than accepting
    // whichever form happens to compare equal.
    const claimed = normalizeSha512(entry.sha512);
    if (!claimed) return { ok: false, reason: `channel pointer carries no sha512 for ${name}` };
    if (claimed !== actual) {
        return { ok: false, reason: `channel pointer's sha512 for ${name} is not the file that arrived` };
    }

    for (const file of parsed.files) {
        const listed = normalizeName(file.url);
        if (!entries?.has?.(listed)) {
            return {
                ok: false,
                reason: `channel pointer names ${listed}, which the signed manifest does not cover`,
            };
        }
    }

    return { ok: true };
}

/**
 * A pointer's sha512 in lowercase hex, whatever form it was written in.
 * Returns '' when it is neither of the two shapes, which the caller
 * treats as absent rather than guessing.
 */
function normalizeSha512(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (HEX128.test(raw.toLowerCase())) return raw.toLowerCase();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return '';
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length !== 64) return '';
    return decoded.toString('hex');
}

/**
 * The whole gate: is this downloaded file the artifact the maintainer
 * signed for this exact version?
 *
 * @param {Object} params
 * @param {Uint8Array|Buffer} params.manifestBytes
 * @param {string} params.armoredSignature
 * @param {string} params.expectedTag     the version about to be installed, e.g. 'v0.334.0'
 * @param {string} params.artifactPath    path of the file electron-updater downloaded
 * @param {string} params.artifactSha256  its SHA-256, lowercase hex
 * @param {string} params.artifactSha512  its SHA-512, lowercase hex (the pointer's spelling)
 * @param {string} params.pointerText     the channel pointer exactly as served
 * @param {string} params.lane            this install's release lane, from `platformLaneName`
 * @param {Object} [params.pinned]        { armoredKey, fingerprint } override, for tests
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function verifyDownloadedUpdate({
    manifestBytes,
    armoredSignature,
    expectedTag,
    artifactPath,
    artifactSha256,
    artifactSha512,
    pointerText,
    lane,
    pinned,
}) {
    const artifact = await verifyDownloadedArtifact({
        manifestBytes, armoredSignature, expectedTag, artifactPath, artifactSha256, lane, pinned,
    });
    if (!artifact.ok) return { ok: false, reason: artifact.reason };

    // And last, the file that chose all of the above. Required,
    // not optional: an absent pointer is the one an attacker serves, so
    // treating "none supplied" as "nothing to check" would hand them the
    // branch this whole file exists to remove.
    return verifyChannelPointer({
        pointerText,
        expectedVersion: artifact.tag,
        artifactName: artifact.artifactName,
        artifactSha512,
        entries: artifact.entries,
    });
}

/**
 * The artifact half, for the one update lane that has no channel pointer.
 *
 * ANDROID IS THAT LANE, and this export exists so its exemption is a
 * named decision rather than an argument someone forgot. The direct APK
 * lane is not electron-updater: there is no `<channel>*.yml` directing
 * it, the signed manifest names the APK itself, and the OS re-checks the
 * package signature at install. `verifyDownloadedUpdate` above is the
 * desktop path and demands a pointer, so a desktop caller cannot reach
 * this weaker gate by omission - it has to ask for it by name.
 *
 * Returns the parsed manifest alongside the verdict so the caller that
 * DOES have a pointer is not parsing a verified manifest twice.
 *
 * @param {Object} params  as `verifyDownloadedUpdate`, minus the pointer
 * @returns {Promise<{ ok: boolean, reason?: string, tag?: string,
 *                     artifactName?: string, entries?: Map<string,string> }>}
 */
export async function verifyDownloadedArtifact({
    manifestBytes,
    armoredSignature,
    expectedTag,
    artifactPath,
    artifactSha256,
    lane,
    pinned,
}) {
    // Signature first. Nothing parsed out of an unauthenticated manifest
    // is worth reasoning about, including its own error messages.
    const sigResult = await verifyManifestSignature(manifestBytes, armoredSignature, pinned ?? {});
    if (!sigResult.ok) return sigResult;

    const parsed = parseManifest(Buffer.from(manifestBytes).toString('utf8'));
    if (!parsed.ok) return parsed;

    // The manifest must describe the version being installed. Without
    // this, a genuinely signed manifest from an OLD release verifies
    // perfectly, and a feed that serves the old binary alongside it
    // downgrades the user onto a version whose vulnerabilities are
    // public. A valid signature is not an answer to "which release".
    // A re-signature answers a request for its release, and the relation
    // is ONE-WAY (`tools/release/verify.sh` anchor block, `lib.sh`
    // xr_release_tag_of): the superseded original must NOT answer a
    // request for the re-signature, so only the HEADER tag is normalized.
    const tag = String(expectedTag ?? '').trim();
    if (!tag) return { ok: false, reason: 'no version to check the manifest against' };
    if (parsed.header.tag !== tag && releaseTagOf(parsed.header.tag) !== tag) {
        return { ok: false, reason: `manifest describes ${parsed.header.tag}, not ${tag}` };
    }

    // A PARTIAL manifest speaks for the lanes it names, and for no
    // others. `sign.sh --lane` gates one lane's artifacts on their own,
    // so the question is coverage, not partiality: does `# lanes:` name
    // the lane this install belongs to? Asking "is it partial" instead
    // refused the desktop lanes themselves once they became nameable
    // (`shipped-lanes.txt` flipped mac and linux to SHIPPED with an
    // `updater` feed), which is every update those installs can be
    // offered. The hash lookup below would refuse a wrong-lane manifest
    // anyway, but with `not covered by the signed manifest`, which reads
    // as a tampered release rather than as the wrong manifest. Refuse it
    // by name instead, before the reason gets confusing.
    if (parsed.header.lanes) {
        const covered = String(parsed.header.lanes).trim().split(/\s+/).filter(Boolean);
        const want = String(lane ?? '').trim();
        // Fail SHUT on a caller that cannot name its lane. Falling
        // through would hand a partial manifest the full-release path.
        if (!want) {
            return { ok: false, reason: `manifest covers the ${covered.join(' ')} lane(s), and this build cannot name its own` };
        }
        if (!covered.includes(want)) {
            return { ok: false, reason: `manifest covers the ${covered.join(' ')} lane(s), not ${want}` };
        }
    }

    // The gate that was skipped at signing time is not one to inherit.
    if (parsed.header['dev-mock-gate'] !== 'enforced') {
        return { ok: false, reason: `release was signed with the dev-mock gate ${parsed.header['dev-mock-gate'] || 'unrecorded'}` };
    }

    const name = normalizeName(basename(String(artifactPath ?? '')));
    if (!name) return { ok: false, reason: 'no artifact to check' };
    const expected = parsed.entries.get(name);
    if (!expected) return { ok: false, reason: `${name} is not covered by the signed manifest` };

    const actual = String(artifactSha256 ?? '').toLowerCase();
    if (!HEX64.test(actual)) return { ok: false, reason: 'artifact hash is malformed' };
    if (actual !== expected) return { ok: false, reason: `${name} does not match the signed hash` };

    return { ok: true, tag, artifactName: name, entries: parsed.entries };
}

/** SHA-256 of a file on disk, lowercase hex. */
export async function sha256File(path) {
    const buf = await readFile(path);
    return createHash('sha256').update(buf).digest('hex');
}

/** SHA-512 of a file on disk, lowercase hex. The pointer's spelling. */
export async function sha512File(path) {
    const buf = await readFile(path);
    return createHash('sha512').update(buf).digest('hex');
}

/**
 * Fetch the channel pointer this build follows.
 *
 * Same host, same lack of trust, same answer as `fetchReleaseManifest`:
 * where the bytes came from decides nothing, what covers them decides
 * everything. The URL is built from the derived pointer NAME rather than
 * from anything the feed returned, so the feed cannot pick which pointer
 * is examined.
 *
 * `cache: 'no-store'` because the feed serves pointers `no-store` (§7.3)
 * and a cached copy here would be a second answer to a question that must
 * have one. Passed as a plain option so a `fetch` stand-in that ignores
 * it still behaves.
 *
 * @param {Object} params
 * @param {string} params.feedBaseUrl  e.g. 'https://downloads.xchain.io/wallet/'
 * @param {string} params.pointerName  e.g. 'stable-linux.yml'
 * @param {typeof fetch} [params.fetch]
 * @returns {Promise<{ ok: boolean, reason?: string, pointerText?: string }>}
 */
export async function fetchChannelPointer({ feedBaseUrl, pointerName, fetch: fetchImpl }) {
    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) return { ok: false, reason: 'no fetch implementation available' };

    const name = String(pointerName ?? '').trim();
    if (!name || !/^[A-Za-z0-9._-]+\.yml$/.test(name) || name.includes('..')) {
        return { ok: false, reason: 'this build cannot name its own channel pointer' };
    }
    const base = String(feedBaseUrl ?? '').replace(/\/*$/, '/');
    if (!base.startsWith('https://')) {
        return { ok: false, reason: 'update feed must be https' };
    }

    try {
        const res = await doFetch(`${base}desktop/${name}`, { cache: 'no-store' });
        if (!res?.ok) {
            return { ok: false, reason: `channel pointer fetch failed (${res?.status ?? 'no response'})` };
        }
        return { ok: true, pointerText: await res.text() };
    } catch (err) {
        return { ok: false, reason: `channel pointer unreachable: ${String(err?.message || err)}` };
    }
}

/**
 * Fetch the signed manifest and its detached signature for a release.
 *
 * Both come from the update feed, which is exactly the host we do not
 * trust. That is fine and is the point: the signature is what makes the
 * bytes trustworthy, not where they came from.
 *
 * The manifest is kept as BYTES. Round-tripping it through a string and
 * back would risk changing what is verified.
 *
 * @param {Object} params
 * @param {string} params.feedBaseUrl  e.g. 'https://downloads.xchain.io/wallet/'
 * @param {string} params.tag          e.g. 'v0.334.0'
 * @param {typeof fetch} [params.fetch]
 * @returns {Promise<{ ok: boolean, reason?: string, manifestBytes?: Uint8Array, armoredSignature?: string }>}
 */
export async function fetchReleaseManifest({ feedBaseUrl, tag, fetch: fetchImpl }) {
    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) return { ok: false, reason: 'no fetch implementation available' };
    const base = String(feedBaseUrl ?? '').replace(/\/*$/, '/');
    if (!base.startsWith('https://')) {
        return { ok: false, reason: 'update feed must be https' };
    }
    const manifestUrl = `${base}RELEASE_HASHES/${tag}.txt`;
    const sigUrl = `${manifestUrl}.asc`;
    try {
        const [mRes, sRes] = await Promise.all([doFetch(manifestUrl), doFetch(sigUrl)]);
        if (!mRes?.ok) return { ok: false, reason: `manifest fetch failed (${mRes?.status ?? 'no response'})` };
        if (!sRes?.ok) return { ok: false, reason: `signature fetch failed (${sRes?.status ?? 'no response'})` };
        return {
            ok: true,
            manifestBytes: new Uint8Array(await mRes.arrayBuffer()),
            armoredSignature: await sRes.text(),
        };
    } catch (err) {
        return { ok: false, reason: `update manifest unreachable: ${String(err?.message || err)}` };
    }
}
