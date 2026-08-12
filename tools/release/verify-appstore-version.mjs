// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/verify-appstore-version.mjs - the pre-submission gate for the
// half of the App Store submission that lives on Apple's servers rather than on ours.
//
// WHY THIS EXISTS. Every other pre-submission condition in this spec became a
// command, because a condition that is only written down keeps being READ
// instead of RUN: §2.1 became verify-demo-endpoints.mjs after every host in
// the zone answered 403 to a plain client, and §2.6 became
// verify-privacy-url.mjs after the deployed policy drifted from the canonical
// one. The App Store Connect version record - the single thing that decides
// whether pressing submit does anything at all - had no such check.
//
// On 2026-08-06 that cost exactly what it was always going to cost. Five runs
// described the console half as complete, two of them said the only remaining
// step was for a human to press submit, and nobody had asked Apple. The
// uploaded build was NOT attached to the version:
//
//     /v1/appStoreVersions/{id}/relationships/build  ->  data: null
//
// The build was real, VALID, unexpired and IN_BETA_TESTING on TestFlight, and
// that is precisely the trap - TestFlight's relationship to a build is not the
// App Store version's, so every place anyone had looked showed a healthy
// build. "Add for Review" was enabled too, because that button reflects the
// METADATA form. A submit would have failed at the one moment failure is
// expensive.
//
// WHAT IT ASKS, and why each is more than a field being non-empty:
//
//   - the version has a build, that build is VALID and unexpired, and its
//     store integer is the one this repo's own formula derives from the
//     version string. A build from a different version attached to this one is
//     the same defect wearing a number that looks right.
//   - the release control is MANUAL. §5 forbids automatic release outright: an
//     approval lands at Apple's whim and must not ship a wallet ahead of its
//     encoder. It was found pre-selected to AUTOMATIC once already.
//   - all four App Review contact fields are present. They are not a checklist
//     item; they are a WRITE LOCK on the entire version page, so an empty one
//     silently blocks every other correction anyone tries to save.
//   - the review notes carry the network-switch step and NOT the claim it
//     replaced. This is §17's guard pointed at Apple's copy rather than at our
//     document, because the defect it exists for was a document being fixed
//     while the console kept quoting the old text.
//   - the per-submission demo seed is filled. See SEED_PLACEHOLDER below: this
//     is the one check expected to be red until the moment of submission, and
//     it is fatal rather than advisory on purpose.
//   - both required screenshot sets are present and COMPLETE. Apple leads its
//     install sheet with the first images, and an upload that half-succeeded
//     reports success.
//   - the privacy policy URL is the canonical one, byte for byte. The App
//     Privacy form is PUBLISHED against that URL, so a drift means the store's
//     own record and the page it cites disagree.
//   - the age rating accounts for what the binary SHIPS. Same relationship
//     §16 asserts against the runbook, keyed on the same HIDDEN_SURFACES, and
//     derived here rather than restated so the two cannot drift.
//
// THE GAMBLING ANSWER IS DELIBERATELY LOUD AND NOT FATAL. The operator decided
// on 2026-08-06 to ship the betting surface and leave Gambling declared NO.
// That is a decision, not an oversight, and a gate that fails on
// a standing decision is a gate an operator learns to route around on
// submission day - which is the lesson row 49 paid for. So it reports, in
// full, every run, and never blocks. A decision to leave a known mismatch in
// place still needs a tripwire; it does not need a veto.
//
// READ-ONLY. This gate creates, updates and deletes nothing. Attaching the
// build that was missing was a one-off repair, not something a check should
// ever do on its own: a gate that fixes what it finds stops being evidence.
//
// Usage:
//   node tools/release/verify-appstore-version.mjs
//   node tools/release/verify-appstore-version.mjs --json
//
// Credentials, the same four the archive and export lanes take:
//   APPLE_API_KEY      the .p8 file CONTENTS (or APPLE_API_KEY_PATH, a path)
//   APPLE_API_KEY_ID   the key's id
//   APPLE_API_ISSUER   the issuer id

