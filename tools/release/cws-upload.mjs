#!/usr/bin/env node
/*********************************************************************
 *
 * Copyright © 2025-2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC - https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 *
 *********************************************************************/

// tools/release/cws-upload.mjs - upload a release zip to the Chrome Web
// Store through the store's own API (D4).
//
// WHY THIS EXISTS, AND WHY IT REFUSES MORE THAN IT DOES.
//
// D4 was recommended NOT YET for two stages, on the grounds that console
// uploads work and an OAuth credential adds a key to custody for no
// benefit. The operator decided to build it on 2026-08-06, so the
// credential is real and the reasoning that kept it out no longer applies.
// What DOES still apply is the reason the recommendation was cautious:
// a refresh token that can publish to the Chrome Web Store is, functionally,
// the publisher account. The dominant real-world extension compromise is not
// a code vulnerability, it is a phished publisher pushing a malicious update
// (the December 2024 Cyberhaven wave was OAuth phishing). Automating uploads
// creates exactly that credential, so this tool is written to be the
// narrowest thing that can do the job:
//
//   - It reads credentials from the environment and NEVER writes them
//     anywhere, not to a log line, not to an error message, not to a
//     temporary file. The only thing it ever says about a credential is
//     whether it was present.
//   - It refuses to upload a zip that is not covered by a SIGNED release
//     manifest, where SIGNED means the detached signature VERIFIES and the
//     key that made it is the pinned release key. Automation that can upload
//     any file on disk would undo the entire provenance chain ceremony Phase 4
//     exists to enforce: the whole point there is that the uploaded artifact
//     is the CI-built, hash-checked, K1-signed one, and a convenient script
//     that skips it is how that rule stops being true.
//     Until 2026-08-15 this gate read the signature as a stat() of the .asc
//     file, so a zero-byte or arbitrary one satisfied it and 'signed' in the
//     output meant a file existed. That is the same gap S37 closed in
//     verify.sh, on the same .asc, against the same key.
//   - It refuses to publish PUBLICLY unless told twice. This spec's
//     first-submission rule is UNLISTED, and D3 (answered 2026-08-06) puts
//     every later release through a beta soak first, so "publish to the
//     world" is never the routine path and must not be the easy default.
//
// The store's API is two calls: PUT the package, then POST publish. The
// upload alone changes nothing users can see, which is why --publish is
// separate and opt-in rather than implied.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The re-sign rule, in its one JS home. `xr_release_tag_of` in lib.sh is the
// bash half and release-resign-tag.smoke.js drives both spellings over one
// table, so importing it is what stops a third spelling appearing here.
import { releaseTagOf } from './feed-sweep.mjs';

// The one value in this repo that only an observed signing run can write
// (verify-release-key.sh drove the real pipeline to set it). It is not a
// publication channel for the fingerprint - SECURITY.md and
// https://xchain.io/security are the two channels - it is the in-repo copy
// verify.sh already reads, so both readers of a manifest signature bind to
// the same key.
const PIN_FILE = fileURLToPath(new URL('../../docs/release-key-pin.json', import.meta.url));

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = (id) => `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${id}`;
const PUBLISH_URL = (id, target) =>
    `https://www.googleapis.com/chromewebstore/v1.1/items/${id}/publish?publishTarget=${target}`;

// The two the store accepts. `trustedTesters` is the beta item's lane and is
// the default here on purpose: see the publish guard below.
export const PUBLISH_TARGETS = ['trustedTesters', 'default'];

export const USAGE = `cws-upload.mjs - upload a signed release zip to the Chrome Web Store

Usage:
  node tools/release/cws-upload.mjs --item-id <id> --zip <path> [options]

Options:
  --item-id <id>        the store-assigned extension ID           (required)
  --zip <path>          the release zip to upload                 (required)
  --tag <vX.Y.Z>        the release these bytes belong to         (required)
  --publish <target>    also publish: trustedTesters | default    (optional)
  --yes-really-public   required alongside --publish default
  --manifest <path>     RELEASE_HASHES.txt covering the zip
                        (default: RELEASE_HASHES.txt beside the zip)
  --allow-unsigned      accept a manifest whose signature is missing, or
                        does not verify, or is not from the release key
  --dry-run             do every check, then stop before the network
  -h, --help            print this and exit 0

The manifest's detached signature is verified with gpg and bound to the
release key's fingerprint (XCHAIN_VERIFY_KEY, else docs/release-key-pin.json).
A good signature from any OTHER key is refused: this project has three GPG
keys in its orbit and they are not interchangeable.

--tag is what binds the manifest to a RELEASE, and it is required for the
same reason deploy-web.sh requires it: a previous release's zip beside that
release's own signed manifest passes both the signature and the hash checks,
because the pair agrees with itself. Only an anchor named from outside the
pair can tell one release from another.

Credentials, read from the environment and never written anywhere:
  CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN

These belong to a FIRST-PARTY OAuth client owned by the same organization as
the publisher account. Spec section 6: "the publisher identity grants OAuth to
no third-party tools, ever." A refresh token that can publish is the publisher
account for practical purposes, so it gets a custody row of its own.

Exit codes: 0 done, 1 refused (a check failed), 2 config error (credentials or
arguments), 3 the store's API rejected the request.
`;

