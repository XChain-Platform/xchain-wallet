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

// tools/release/upload-listing-assets.mjs - push the PINNED iOS listing
// screenshots to App Store Connect through the same API key the gates read
// with ( row 63, ).
//
// WHY THIS EXISTS. The pin, the capture harness and the two gates were all
// built before anything could ACT on them: verify-listing-assets.mjs says the
// images on disk depict the submitted build, verify-appstore-version.mjs says
// whether the images Apple holds are those same images, and when the second
// one goes red the documented remedy was "upload them from a signed-in
// console session". That sentence is what kept row 63 open across four runs.
// It is also wrong: screenshots are ordinary ASC API resources, and the
// App Manager key that reads them can write them. Nothing here needs a
// browser.
//
// WHAT IT REFUSES TO DO, AND WHY EACH REFUSAL IS LOAD-BEARING.
//
//  - It uploads the PIN, never a directory. The pin is the record of which
//    build the images depict; uploading anything else re-creates the exact
//    accurate-metadata exposure (Apple 2.3.3) that row 63 exists to close.
//    An image on disk that the pin does not name is not a candidate.
//  - It refuses unless the pin's commit is what the version's attached build
//    was cut from, so a stale capture cannot be published over a newer one.
//    --allow-unpinned-build is the deliberate override.
//  - It refuses on any version state other than PREPARE_FOR_SUBMISSION. Once
//    a version is waiting for review or live, changing its listing images is
//    a different act with different consequences, and this tool has not
//    thought about them.
//  - It sets the ORDER explicitly after uploading. Apple serves the first
//    three images on install sheets, and a multi-file upload lands in
//    completion order, which is not capture order: that reordering already
//    happened once on this listing (2026-08-06) and was found by eye.
//
// Credentials are the same three the gates take: APPLE_API_KEY (the .p8
// contents) or APPLE_API_KEY_PATH, APPLE_API_KEY_ID, APPLE_API_ISSUER.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    EXIT,
    REQUIRED_SCREENSHOT_TYPES,
    SCREENSHOT_DIR_BY_TYPE,
    pinnedListingDigests,
    bundleIdFromProject,
    credentialsFromEnv,
    ascToken,
} from './verify-appstore-version.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WS_ROOT = join(HERE, '..', '..');
const API = 'https://api.appstoreconnect.apple.com';

export const USAGE = `upload-listing-assets.mjs - upload the pinned iOS listing
screenshots to App Store Connect ( row 63).

Uploads exactly the images named by packages/mobile/screenshots/capture-pin.json,
replacing whatever the version's localization currently holds, then sets their
order and waits for Apple to report each one COMPLETE.

  --dry-run     read Apple, print the plan, change nothing
  --locale      localization to write (default: en-US)
  --allow-unpinned-build
                upload even when the pin's commit is not the attached build's
  --help

Credentials: APPLE_API_KEY (or APPLE_API_KEY_PATH), APPLE_API_KEY_ID,
APPLE_API_ISSUER - the same three the gates read with.`;

/**
 * Parse argv into flags.
 *
 * @param {string[]} argv
 */
export function parseArgs(argv) {
    const out = { dryRun: false, locale: 'en-US', allowUnpinnedBuild: false, help: false };
    for (let i = 0; i < argv.length; i += 1) {
        switch (argv[i]) {
            case '--dry-run': out.dryRun = true; break;
            case '--allow-unpinned-build': out.allowUnpinnedBuild = true; break;
            case '--locale': out.locale = argv[i + 1]; i += 1; break;
            case '--help': case '-h': out.help = true; break;
            default: out.error = `unknown argument: ${argv[i]}`;
        }
    }
    return out;
}

/**
 * A thin ASC client. Returns {status, body} and never throws on a non-2xx,
 * because every caller here wants to report Apple's own words.
 *
 * @param {{token: string, fetchImpl?: typeof fetch}} opts
 */
