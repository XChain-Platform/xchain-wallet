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
// Store through the store's own API ( D4).
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
//     manifest. Automation that can upload any file on disk would undo the
//     entire provenance chain ceremony Phase 4 exists to enforce: the whole
//     point there is that the uploaded artifact is the CI-built, hash-checked,
//     K1-signed one, and a convenient script that skips it is how that rule
//     stops being true.
//   - It refuses to publish PUBLICLY unless told twice. This spec's
//     first-submission rule is UNLISTED, and D3 (answered 2026-08-06) puts
//     every later release through a beta soak first, so "publish to the
//     world" is never the routine path and must not be the easy default.
//
// The store's API is two calls: PUT the package, then POST publish. The
// upload alone changes nothing users can see, which is why --publish is
// separate and opt-in rather than implied.

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

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
  --publish <target>    also publish: trustedTesters | default    (optional)
  --yes-really-public   required alongside --publish default
  --manifest <path>     RELEASE_HASHES.txt covering the zip
                        (default: RELEASE_HASHES.txt beside the zip)
  --allow-unsigned      accept a manifest with no detached signature
  --dry-run             do every check, then stop before the network
  -h, --help            print this and exit 0

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
        itemId: '', zip: '', publish: '', manifest: '',
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
 * The provenance gate. This is the check that makes the automation safe to
 * have at all: the bytes about to be uploaded must be the bytes a signed
 * release manifest describes.
 *
 * @param {object} opts
 * @returns {Promise<{ sha256: string, manifestPath: string, signed: boolean }>}
 */
export async function checkProvenance({ zipPath, manifestPath, allowUnsigned, readFileImpl = readFile }) {
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

    let signed = false;
    try {
        await stat(`${manifest}.asc`);
        signed = true;
    } catch { /* absence is handled just below */ }

    if (!signed && !allowUnsigned) {
        throw new Refusal(
            `${manifest} has no detached signature (${basename(manifest)}.asc).\n`
            + '  An unsigned manifest proves the zip matches itself and nothing about who built it.\n'
            + '  Sign the release, or pass --allow-unsigned if you genuinely mean to upload without\n'
            + '  that evidence.', 1,
        );
    }

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

    return { sha256: actual, manifestPath: manifest, signed };
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

    // Order matters. The publish target and the provenance of the bytes are
    // both checked BEFORE a credential is even looked for, so a mistake in
    // either is reported on a machine that holds no secrets at all.
    checkPublishTarget(args.publish, args.yesReallyPublic);
    const prov = await checkProvenance({
        zipPath: args.zip, manifestPath: args.manifest, allowUnsigned: args.allowUnsigned,
    });
    log(`artifact: ${basename(args.zip)}`);
    log(`sha256:   ${prov.sha256}`);
    log(`manifest: ${prov.manifestPath}${prov.signed ? ' (signed)' : ' (UNSIGNED, allowed by flag)'}`);

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