/** Thrown for anything that should exit non-zero with a clean message. */
export class Refusal extends Error {
    constructor(message, code = 1) {
        super(message);
        this.code = code;
    }
}

/**
 * Parse argv. Pure, so the tests can drive every branch without a network
 * or a credential in sight.
 *
 * @param {string[]} argv
 * @returns {Record<string, unknown>}
 */
export function parseArgs(argv) {
    const out = {
        itemId: '', zip: '', publish: '', manifest: '', tag: '',
        dryRun: false, allowUnsigned: false, yesReallyPublic: false, help: false,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        const next = () => {
            const v = argv[i + 1];
            if (v === undefined || v.startsWith('--')) {
                throw new Refusal(`${a} needs a value`, 2);
            }
            i += 1;
            return v;
        };
        switch (a) {
            case '-h': case '--help': out.help = true; break;
            case '--item-id': out.itemId = next(); break;
            case '--zip': out.zip = next(); break;
            case '--manifest': out.manifest = next(); break;
            case '--tag': out.tag = next(); break;
            case '--publish': out.publish = next(); break;
            case '--dry-run': out.dryRun = true; break;
            case '--allow-unsigned': out.allowUnsigned = true; break;
            case '--yes-really-public': out.yesReallyPublic = true; break;
            default: throw new Refusal(`unknown argument: ${a} (try --help)`, 2);
        }
    }
    return out;
}

/**
 * The publish guard, separated out because it is the one rule here that is a
 * POLICY rather than a mechanic, and policies are what rot silently.
 *
 * Publishing to `default` makes the listing public to everyone. The spec's
 * first submission is UNLISTED and every release after it soaks in the beta
 * item first (D3), so a public publish is always a deliberate act and never
 * the shape of a routine command.
 *
 * @param {string} target
 * @param {boolean} yesReallyPublic
 */
export function checkPublishTarget(target, yesReallyPublic) {
    if (!target) return;
    if (!PUBLISH_TARGETS.includes(target)) {
        throw new Refusal(
            `--publish ${JSON.stringify(target)} is not a publish target; expected one of `
            + PUBLISH_TARGETS.join(', '), 2,
        );
    }
    if (target === 'default' && !yesReallyPublic) {
        throw new Refusal(
            'refusing to publish PUBLICLY without --yes-really-public.\n'
            + '  The first submission is unlisted by rule, and every release after it soaks in the\n'
            + '  beta item first, so publishing to the world is never the routine path. If you mean\n'
            + '  it, say so twice.', 1,
        );
    }
}

/**
 * Which credentials are present. Returns names only: the values must never
 * leave this function, and there is nothing here that could print one.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function credentialState(env) {
    const needed = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN'];
    const missing = needed.filter((k) => !env[k] || String(env[k]).trim() === '');
    return { ok: missing.length === 0, missing };
}

/**
 * Find the artifact's line in a release manifest and return its recorded
 * sha256.
 *
 * The manifest is `sha256sum` format under a commented header, so a line is
 * `<64 hex>  <filename>`. Matching on the basename is deliberate: the
 * manifest records the names as staged, and the caller may pass an absolute
 * path to the same file.
 *
 * @param {string} manifestText
 * @param {string} artifactName
 * @returns {string | null}
 */
export function hashFromManifest(manifestText, artifactName) {
    for (const line of manifestText.split('\n')) {
        if (line.startsWith('#') || line.trim() === '') continue;
        const m = line.match(/^([0-9a-f]{64})\s+\*?(.+?)\s*$/i);
        if (m && basename(m[2]) === basename(artifactName)) return m[1].toLowerCase();
    }
    return null;
}