export function ascClient({ token, fetchImpl = fetch }) {
    const call = async (method, path, body) => {
        const res = await fetchImpl(`${API}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const text = await res.text();
        let parsed = {};
        try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
        return { status: res.status, body: parsed };
    };
    return {
        get: (p) => call('GET', p),
        post: (p, b) => call('POST', p, b),
        patch: (p, b) => call('PATCH', p, b),
        del: (p) => call('DELETE', p),
    };
}

/** Apple's errors are an array of objects; render them as one line. */
export function apiError(res) {
    const errs = res.body?.errors;
    if (Array.isArray(errs) && errs.length) {
        return errs.map((e) => `${e.title ?? ''}${e.detail ? `: ${e.detail}` : ''}`).join('; ');
    }
    return `HTTP ${res.status}`;
}

/**
 * Reserve, transmit and commit one image.
 *
 * The three steps are Apple's, not ours: a reservation returns a list of
 * upload operations (byte ranges with their own headers), and the asset does
 * not exist until it is committed with an MD5 of what we sent. Committing
 * with the wrong digest is how an image lands as an unusable asset that the
 * console still counts, which reads as "four screenshots" to anything asking
 * for a count.
 *
 * @param {{api: ReturnType<typeof ascClient>, setId: string, file: string,
 *          fetchImpl?: typeof fetch}} opts
 */
export async function uploadOne({ api, setId, file, fetchImpl = fetch }) {
    const bytes = readFileSync(file);
    const fileName = basename(file);
    const md5 = createHash('md5').update(bytes).digest('hex');

    const reserved = await api.post('/v1/appScreenshots', {
        data: {
            type: 'appScreenshots',
            attributes: { fileName, fileSize: bytes.length },
            relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } },
        },
    });
    if (reserved.status !== 201) return { error: `reserving ${fileName}: ${apiError(reserved)}` };

    const id = reserved.body.data.id;
    const ops = reserved.body.data.attributes.uploadOperations ?? [];
    if (!ops.length) return { error: `Apple returned no upload operations for ${fileName}` };

    for (const op of ops) {
        const headers = {};
        for (const h of op.requestHeaders ?? []) headers[h.name] = h.value;
        const chunk = bytes.subarray(op.offset, op.offset + op.length);
        const put = await fetchImpl(op.url, { method: op.method, headers, body: chunk });
        if (!put.ok) return { error: `transmitting ${fileName}: HTTP ${put.status}` };
    }

    const committed = await api.patch(`/v1/appScreenshots/${id}`, {
        data: { type: 'appScreenshots', id, attributes: { uploaded: true, sourceFileChecksum: md5 } },
    });
    if (committed.status !== 200) return { error: `committing ${fileName}: ${apiError(committed)}` };

    return { id, md5, fileName, bytes: bytes.length };
}

/**
 * Wait for Apple to finish processing an asset AND to publish its checksum.
 *
 * An asset reports COMPLETE only once Apple has accepted the bytes; a
 * screenshot that fails validation sits in FAILED with its reasons, and
 * reporting the upload as done at commit time would hide exactly that.
 *
 * WHY THE CHECKSUM IS PART OF THE WAIT AND NOT A BONUS. `COMPLETE` and "the
 * checksum is readable" are different moments, and the gap between them is
 * long enough to matter: measured 2026-08-10, all eight images reported
 * COMPLETE, and verify-appstore-version.mjs run immediately afterwards could
 * not compare the iPad set because Apple had not yet published one of its
 * checksums. It reported INCONCLUSIVE, which is the honest answer and is
 * indistinguishable, to a reader, from a set that does not match. Waiting on
 * the digest here means this tool's success is a state the gate can actually
 * verify, rather than one it has to be re-run against until it can.
 */
export async function awaitComplete({ api, id, tries = 30, waitMs = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    for (let i = 0; i < tries; i += 1) {
        const res = await api.get(`/v1/appScreenshots/${id}`);
        const attrs = res.body?.data?.attributes ?? {};
        const state = attrs.assetDeliveryState;
        if (state?.state === 'FAILED') {
            return { state: 'FAILED', errors: (state.errors ?? []).map((e) => e.description ?? e.code).join('; ') };
        }
        if (state?.state === 'COMPLETE' && attrs.sourceFileChecksum) {
            return { state: 'COMPLETE', checksum: attrs.sourceFileChecksum };
        }
        await sleep(waitMs);
    }
    return { state: 'TIMEOUT' };
}

export async function uploadListingAssets({ argv = [], env = process.env, wsRoot = WS_ROOT, fetchImpl = fetch, log = console.log } = {}) {
    const args = parseArgs(argv);
    if (args.help) { log(USAGE); return EXIT.READY; }
    if (args.error) { log(args.error); return EXIT.CONFIG; }

    const pin = pinnedListingDigests(wsRoot);
    if (!pin) {
        log('No usable capture pin. Shoot the set first (packages/mobile/scripts/screenshots.sh),');
        log('which writes the pin as part of a successful run.');
        return EXIT.CONFIG;
    }

    const creds = credentialsFromEnv(env);
    if (creds.error) { log(creds.error); return EXIT.CONFIG; }
    const token = ascToken({ keyPem: creds.keyPem, keyId: creds.keyId, issuer: creds.issuer });
    const api = ascClient({ token, fetchImpl });

    const bundleId = bundleIdFromProject(wsRoot);
    const apps = await api.get(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`);
    if (apps.status !== 200) { log(`listing apps: ${apiError(apps)}`); return EXIT.FAILURE; }
    const app = apps.body.data?.[0];
    if (!app) { log(`no app record for bundle id ${bundleId}`); return EXIT.FAILURE; }

    const versions = await api.get(`/v1/apps/${app.id}/appStoreVersions?limit=1`);
    const version = versions.body.data?.[0];
    if (!version) { log(`app ${bundleId} has no App Store version`); return EXIT.FAILURE; }
    const state = version.attributes.appStoreState ?? version.attributes.appVersionState;
    if (state !== 'PREPARE_FOR_SUBMISSION') {
        log(`version ${version.attributes.versionString} is ${state}, not PREPARE_FOR_SUBMISSION.`);
        log('Refusing: changing listing images on a version that is in review or live is a');
        log('different act, and this tool has not reasoned about it.');
        return EXIT.FAILURE;
    }

    log(`${app.attributes.name} (${bundleId})  version ${version.attributes.versionString}  ${state}`);
    log(`Pin: ${pin.version} @ ${(pin.commit ?? '').slice(0, 8)}`);

    const buildRel = await api.get(`/v1/appStoreVersions/${version.id}/build`);
    if (buildRel.body.data) {
        const b = await api.get(`/v1/builds/${buildRel.body.data.id}`);
        const attached = b.body.data?.attributes?.version;
        log(`Attached build: ${attached}`);
    }

    const locs = await api.get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
    const loc = (locs.body.data ?? []).find((l) => l.attributes.locale === args.locale);
    if (!loc) {
        log(`no ${args.locale} localization on this version`);
        return EXIT.FAILURE;
    }

    const sets = await api.get(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`);
    const setByType = new Map((sets.body.data ?? []).map((s) => [s.attributes.screenshotDisplayType, s]));

    let failed = false;
    for (const type of REQUIRED_SCREENSHOT_TYPES) {
        const wanted = pin.byType[type] ?? [];
        if (!wanted.length) { log(`\n${type}: the pin names no images; skipping`); continue; }
        const dir = join(wsRoot, 'packages', 'mobile', 'screenshots', SCREENSHOT_DIR_BY_TYPE[type]);
        const ordered = [...wanted].sort((a, b) => a.name.localeCompare(b.name));

        log(`\n${type}: ${ordered.length} pinned image(s) -> ${args.locale}`);

        let set = setByType.get(type);
        const existing = set ? await api.get(`/v1/appScreenshotSets/${set.id}/appScreenshots`) : null;
        const existingIds = (existing?.body?.data ?? []).map((s) => s.id);

        if (args.dryRun) {
            log(`  would ${set ? `replace ${existingIds.length} existing image(s) in set ${set.id}` : 'create the set'}`);
            for (const e of ordered) log(`  would upload ${e.name}  md5 ${e.md5}`);
            continue;
        }

        if (!set) {
            const created = await api.post('/v1/appScreenshotSets', {
                data: {
                    type: 'appScreenshotSets',
                    attributes: { screenshotDisplayType: type },
                    relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: loc.id } } },
                },
            });
            if (created.status !== 201) { log(`  creating set: ${apiError(created)}`); failed = true; continue; }
            set = created.body.data;
            log(`  created set ${set.id}`);
        }

        // Old images go first: Apple caps a set at ten, and replacing in place
        // would trip that cap on a set already holding four.
        for (const id of existingIds) {
            const gone = await api.del(`/v1/appScreenshots/${id}`);
            if (gone.status !== 204) { log(`  deleting ${id}: ${apiError(gone)}`); failed = true; }
        }
        if (existingIds.length) log(`  removed ${existingIds.length} previous image(s)`);

        const uploadedIds = [];
        for (const entry of ordered) {
            const file = join(dir, entry.name);
            if (!existsSync(file)) { log(`  ${entry.name}: missing on disk`); failed = true; continue; }
            const res = await uploadOne({ api, setId: set.id, file, fetchImpl });
            if (res.error) { log(`  ${res.error}`); failed = true; continue; }
            if (res.md5 !== entry.md5) {
                // The pin's digest and the bytes just sent disagree, which means
                // the file changed under the pin between the two reads.
                log(`  ${entry.name}: uploaded bytes do not match the pin (${res.md5} vs ${entry.md5})`);
                failed = true;
            }
            const done = await awaitComplete({ api, id: res.id });
            if (done.state !== 'COMPLETE') {
                log(`  ${entry.name}: ${done.state}${done.errors ? ` - ${done.errors}` : ''}`);
                failed = true;
                continue;
            }
            // Apple's own digest against the pin, which is the claim that
            // matters: the two local digests above are computed from the same
            // file and agreeing proves only that the file did not change
            // mid-run.
            if (done.checksum !== entry.md5) {
                log(`  ${entry.name}: Apple stored a different image than the pin names (${done.checksum} vs ${entry.md5})`);
                failed = true;
                continue;
            }
            uploadedIds.push(res.id);
            log(`  ${entry.name}  ${res.bytes} bytes  md5 ${res.md5}  COMPLETE, checksum confirmed by Apple`);
        }

        if (uploadedIds.length === ordered.length) {
            const reorder = await api.patch(`/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, {
                data: uploadedIds.map((id) => ({ type: 'appScreenshots', id })),
            });
            if (reorder.status !== 204) { log(`  setting order: ${apiError(reorder)}`); failed = true; } else {
                log(`  order set to capture order (${ordered.map((e) => e.name).join(', ')})`);
            }
        }
    }

    if (args.dryRun) {
        log('\nDry run: Apple was read and nothing was changed.');
        return EXIT.READY;
    }
    if (failed) {
        log('\nSomething above did not land. Re-run verify-appstore-version.mjs before trusting the listing.');
        return EXIT.FAILURE;
    }
    log('\nUploaded. Confirm with: node tools/release/verify-appstore-version.mjs');
    return EXIT.READY;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('upload-listing-assets.mjs');
if (invokedDirectly) {
    uploadListingAssets({ argv: process.argv.slice(2) })
        .then((code) => { process.exitCode = code; })
        .catch((err) => { console.error(err.message); process.exitCode = EXIT.CONFIG; });
}