import { createSign, createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { storeVersionFromTag } from '../../packages/mobile/scripts/version.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WS_ROOT = join(HERE, '..', '..');

export const EXIT = { READY: 0, FAILURE: 1, CONFIG: 2, INCONCLUSIVE: 3 };

/**
 * The privacy policy URL the App Privacy form is published against.
 *
 * Stated rather than derived, for the same reason DEMO_COIN is in the §2.1
 * gate: which URL a store record cites is a listing decision, not a fact any
 * descriptor carries. verify-privacy-url.mjs owns whether the page at this
 * address is correct; this gate owns only whether Apple points at it.
 */
export const CANONICAL_PRIVACY_URL = 'https://xchain.io/wallet/privacy/';

/**
 * The seed block the runbook leaves in the review notes between submissions.
 *
 * The demo phrase is regenerated and re-funded per submission, so it is
 * deliberately NOT stored in the collateral; the runbook plants a loud
 * placeholder and Phase 7 replaces it. Submitting with the placeholder intact
 * hands App Review a literal instruction instead of a wallet, and the reviewer
 * cannot perform a single step of the scripted demo. That is a guaranteed
 * rejection, so it is fatal here rather than advisory - and it means this gate
 * is EXPECTED to be red, on this check alone, right up until submission.
 */
export const SEED_PLACEHOLDER = 'FILL AT SUBMISSION';

/** Apple's display types for the two idioms D6 makes this a universal app for. */
export const REQUIRED_SCREENSHOT_TYPES = Object.freeze([
    'APP_IPHONE_67',
    'APP_IPAD_PRO_3GEN_129',
]);

/**
 * Which capture directory feeds each of Apple's display types.
 *
 * packages/mobile/scripts/screenshots.sh shoots the two idioms into their own
 * directories and an operator uploads each into Apple's matching set. Until
 * 2026-08-09 nothing connected the two halves, which is the defect the block
 * below exists for.
 */
export const SCREENSHOT_DIR_BY_TYPE = Object.freeze({
    APP_IPHONE_67: 'iphone-17-pro-max',
    APP_IPAD_PRO_3GEN_129: 'ipad-pro-13-inch-m5',
});

/**
 * The capture pin, plus an MD5 per pinned image, keyed by Apple's display type.
 *
 * WHY THIS EXISTS. verify-listing-assets.mjs answers "do the images ON DISK
 * depict the build being submitted", and this gate answered "does Apple hold
 * four COMPLETE images per idiom". Neither asks the question a reviewer's
 * experience actually turns on: are the images APPLE HOLDS the ones we pinned?
 * Measured 2026-08-09, both were green while App Store Connect held a set shot
 * from a build 18 shared-UI commits old, labelling every coin with a
 * developer-only network - a listing nobody could see was wrong from a
 * terminal. That is the same shape as the build that was uploaded, VALID, and
 * never attached to the version: an instrument pointed at Apple, green, and
 * measuring the wrong relationship.
 *
 * WHY MD5 AND NOT THE PIN'S OWN SHA-256: the pin records sha256 because that
 * is what the local tooling compares; App Store Connect reports
 * `sourceFileChecksum`, which is an MD5 of the bytes it received. Asking Apple
 * the question means speaking Apple's digest.
 *
 * Returns null when there is no pin or an image it names is missing, and the
 * caller must report that as inconclusive rather than as a pass: an
 * unanswered question and a good answer are different things, which is the
 * lesson this whole file is built out of.
 */
export function pinnedListingDigests(wsRoot = WS_ROOT) {
    const dir = join(wsRoot, 'packages', 'mobile', 'screenshots');
    const pinPath = join(dir, 'capture-pin.json');
    if (!existsSync(pinPath)) return null;
    let pin;
    try {
        pin = JSON.parse(readFileSync(pinPath, 'utf8'));
    } catch {
        return null;
    }
    const byType = {};
    for (const [type, sub] of Object.entries(SCREENSHOT_DIR_BY_TYPE)) {
        const entries = [];
        for (const rel of Object.keys(pin.assets ?? {})) {
            if (!rel.startsWith(`${sub}/`)) continue;
            const file = join(dir, rel);
            if (!existsSync(file)) return null;
            entries.push({
                name: basename(rel),
                md5: createHash('md5').update(readFileSync(file)).digest('hex'),
            });
        }
        if (entries.length) byType[type] = entries;
    }
    if (!Object.keys(byType).length) return null;
    return {
        commit: pin.capturedFrom?.commit ?? null,
        version: pin.capturedFrom?.version ?? null,
        byType,
    };
}

/**
 * The bundle id, read from the Xcode project rather than restated.
 *
 * The project declares it TWICE and the uitests target comes FIRST, so a
 * first-match read picks `io.xchain.wallet.ios.uitests` and this gate would
 * query an app that does not exist - reporting a missing app record for a
 * listing that is fine.
 *
 * @param {string} [wsRoot]
 * @returns {string}
 */
export function bundleIdFromProject(wsRoot = WS_ROOT) {
    const pbx = join(wsRoot, 'packages', 'mobile', 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
    const text = readFileSync(pbx, 'utf8');
    const ids = [...text.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)]
        .map((m) => m[1].trim().replace(/^"|"$/g, ''))
        .filter((id) => !id.endsWith('.uitests'));
    const unique = [...new Set(ids)];
    if (unique.length !== 1) {
        throw new Error(
            `verify-appstore-version: expected exactly one shipping bundle id in project.pbxproj,`
            + ` found ${JSON.stringify(unique)}`,
        );
    }
    return unique[0];
}

/**
 * Which rated capabilities the STORE build actually ships.
 *
 * Derived from the same two inputs §16 uses - HIDDEN_SURFACES for the store
 * profile, and the route module that proves the capability exists - so the
 * runbook guard and this gate cannot disagree about what is in the binary. A
 * capability is exempt from its declaration only if there is a mechanism that
 * removes it AND that mechanism is on for the store profile; checking the
 * second without the first is how `bet-markets` was treated as hideable while
 * no `betting` twin pair existed.
 *
 * @param {string} [wsRoot]
 * @returns {Promise<{messaging: boolean, betting: boolean}>}
 */
export async function shippedCapabilities(wsRoot = WS_ROOT) {
    const registry = await import(
        pathToFileURL(join(wsRoot, 'packages', 'web', 'src', 'surfaces', 'registry.js')).href
    );
    const hidden = registry.HIDDEN_SURFACES.store ?? [];
    const all = registry.SURFACES;
    const ships = (surface, evidenceRel) => {
        const compiledOut = all.includes(surface) && hidden.includes(surface);
        if (compiledOut) return false;
        const evidence = join(wsRoot, ...evidenceRel);
        if (!existsSync(evidence)) {
            throw new Error(
                `verify-appstore-version: ${evidence} is gone, so the ${surface} capability check is`
                + ' asserting against something that no longer exists - re-derive it rather than deleting it',
            );
        }
        return true;
    };
    return {
        messaging: ships('messaging', ['packages', 'core', 'src', 'shared', 'routes', 'ComposeMessage.jsx']),
        betting: ships('betting', ['packages', 'core', 'src', 'shared', 'routes', 'BetFeedsList.jsx']),
    };
}

const ok = (id, detail) => ({ id, state: 'ok', detail });
const bad = (id, detail) => ({ id, state: 'failure', detail });
const loud = (id, detail) => ({ id, state: 'deferred', detail });
const dunno = (id, detail) => ({ id, state: 'inconclusive', detail });

/**
 * Turn one App Store Connect version record into a verdict, purely.
 *
 * Kept free of I/O so every branch can be pinned offline. The branches that
 * matter most are exercised exactly when Apple's record is wrong, which is
 * when nobody wants to be finding out that a condition was written backwards.
 *
 * @param {object} record             as assembled by fetchVersionRecord
 * @param {{messaging: boolean, betting: boolean}} ships
 * @returns {{exit: number, checks: Array<{id: string, state: string, detail: string}>}}
 */
export function classifyVersionRecord(record, ships, pinned = null) {
    const checks = [];
    const v = record.version ?? {};
    const build = record.build ?? null;

    // --- the build, which is the whole reason this file exists ------------
    if (!build) {
        checks.push(bad(
            'build-attached',
            'the version has NO build attached. Uploading a build and attaching it to the version are'
            + ' different acts, and TestFlight showing the build proves only the first. Submit would fail.',
        ));
    } else {
        checks.push(ok('build-attached', `build ${build.version} attached`));

        if (build.processingState !== 'VALID') {
            checks.push(bad('build-valid', `attached build is ${build.processingState}, not VALID`));
        } else if (build.expired) {
            checks.push(bad('build-valid', `attached build ${build.version} has EXPIRED (${build.expirationDate})`));
        } else {
            checks.push(ok('build-valid', `VALID, unexpired${build.expirationDate ? `, expires ${build.expirationDate}` : ''}`));
        }

        // The store integer is derived from the version string by this repo's
        // own formula, so an attached build from a different release is caught
        // even though its number looks entirely plausible.
        let expected = null;
        try {
            expected = String(storeVersionFromTag(`v${v.versionString}`));
        } catch {
            expected = null;
        }
        if (expected === null) {
            checks.push(dunno('build-number', `cannot derive a store integer from version string ${JSON.stringify(v.versionString)}`));
        } else if (String(build.version) !== expected) {
            checks.push(bad(
                'build-number',
                `attached build is ${build.version}, but version ${v.versionString} derives ${expected}`
                + ' - this is a build from a different release',
            ));
        } else {
            checks.push(ok('build-number', `${build.version} is what ${v.versionString} derives`));
        }
    }

    // --- release control (§5) --------------------------------------------
    if (v.releaseType === 'MANUAL') {
        checks.push(ok('release-type', 'MANUAL'));
    } else {
        checks.push(bad(
            'release-type',
            `releaseType is ${v.releaseType}, and §5 requires MANUAL: an approval lands at Apple's whim`
            + ' and must not ship a wallet ahead of its encoder',
        ));
    }

    // --- App Review contact: a write lock, not a field --------------------
    const rd = record.reviewDetail ?? {};
    const contactFields = ['contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail'];
    const missing = contactFields.filter((f) => !String(rd[f] ?? '').trim());
    if (missing.length) {
        checks.push(bad(
            'review-contact',
            `${missing.join(', ')} empty. These four are a WRITE LOCK on the whole version page:`
            + ' until they are filled, no other correction on it can be saved by anyone.',
        ));
    } else {
        checks.push(ok('review-contact', 'all four present'));
    }

    // --- the notes Apple holds, not the notes we wrote --------------------
    const notes = String(rd.notes ?? '');
    if (!notes.trim()) {
        checks.push(bad('review-notes', 'review notes are empty'));
    } else {
        const hasSwitch = /set Network to/i.test(notes);
        const hasFalseClaim = /already set to a public test network/i.test(notes);
        if (hasSwitch && !hasFalseClaim) {
            checks.push(ok('review-notes-network', `${notes.length} chars, carries the network-switch step`));
        } else if (!hasSwitch) {
            checks.push(bad(
                'review-notes-network',
                'the walkthrough never switches the network. Both onboarding paths open on MAINNET, so the'
                + ' funded demo phrase shows a zero balance and the airplane-mode signing step - the primary'
                + ' guideline 4.2 defense - has nothing to sign, in front of the reviewer.',
            ));
        } else {
            checks.push(bad(
                'review-notes-network',
                'the walkthrough still claims the wallet is "already set to a public test network". It is not.',
            ));
        }

        if (notes.includes(SEED_PLACEHOLDER)) {
            checks.push(bad(
                'review-notes-seed',
                `the notes still carry the ${JSON.stringify(SEED_PLACEHOLDER)} placeholder instead of the demo`
                + ' seed. THIS IS THE EXPECTED RED until runbook Phase 7: the phrase is generated and funded'
                + ' per submission, and submitting with the placeholder hands App Review an instruction'
                + ' instead of a wallet.',
            ));
        } else {
            checks.push(ok('review-notes-seed', 'per-submission demo seed filled'));
        }
    }

    // --- screenshots ------------------------------------------------------
    const sets = record.screenshotSets ?? [];
    for (const want of REQUIRED_SCREENSHOT_TYPES) {
        const set = sets.find((s) => s.displayType === want);
        if (!set || !set.count) {
            checks.push(bad('screenshots', `no screenshots for ${want}`));
        } else if (set.states.some((s) => s !== 'COMPLETE')) {
            checks.push(bad(
                'screenshots',
                `${want}: ${set.count} uploaded but delivery states are ${JSON.stringify([...new Set(set.states)])}`
                + ' - a half-finished upload reports success',
            ));
        } else {
            checks.push(ok('screenshots', `${want}: ${set.count}, all COMPLETE`));
        }
    }

    // --- and whether Apple holds the images we PINNED ----------------------
    //
    // Present and COMPLETE says an upload finished, not that it uploaded the
    // right pictures. See pinnedListingDigests() for what this cost.
    if (!pinned) {
        checks.push(dunno(
            'screenshots-pinned',
            'no capture pin (or an image it names is missing), so what Apple holds cannot be compared to'
            + ' anything. Re-run packages/mobile/scripts/screenshots.sh, which writes the pin as it captures.',
        ));
    } else {
        for (const want of REQUIRED_SCREENSHOT_TYPES) {
            const set = sets.find((s) => s.displayType === want);
            const expect = pinned.byType[want];
            if (!set || !set.count || !expect) continue; // already reported above
            const theirs = set.checksums ?? [];
            if (theirs.some((c) => !c)) {
                checks.push(dunno(
                    'screenshots-pinned',
                    `${want}: App Store Connect reports no checksum for at least one image, so this set cannot be`
                    + ' compared to the pin. Treat it as unverified, not as matching.',
                ));
                continue;
            }
            const have = new Set(theirs);
            const missing = expect.filter((e) => !have.has(e.md5));
            if (missing.length) {
                checks.push(bad(
                    'screenshots-pinned',
                    `${want}: App Store Connect holds ${set.count} image(s), and ${missing.length} of the`
                    + ` ${expect.length} pinned to ${pinned.commit?.slice(0, 8) ?? 'the capture'}`
                    + ` (${pinned.version ?? '?'}) are not among them: ${missing.map((m) => m.name).join(', ')}.`
                    + ' The listing shows a build other than the one on disk, which is the accurate-metadata'
                    + ' rejection this pin exists to prevent. Upload the pinned set.',
                ));
            } else if (theirs.length !== expect.length) {
                checks.push(bad(
                    'screenshots-pinned',
                    `${want}: every pinned image is present, but Apple holds ${theirs.length} where the pin`
                    + ` names ${expect.length}, so the set carries an image nothing recorded.`,
                ));
            } else {
                checks.push(ok(
                    'screenshots-pinned',
                    `${want}: the ${expect.length} images Apple holds are the set pinned to`
                    + ` ${pinned.commit?.slice(0, 8) ?? '?'} (${pinned.version ?? '?'})`,
                ));
            }
        }
    }

    // --- privacy policy URL ----------------------------------------------
    const privacy = record.appInfo?.privacyPolicyUrl ?? null;
    if (privacy === CANONICAL_PRIVACY_URL) {
        checks.push(ok('privacy-url', privacy));
    } else {
        checks.push(bad(
            'privacy-url',
            `Apple cites ${JSON.stringify(privacy)}, canonical is ${JSON.stringify(CANONICAL_PRIVACY_URL)}.`
            + ' The App Privacy form is PUBLISHED against this URL.',
        ));
    }

    // --- the age rating against what the binary ships ---------------------
    const rating = record.ageRating ?? {};
    if (ships.messaging) {
        if (rating.messagingAndChat === true) {
            checks.push(ok('age-messaging', 'messaging ships and is declared'));
        } else {
            checks.push(bad(
                'age-messaging',
                'the store build ships address-to-address encrypted messaging and Apple\'s declaration says'
                + ` messagingAndChat=${JSON.stringify(rating.messagingAndChat)}. A rating that understates a`
                + ' shipped capability is a rejection class before approval and a removal class after it.',
            ));
        }
    } else {
        checks.push(ok('age-messaging', 'messaging is compiled out of the store profile'));
    }

    if (ships.betting) {
        const declared = rating.gambling === true;
        if (declared) {
            checks.push(ok('age-gambling', 'betting ships and gambling is declared'));
        } else {
            checks.push(loud(
                'age-gambling',
                'DEFERRED OPERATOR DECISION (age-gambling declaration), re-read it before pressing submit: the store build'
                + ' ships the parimutuel betting lane and Apple\'s declaration says gambling=false'
                + ` (simulated=${JSON.stringify(rating.gamblingSimulated)}). Nothing is misrepresented while`
                + ' this version is a draft; the form and the binary are asserted TOGETHER at the moment'
                + ' submit is pressed. Guideline 5.3 governs real-money wagering and generally wants'
                + ' per-storefront licensing, which is why "declare it honestly" is not the cheap option here.',
            ));
        }
    } else {
        checks.push(ok('age-gambling', 'the betting lane is compiled out of the store profile'));
    }

    // --- where the version stands ----------------------------------------
    if (v.state === 'PREPARE_FOR_SUBMISSION') {
        checks.push(ok('version-state', 'PREPARE_FOR_SUBMISSION (nothing asserted to Apple yet)'));
    } else {
        checks.push(loud('version-state', `version state is ${v.state}, not PREPARE_FOR_SUBMISSION`));
    }

    const failed = checks.some((c) => c.state === 'failure');
    const unknown = checks.some((c) => c.state === 'inconclusive');
    // Failure outranks inconclusive, same rule as the other two gates: a run
    // that found something real does not get softened by a run that also could
    // not read something.
    const exit = failed ? EXIT.FAILURE : unknown ? EXIT.INCONCLUSIVE : EXIT.READY;
    return { exit, checks };
}

// --- App Store Connect access ----------------------------------------------

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

/**
 * An ES256 App Store Connect JWT, signed locally.
 *
 * The DER signature Node produces is re-encoded to the fixed-width r||s form
 * JOSE requires; a DER signature is accepted by nothing and fails as a 401,
 * which reads exactly like a bad key.
 */
export function ascToken({ keyPem, keyId, issuer, nowSec = Math.floor(Date.now() / 1000) }) {
    const header = b64u(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
    const payload = b64u(JSON.stringify({
        iss: issuer, iat: nowSec, exp: nowSec + 600, aud: 'appstoreconnect-v1',
    }));
    const signer = createSign('SHA256');
    signer.update(`${header}.${payload}`);
    const der = signer.sign(keyPem);
    let off = 2;
    if (der[1] & 0x80) off += der[1] & 0x7f;
    const rLen = der[off + 1];
    const r = der.subarray(off + 2, off + 2 + rLen);
    const sOff = off + 2 + rLen;
    const sLen = der[sOff + 1];
    const s = der.subarray(sOff + 2, sOff + 2 + sLen);
    const pad = (b) => Buffer.concat([
        Buffer.alloc(Math.max(0, 32 - b.length)),
        b.subarray(Math.max(0, b.length - 32)),
    ]);
    return `${header}.${payload}.${b64u(Buffer.concat([pad(r), pad(s)]))}`;
}

/** Credentials, or a CONFIG outcome naming what is missing. */
export function credentialsFromEnv(env = process.env) {
    const keyId = env.APPLE_API_KEY_ID;
    const issuer = env.APPLE_API_ISSUER;
    let keyPem = env.APPLE_API_KEY;
    if (!keyPem && env.APPLE_API_KEY_PATH) {
        if (!existsSync(env.APPLE_API_KEY_PATH)) {
            return { error: `APPLE_API_KEY_PATH does not exist: ${env.APPLE_API_KEY_PATH}` };
        }
        keyPem = readFileSync(env.APPLE_API_KEY_PATH, 'utf8');
    }
    const missing = [
        !keyPem && 'APPLE_API_KEY (the .p8 contents) or APPLE_API_KEY_PATH',
        !keyId && 'APPLE_API_KEY_ID',
        !issuer && 'APPLE_API_ISSUER',
    ].filter(Boolean);
    if (missing.length) return { error: `missing ${missing.join(', ')}` };
    return { keyPem, keyId, issuer };
}

/**
 * Assemble the version record from App Store Connect. GET only.
 *
 * @param {{token: string, bundleId: string, fetchImpl?: typeof fetch}} opts
 */
export async function fetchVersionRecord({ token, bundleId, fetchImpl = fetch }) {
    const get = async (path) => {
        const res = await fetchImpl(`https://api.appstoreconnect.apple.com${path}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        return { status: res.status, body };
    };

    const apps = await get(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`);
    if (apps.status === 401) return { error: 'HTTP 401 from App Store Connect: the key is not authorized (revoked, or the wrong issuer)' };
    if (apps.status !== 200) return { error: `HTTP ${apps.status} listing apps` };
    const app = apps.body.data?.[0];
    if (!app) return { error: `no app record for bundle id ${bundleId}` };

    const versions = await get(`/v1/apps/${app.id}/appStoreVersions?limit=1`);
    const version = versions.body.data?.[0];
    if (!version) return { error: `app ${bundleId} has no App Store version` };

    const record = {
        app: { id: app.id, name: app.attributes.name, bundleId: app.attributes.bundleId },
        version: {
            id: version.id,
            versionString: version.attributes.versionString,
            state: version.attributes.appStoreState ?? version.attributes.appVersionState,
            releaseType: version.attributes.releaseType,
        },
        build: null,
        reviewDetail: {},
        screenshotSets: [],
        appInfo: {},
        ageRating: {},
    };

    const buildRel = await get(`/v1/appStoreVersions/${version.id}/build`);
    if (buildRel.body.data) {
        const b = await get(`/v1/builds/${buildRel.body.data.id}`);
        const at = b.body.data?.attributes ?? {};
        record.build = {
            version: at.version,
            processingState: at.processingState,
            expired: at.expired,
            expirationDate: at.expirationDate,
        };
    }

    const rd = await get(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`);
    record.reviewDetail = rd.body.data?.attributes ?? {};

    const locs = await get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
    for (const loc of locs.body.data ?? []) {
        const sets = await get(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`);
        for (const set of sets.body.data ?? []) {
            const shots = await get(`/v1/appScreenshotSets/${set.id}/appScreenshots`);
            record.screenshotSets.push({
                displayType: set.attributes.screenshotDisplayType,
                count: (shots.body.data ?? []).length,
                states: (shots.body.data ?? []).map((s) => s.attributes.assetDeliveryState?.state),
                // Apple's MD5 of the bytes it received, which is the only
                // handle there is on WHICH images the console actually holds.
                checksums: (shots.body.data ?? []).map((s) => s.attributes.sourceFileChecksum ?? null),
            });
        }
    }

    const infos = await get(`/v1/apps/${app.id}/appInfos`);
    const info = infos.body.data?.[0];
    if (info) {
        record.appInfo.ageRating = info.attributes.appStoreAgeRating;
        const rating = await get(`/v1/appInfos/${info.id}/ageRatingDeclaration`);
        record.ageRating = rating.body.data?.attributes ?? {};
        const il = await get(`/v1/appInfos/${info.id}/appInfoLocalizations`);
        const enUS = (il.body.data ?? []).find((l) => l.attributes.locale === 'en-US') ?? il.body.data?.[0];
        record.appInfo.privacyPolicyUrl = enUS?.attributes?.privacyPolicyUrl ?? null;
        record.appInfo.name = enUS?.attributes?.name;
        record.appInfo.subtitle = enUS?.attributes?.subtitle;
    }

    return { record };
}

const USAGE = `verify-appstore-version.mjs - would App Store Connect actually accept a
submission of the current version? (App Store Connect pre-submission gate.)

Usage:
  node tools/release/verify-appstore-version.mjs [--json]

Options:
  --json            machine-readable outcome
  -h, --help        print this and exit 0

READS LIVE APP STORE CONNECT STATE, and writes nothing. --help is answered
before any network call.

Credentials: APPLE_API_KEY (or APPLE_API_KEY_PATH), APPLE_API_KEY_ID,
APPLE_API_ISSUER - the same three the archive and export lanes take.

Exit codes:
  0  ready         Apple's record would accept a submission
  1  failure       DO NOT SUBMIT
  2  config        a credential problem, not a record problem
  3  inconclusive  something could not be read. NOT a pass.
`;

export async function checkAppStoreVersion({ env = process.env, fetchImpl = fetch, wsRoot = WS_ROOT } = {}) {
    const creds = credentialsFromEnv(env);
    if (creds.error) return { exit: EXIT.CONFIG, reason: creds.error, checks: [] };

    let bundleId;
    let ships;
    try {
        bundleId = bundleIdFromProject(wsRoot);
        ships = await shippedCapabilities(wsRoot);
    } catch (err) {
        return { exit: EXIT.CONFIG, reason: err.message, checks: [] };
    }

    let token;
    try {
        token = ascToken({ keyPem: creds.keyPem, keyId: creds.keyId, issuer: creds.issuer });
    } catch (err) {
        return { exit: EXIT.CONFIG, reason: `could not sign a token: ${err.message}`, checks: [] };
    }

    let fetched;
    try {
        fetched = await fetchVersionRecord({ token, bundleId, fetchImpl });
    } catch (err) {
        return { exit: EXIT.INCONCLUSIVE, reason: `App Store Connect unreachable: ${err.message}`, checks: [] };
    }
    if (fetched.error) {
        const config = /401|not authorized/i.test(fetched.error);
        return { exit: config ? EXIT.CONFIG : EXIT.INCONCLUSIVE, reason: fetched.error, checks: [] };
    }

    const outcome = classifyVersionRecord(fetched.record, ships, pinnedListingDigests(wsRoot));
    return { ...outcome, record: fetched.record, ships, bundleId };
}

async function main() {
    const argv = process.argv.slice(2);
    if (argv.includes('--help') || argv.includes('-h')) {
        process.stdout.write(USAGE);
        return EXIT.READY;
    }
    const outcome = await checkAppStoreVersion();

    if (argv.includes('--json')) {
        console.log(JSON.stringify(outcome, null, 2));
        return outcome.exit;
    }

    console.log('App Store Connect version record (pre-submission gate)\n');
    if (outcome.record) {
        const { app, version } = outcome.record;
        console.log(`  ${app.name} (${app.bundleId})  version ${version.versionString}  ${version.state}\n`);
    }
    for (const c of outcome.checks) {
        const mark = c.state === 'ok' ? 'OK  ' : c.state === 'failure' ? 'FAIL' : c.state === 'deferred' ? 'NOTE' : '??  ';
        console.log(`${mark} ${c.id}`);
        console.log(`       ${c.detail}`);
    }
    console.log();
    if (outcome.exit === EXIT.READY) {
        console.log('Apple\'s record would accept a submission. Re-read every NOTE above before pressing submit.');
    } else if (outcome.exit === EXIT.FAILURE) {
        const fails = outcome.checks.filter((c) => c.state === 'failure');
        if (fails.length === 1 && fails[0].id === 'review-notes-seed') {
            // Distinguished on purpose. This is the one red the gate is DESIGNED
            // to show right up until submission, and an operator who reads a
            // blanket "DO NOT SUBMIT" at Phase 7 - when filling the seed is the
            // very next thing they were going to do - learns to ignore the gate.
            console.log('Apple\'s record is otherwise submittable: the only failure is the per-submission demo'
                + ' seed, which runbook Phase 7 fills. Fill it, re-run this, then submit.'
                + ' Re-read every NOTE above first.');
        } else {
            console.log('DO NOT SUBMIT. Every FAIL above is something Apple\'s own record says is wrong or missing.');
        }
    } else if (outcome.exit === EXIT.CONFIG) {
        console.log(`Configuration problem: ${outcome.reason}`);
    } else {
        console.log(`INCONCLUSIVE: ${outcome.reason ?? 'something could not be read'}. This is not a pass.`);
    }
    return outcome.exit;
}

if (process.argv[1] && process.argv[1].endsWith('verify-appstore-version.mjs')) {
    process.exitCode = await main();
}