/**
 * A signed header field, by name. The header is what the signature actually
 * covers, so `# tag:` is a signed claim about which release these hashes are
 * for, not a convenience label. `verify.sh --recompute` writes `(none)` here
 * deliberately, to announce that its output is not a release manifest.
 *
 * @param {string} manifestText
 * @param {string} field
 * @returns {string}
 */
export function headerField(manifestText, field) {
    const m = new RegExp(`^#\\s*${field}:\\s*(.+)$`, 'm').exec(manifestText);
    return m ? m[1].trim() : '';
}

/**
 * Attribute a manifest's detached signature to one fingerprint.
 *
 * Reads gpg's machine-readable status, never its exit code and never its
 * human text: gpg exits 0 for a good signature from an UNTRUSTED key, which
 * is exactly what an attacker signing with their own key produces. VALIDSIG
 * carries the fingerprint that actually signed, so it is the only line that
 * answers "was this the release key".
 *
 * Matches the PRIMARY key as well as the signing one, because they are
 * different fingerprints and the world only ever sees one of them: K1 signs
 * with a subkey (VALIDSIG field 1) while every published channel names the
 * primary (VALIDSIG's last field). Matching field 1 alone reports a bad
 * signature on a perfectly good K1 one - a failure feed-sweep.mjs already
 * paid for and documents at verifyManifestSignature.
 *
 * @param {object} opts
 * @returns {'ok'|'no-gpg'|'bad'|'wrong-key'}
 */
export function attributeSignature({ manifestPath, fingerprint, runImpl = spawnSync }) {
    const result = runImpl('gpg', ['--status-fd=1', '--verify', `${manifestPath}.asc`, manifestPath],
        { encoding: 'utf8' });
    if (result.error && result.error.code === 'ENOENT') return 'no-gpg';
    if (result.error || typeof result.stdout !== 'string') return 'bad';

    const validsig = /^\[GNUPG:\] VALIDSIG (.+)$/m.exec(result.stdout);
    if (!validsig) return 'bad';
    const fields = validsig[1].trim().split(/\s+/);
    const want = fingerprint.replace(/\s+/g, '').toUpperCase();
    const matches = (fpr) => /^[0-9A-F]{40}$/.test(fpr.toUpperCase()) && fpr.toUpperCase() === want;
    const signing = fields[0] || '';
    const primary = fields.length > 1 ? fields[fields.length - 1] : '';
    return matches(signing) || matches(primary) ? 'ok' : 'wrong-key';
}

/**
 * The fingerprint the signature must come from, and where it came from.
 *
 * XCHAIN_VERIFY_KEY first, under the name verify.sh already uses, so a
 * rotated key is namable without reaching for --allow-unsigned; the in-repo
 * pin otherwise. A fingerprint that is not a full 40 hex characters is not
 * usable: a key id or a partial selects a key without identifying it.
 *
 * @param {(p: string, enc: string) => Promise<string>} readFileImpl
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<{ fingerprint: string, source: string }>}
 */
export async function expectedSigner(readFileImpl = readFile, env = process.env) {
    const fromEnv = String(env.XCHAIN_VERIFY_KEY || '').replace(/\s+/g, '').toUpperCase();
    if (fromEnv) return { fingerprint: fromEnv, source: 'XCHAIN_VERIFY_KEY' };
    try {
        const parsed = JSON.parse(await readFileImpl(PIN_FILE, 'utf8'));
        return {
            fingerprint: String(parsed.fingerprint || '').replace(/\s+/g, '').toUpperCase(),
            source: 'docs/release-key-pin.json',
        };
    } catch {
        return { fingerprint: '', source: 'docs/release-key-pin.json' };
    }
}

/**
 * The provenance gate. This is the check that makes the automation safe to
 * have at all: the bytes about to be uploaded must be the bytes a signed
 * release manifest describes, the manifest must carry a signature the release
 * key actually made, and the manifest must be THIS release's.
 *
 * @param {object} opts
 * @returns {Promise<{ sha256: string, manifestPath: string, signed: boolean,
 *                     signature: string, release: string, lanes: string }>}
 */
