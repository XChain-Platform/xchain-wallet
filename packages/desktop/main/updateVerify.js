// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Update-manifest verification ( S5, decision D5).
//
// THE HOLE THIS CLOSES. electron-updater downloads an artifact and
// checks its SHA512 against the channel pointer (`stable-linux.yml` and
// friends;  §7.1). On Windows and macOS the OS
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

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import * as openpgp from 'openpgp';

/**
 * The maintainer's release public key (K1), ASCII-armored.
 *
 * EMPTY UNTIL THE KEY CEREMONY RUNS ( S3). While it is empty every
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
 * The whole gate: is this downloaded file the artifact the maintainer
 * signed for this exact version?
 *
 * @param {Object} params
 * @param {Uint8Array|Buffer} params.manifestBytes
 * @param {string} params.armoredSignature
 * @param {string} params.expectedTag     the version about to be installed, e.g. 'v0.334.0'
 * @param {string} params.artifactPath    path of the file electron-updater downloaded
 * @param {string} params.artifactSha256  its SHA-256, lowercase hex
 * @param {Object} [params.pinned]        { armoredKey, fingerprint } override, for tests
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function verifyDownloadedUpdate({
    manifestBytes,
    armoredSignature,
    expectedTag,
    artifactPath,
    artifactSha256,
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
    const tag = String(expectedTag ?? '').trim();
    if (!tag) return { ok: false, reason: 'no version to check the manifest against' };
    if (parsed.header.tag !== tag) {
        return { ok: false, reason: `manifest describes ${parsed.header.tag}, not ${tag}` };
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

    return { ok: true };
}

/** SHA-256 of a file on disk, lowercase hex. */
export async function sha256File(path) {
    const buf = await readFile(path);
    return createHash('sha256').update(buf).digest('hex');
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