export async function checkProvenance({
    zipPath, manifestPath, tag = '', allowUnsigned,
    readFileImpl = readFile, runImpl = spawnSync,
}) {
    const manifest = manifestPath || join(dirname(zipPath), 'RELEASE_HASHES.txt');

    let manifestText;
    try {
        manifestText = await readFileImpl(manifest, 'utf8');
    } catch {
        throw new Refusal(
            `no release manifest at ${manifest}.\n`
            + '  This tool will not upload an artifact that no signed manifest describes. That rule is\n'
            + '  the whole provenance chain: the uploaded zip is meant to be the CI-built, hash-checked,\n'
            + '  K1-signed one, and an upload path that skips the manifest is how that stops being true.\n'
            + '  Stage and sign the release first, then point --manifest at it.', 1,
        );
    }

    let sigPresent = true;
    try {
        await stat(`${manifest}.asc`);
    } catch {
        sigPresent = false;
    }

    // What went wrong, in the caller's words, kept beside the boolean so the
    // refusal and the log line can both say WHICH of these it was. A missing
    // .asc, one that does not verify, and one from the wrong key are three
    // different events, and only the first is "you forgot to sign it".
    let signed = false;
    let signature = `no detached signature (${basename(manifest)}.asc)`;
    let why = `${manifest} has no detached signature (${basename(manifest)}.asc).\n`
        + '  An unsigned manifest proves the zip matches itself and nothing about who built it.';

    if (sigPresent) {
        const pin = await expectedSigner(readFileImpl);
        if (!/^[0-9A-F]{40}$/.test(pin.fingerprint)) {
            signature = 'signature present, no key to attribute it to';
            why = `${basename(manifest)}.asc cannot be attributed: no usable release-key fingerprint`
                + ` (via ${pin.source}).\n`
                + '  A good signature from an unknown key is not a verification; this project has three\n'
                + '  GPG keys in its orbit and they are not interchangeable. Set XCHAIN_VERIFY_KEY to the\n'
                + '  fingerprint published at https://xchain.io/security, or run from a checkout carrying\n'
                + '  docs/release-key-pin.json.';
        } else {
            const verdict = attributeSignature({
                manifestPath: manifest, fingerprint: pin.fingerprint, runImpl,
            });
            if (verdict === 'ok') {
                signed = true;
                signature = `signed by ${pin.fingerprint} (via ${pin.source})`;
            } else if (verdict === 'no-gpg') {
                signature = 'signature present, gpg not found to check it';
                why = `gpg is not on PATH, so the signature on ${basename(manifest)} cannot be checked.\n`
                    + '  A check that cannot run has not passed. Install gpg, or run this from the release\n'
                    + '  machine that holds the keyring.';
            } else if (verdict === 'wrong-key') {
                signature = 'signature from the WRONG KEY';
                why = `the signature on ${basename(manifest)} is GOOD and it is from the WRONG KEY.\n`
                    + `    expected: ${pin.fingerprint} (via ${pin.source})\n`
                    + '  This is the failure a bare gpg --verify cannot report: it answers whether somebody\n'
                    + '  in your keyring signed the manifest, never whether the release key did. Do not\n'
                    + '  upload this zip. If the release key was rotated, name the new fingerprint in\n'
                    + '  XCHAIN_VERIFY_KEY.';
            } else {
                signature = 'signature did not verify';
                why = `the signature on ${basename(manifest)} did not verify.\n`
                    + '  gpg reported no VALIDSIG for it, so the .asc beside this manifest is not a good\n'
                    + '  signature over these bytes. Re-fetch the manifest and its signature together.';
            }
        }
    }

    if (!signed && !allowUnsigned) {
        throw new Refusal(
            `${why}\n`
            + '  Sign the release, or pass --allow-unsigned if you genuinely mean to upload without\n'
            + '  that evidence.', 1,
        );
    }

    // --- the release anchor ---------------------------------------------
    //
    // THE ONE SHAPE THE TWO CHECKS ABOVE CANNOT SEE. A previous release's
    // zip, beside that release's own genuinely-signed manifest, satisfies
    // the signature check and the hash-membership check both, because the
    // pair agrees with itself. The anchor has to come from OUTSIDE the pair
    // or it is not an anchor: deriving it from the zip's own filename would
    // read the stale pair's old version out of the stale pair and match it
    // against itself, which is a check that cannot fail. deploy-web.sh:99
    // and publish.sh require --tag for exactly this reason, and this tool
    // was the outlier.
    const release = headerField(manifestText, 'tag');
    if (tag) {
        // `verify.sh --recompute` stamps `(none)` to announce that its
        // output describes no release at all. That is a value to refuse,
        // never one to match against.
        if (!release || release === '(none)') {
            throw new Refusal(
                `${basename(manifest)} names no release, so it cannot be the manifest for ${tag}.\n`
                + '  A manifest with no signed `# tag:` header (or one stamped `(none)`, which is what\n'
                + '  verify.sh --recompute writes) is a local recomputation, not the document the\n'
                + '  release signed. Fetch RELEASE_HASHES/<tag>.txt and its .asc together.', 1,
            );
        }
        // ONE WAY ONLY. `v0.336.0-resign1` is v0.336.0's tree with the
        // release tooling corrected and nothing else, republished under the
        // release's own name, so a re-signature satisfies a request for the
        // release it corrects. The superseded original must NOT satisfy a
        // request for the re-signature, or asking for the correction and
        // being handed the false one would verify.
        if (release !== tag && releaseTagOf(release) !== tag) {
            throw new Refusal(
                `${basename(manifest)} describes ${release}, but you named ${tag}.\n`
                + '  A manifest from another release hash-checks and signature-checks perfectly, which\n'
                + '  is precisely what this check exists for: it is the only way to tell a stale but\n'
                + '  genuinely signed artifact from the one you meant to publish. Upload the zip and\n'
                + '  the manifest that belong to the release you named.', 1,
            );
        }
    } else if (signed) {
        throw new Refusal(
            `cannot tell which release ${basename(manifest)} is for.\n`
            + `  It claims tag '${release || '(no tag header)'}' and nothing anchors that to what you\n`
            + '  meant to upload. Pass --tag <vX.Y.Z>. This mirrors verify.sh, which refuses the same\n'
            + '  shape rather than verifying a manifest against itself.', 1,
        );
    } else {
        // Unsigned and unanchored is the --allow-unsigned path, which is
        // already the operator saying they have no provenance evidence.
        // Say what is missing rather than adding a second wall to the one
        // escape hatch this tool has.
        process.stderr.write(
            `cws-upload.mjs: WARNING - manifest claims '${release || '(no tag header)'}' and nothing`
            + ' anchors it. Pass --tag to bind this upload to a release.\n');
    }

    const lanes = headerField(manifestText, 'lanes');

    const expected = hashFromManifest(manifestText, zipPath);
    if (!expected) {
        throw new Refusal(
            `${basename(zipPath)} is not listed in ${manifest}.\n`
            + '  The manifest describes a different set of artifacts, so this zip is not the one that\n'
            + '  release signed. Check you are uploading the artifact for the tag you think you are.', 1,
        );
    }

    const actual = createHash('sha256').update(await readFileImpl(zipPath)).digest('hex');
    if (actual !== expected) {
        throw new Refusal(
            `${basename(zipPath)} does not match the hash the release manifest records.\n`
            + `    manifest: ${expected}\n`
            + `    on disk:  ${actual}\n`
            + '  Do not upload this file. Either it was rebuilt after signing, or it is not the\n'
            + '  release artifact at all.', 1,
        );
    }

    return { sha256: actual, manifestPath: manifest, signed, signature, release, lanes };
}

/**
 * Exchange the refresh token for an access token.
 *
 * The credential values appear only in the request body. On failure the
 * store's message is surfaced but the request body never is, because it
 * holds the client secret and the refresh token.
 */
export async function accessToken(env, fetchImpl = globalThis.fetch) {
    const body = new URLSearchParams({
        client_id: env.CWS_CLIENT_ID,
        client_secret: env.CWS_CLIENT_SECRET,
        refresh_token: env.CWS_REFRESH_TOKEN,
        grant_type: 'refresh_token',
    });
    const res = await fetchImpl(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Refusal(
            `the OAuth token exchange failed (${res.status}). The store said: ${text.slice(0, 300)}\n`
            + '  A refresh token that has been revoked, or a client the publisher account no longer\n'
            + '  trusts, both land here.', 3,
        );
    }
    const parsed = JSON.parse(text);
    if (!parsed.access_token) throw new Refusal('the token exchange returned no access token', 3);
    return parsed.access_token;
}

export async function uploadPackage({ itemId, zipBytes, token, fetchImpl = globalThis.fetch }) {
    const res = await fetchImpl(UPLOAD_URL(itemId), {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'x-goog-api-version': '2' },
        body: zipBytes,
    });
    const text = await res.text();
    if (!res.ok) throw new Refusal(`upload failed (${res.status}): ${text.slice(0, 300)}`, 3);
    const parsed = JSON.parse(text);
    if (parsed.uploadState && parsed.uploadState !== 'SUCCESS') {
        const detail = (parsed.itemError || []).map((e) => e.error_detail).join('; ');
        throw new Refusal(`the store rejected the package: ${parsed.uploadState}. ${detail}`, 3);
    }
    return parsed;
}

export async function publishItem({ itemId, target, token, fetchImpl = globalThis.fetch }) {
    const res = await fetchImpl(PUBLISH_URL(itemId, target), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'x-goog-api-version': '2', 'content-length': '0' },
    });
    const text = await res.text();
    if (!res.ok) throw new Refusal(`publish failed (${res.status}): ${text.slice(0, 300)}`, 3);
    return JSON.parse(text);
}

async function main(argv, env, log = console.log) {
    const args = parseArgs(argv);
    if (args.help) { log(USAGE); return 0; }

    if (!args.itemId) throw new Refusal('--item-id <id> is required (try --help)', 2);
    if (!args.zip) throw new Refusal('--zip <path> is required (try --help)', 2);
    if (!args.tag) {
        throw new Refusal(
            '--tag <vX.Y.Z> is required (try --help).\n'
            + '  It is the release these bytes are supposed to be, named from outside the zip and\n'
            + '  its manifest, so that a previous release\'s genuinely-signed pair cannot pass as\n'
            + '  this one. deploy-web.sh requires it on the same seam for the same reason.', 2,
        );
    }

    // Order matters. The publish target and the provenance of the bytes are
    // both checked BEFORE a credential is even looked for, so a mistake in
    // either is reported on a machine that holds no secrets at all.
    checkPublishTarget(args.publish, args.yesReallyPublic);
    const prov = await checkProvenance({
        zipPath: args.zip, manifestPath: args.manifest, tag: args.tag,
        allowUnsigned: args.allowUnsigned,
    });
    log(`artifact: ${basename(args.zip)}`);
    log(`sha256:   ${prov.sha256}`);
    log(`release:  ${prov.release}${prov.release === args.tag ? '' : ` (re-signature of ${args.tag})`}`);
    log(`manifest: ${prov.manifestPath} (${prov.signature}`
        + `${prov.signed ? ')' : ', allowed by --allow-unsigned)'}`);
    if (prov.lanes) {
        // Said out loud, because without it "the artifact is not in the
        // manifest" reads as tampering when the truth is that this manifest
        // was never about that lane. verify.sh prints the same line.
        log(`coverage: PARTIAL - this manifest covers ${prov.lanes} and says nothing about any`
            + ' other lane of this release.');
    }

    const creds = credentialState(env);
    if (!creds.ok) {
        throw new Refusal(
            `missing credentials: ${creds.missing.join(', ')}.\n`
            + '  Set them in the environment for this one command; do not put them in a file that\n'
            + '  another process can read. They belong to the first-party OAuth client owned by the\n'
            + '  publisher organization, and they carry a custody row of their own.', 2,
        );
    }

    if (args.dryRun) {
        log('dry run: every check passed and the credentials are present. Nothing was sent.');
        return 0;
    }

    const token = await accessToken(env);
    const zipBytes = await readFile(args.zip);
    await uploadPackage({ itemId: args.itemId, zipBytes, token });
    log(`uploaded to item ${args.itemId} as a DRAFT. Nothing is visible to users yet.`);

    if (args.publish) {
        await publishItem({ itemId: args.itemId, target: args.publish, token });
        log(`published to ${args.publish}.`);
    } else {
        log('not published: pass --publish trustedTesters (or default, twice) when you mean to.');
    }
    log('Record the version, this sha256 and the item in packages/extension/docs/publish-log.md now.');
    return 0;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('cws-upload.mjs');
if (invokedDirectly) {
    main(process.argv.slice(2), process.env)
        .then((code) => process.exit(code))
        .catch((err) => {
            if (err instanceof Refusal) {
                console.error(`cws-upload.mjs: ${err.message}`);
                process.exit(err.code);
            }
            console.error(`cws-upload.mjs: ${err.message}`);
            process.exit(1);
        });
}
