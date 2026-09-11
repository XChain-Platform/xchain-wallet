// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for tools/release/verify-appstore-version.mjs.
//
// The gate only means anything against live App Store Connect state, so what
// is worth pinning offline is what decides what an answer MEANS. Those
// branches are exercised exactly when Apple's record is wrong, which is when
// nobody wants to be discovering that a condition was written backwards.
//
// The defect this whole file descends from is worth restating, because the
// shape of it is why the assertions below are the ones they are: on
// 2026-08-06 the uploaded build was VALID, unexpired and IN_BETA_TESTING on
// TestFlight, and was NOT attached to the App Store version. Every place
// anyone had looked showed a healthy build. So a check for "is there a build"
// that reads TestFlight, or reads a name, or reads anything other than the
// version's own relationship, would have passed through the defect.
//
// Five properties:
//
// 1. A missing build is a FAILURE, and no other check passing rescues it.
// 2. An attached build is not automatically a good one: state, expiry and the
//    store integer are each checked, and the integer is DERIVED from the
//    version string by the repo's own formula rather than restated.
// 3. The review-notes assertions are §17's guard pointed at Apple's copy. A
//    document can be right while the console quotes the old text, which is the
//    defect that produced row 44.
// 4. The deferred gambling answer is LOUD and never fatal, and the deferral is
//    keyed to what the binary ships. A gate that fails on a standing operator
//    decision is a gate that gets routed around on submission day.
// 5. Config and inconclusive never become a pass, and failure outranks
//    inconclusive - the same rule the other two gates carry.

import { strict as assert } from 'node:assert';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
    classifyVersionRecord, credentialsFromEnv, bundleIdFromProject, shippedCapabilities,
    ascToken, EXIT, CANONICAL_PRIVACY_URL, SEED_PLACEHOLDER, REQUIRED_SCREENSHOT_TYPES,
    SCREENSHOT_DIR_BY_TYPE, pinnedListingDigests, tagDerivations,
} from '../../../tools/release/verify-appstore-version.mjs';

const SHIPS_BOTH = { messaging: true, betting: true };

/**
 * The MD5s Apple would report per idiom, and a pin that claims them.
 *
 * The digests are arbitrary strings on purpose: what these cases pin is the
 * COMPARISON, and a real digest would only make the fixture look authoritative
 * about bytes this file does not have. The real bytes are compared by the
 * gate itself against live App Store Connect, which is where this check was
 * first driven and where it first went red.
 */
const UPLOADED = Object.fromEntries(REQUIRED_SCREENSHOT_TYPES.map((t, i) => [
    t, [1, 2, 3, 4].map((n) => `${i}${n}`.padStart(32, 'a')),
]));

function pinFor(byTypeOverride = null) {
    const byType = byTypeOverride ?? Object.fromEntries(REQUIRED_SCREENSHOT_TYPES.map((t) => [
        t, UPLOADED[t].map((md5, i) => ({ name: `0${i + 1}-scene.png`, md5 })),
    ]));
    return { commit: '2731745ecf35a41c093abba6004778afee2cdf87', version: '0.336.0', byType };
}

/** A record in the state Apple actually held once everything was correct. */
function healthyRecord(overrides = {}) {
    return {
        app: { id: '1', name: 'XChain Wallet', bundleId: 'io.xchain.wallet.ios' },
        version: { id: 'v1', versionString: '0.336.0', state: 'PREPARE_FOR_SUBMISSION', releaseType: 'MANUAL' },
        build: {
            version: '3360050', processingState: 'VALID', expired: false,
            expirationDate: '2026-11-04T15:53:18-08:00',
        },
        reviewDetail: {
            contactFirstName: 'Jeremy', contactLastName: 'Johnson',
            contactPhone: '+1 555 0100', contactEmail: 'info@example.invalid',
            notes: '1. Import the phrase below.\n2. Open Settings and set Network to "Testnet".\n'
                + '3. Confirm the balance loads.\nDEMO SEED: correct horse battery staple',
        },
        screenshotSets: REQUIRED_SCREENSHOT_TYPES.map((displayType) => ({
            displayType,
            count: 4,
            states: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE'],
            checksums: [...UPLOADED[displayType]],
        })),
        appInfo: { privacyPolicyUrl: CANONICAL_PRIVACY_URL, ageRating: 'FOUR_PLUS' },
        ageRating: { messagingAndChat: true, gambling: false, gamblingSimulated: 'NONE' },
        ...overrides,
    };
}

const find = (out, id) => out.checks.filter((c) => c.id === id);
const state = (out, id) => find(out, id).map((c) => c.state);

// --- 1. The healthy record is ready, and the deferral does not block it -----

const healthy = classifyVersionRecord(healthyRecord(), SHIPS_BOTH, pinFor());
assert.equal(healthy.exit, EXIT.READY, 'a complete record must be READY');
assert.deepEqual(state(healthy, 'build-attached'), ['ok']);
assert.deepEqual(state(healthy, 'age-gambling'), ['deferred'],
    'the deferred gambling answer must report, and must not fail');
assert.ok(
    healthy.checks.some((c) => c.state === 'deferred'),
    'a READY verdict must still be able to carry a deferred note, or the deferral is invisible',
);

// --- 2. The defect this gate was built for ---------------------------------

const noBuild = classifyVersionRecord(healthyRecord({ build: null }), SHIPS_BOTH);
assert.equal(noBuild.exit, EXIT.FAILURE, 'a version with no build must FAIL');
assert.deepEqual(state(noBuild, 'build-attached'), ['failure']);
// The whole trap was that everything else looked fine, so assert that nothing
// else went red - if it had, this defect would have been found long ago.
assert.deepEqual(
    noBuild.checks.filter((c) => c.state === 'failure').map((c) => c.id),
    ['build-attached'],
    'the missing build must be the ONLY failure, which is exactly why it hid for two runs',
);

// --- 3. An attached build still has to be the right build ------------------

for (const [label, build, expectFail] of [
    ['still processing', { version: '3360050', processingState: 'PROCESSING', expired: false }, 'build-valid'],
    ['expired', { version: '3360050', processingState: 'VALID', expired: true }, 'build-valid'],
    ['from another release', { version: '3350050', processingState: 'VALID', expired: false }, 'build-number'],
]) {
    const out = classifyVersionRecord(healthyRecord({ build }), SHIPS_BOTH);
    assert.equal(out.exit, EXIT.FAILURE, `${label}: must FAIL`);
    assert.deepEqual(state(out, expectFail), ['failure'], `${label}: ${expectFail} must be the failing check`);
}

// The store integer is derived, not restated: 0.336.0 -> 3360050 by the same
// formula the xcconfig is generated from. Pinning the number here would let
// the two drift, which is the failure the formula exists to prevent.
const derived = classifyVersionRecord(healthyRecord(), SHIPS_BOTH);
assert.deepEqual(state(derived, 'build-number'), ['ok']);
const otherVersion = classifyVersionRecord(healthyRecord({
    version: { id: 'v1', versionString: '0.337.0', state: 'PREPARE_FOR_SUBMISSION', releaseType: 'MANUAL' },
}), SHIPS_BOTH);
assert.deepEqual(state(otherVersion, 'build-number'), ['failure'],
    'the same build under a different version string must fail the derivation');

// --- 3b. A respin, which is the case the derivation could not express -------
//
// Apple's CFBundleShortVersionString cannot carry a lane, so a respin of
// 0.336.0 sits at Apple as marketing 0.336.0 with build 3360051. Rebuilding a
// tag out of that string only ever names the stable one, so this gate failed
// the respin as "a build from a different release" - at the one moment a
// respin exists for.
const RESPIN_TAG = 'v0.336.0-respin.1';
const respinBuild = { version: '3360051', processingState: 'VALID', expired: false };

const respinTagged = classifyVersionRecord(
    healthyRecord({ build: respinBuild }), SHIPS_BOTH, pinFor(), RESPIN_TAG,
);
assert.deepEqual(state(respinTagged, 'build-number'), ['ok'],
    'a respin build passes when the gate is told the respin tag');
assert.deepEqual(state(respinTagged, 'marketing-version'), ['ok'],
    'and the marketing version Apple holds is checked against that same tag');

const stableUnderRespinTag = classifyVersionRecord(
    healthyRecord(), SHIPS_BOTH, pinFor(), RESPIN_TAG,
);
assert.deepEqual(state(stableUnderRespinTag, 'build-number'), ['failure'],
    'the STABLE build under a respin tag must fail: it is the build the respin replaces');

const stableTagged = classifyVersionRecord(healthyRecord(), SHIPS_BOTH, pinFor(), 'v0.336.0');
assert.equal(stableTagged.exit, EXIT.READY, 'the stable record under its own tag is still READY');
assert.deepEqual(state(stableTagged, 'build-number'), ['ok']);

// A tag that disagrees with what Apple holds is a new failure the old
// derivation could not see at all, because it compared the string to itself.
const wrongMarketing = classifyVersionRecord(healthyRecord(), SHIPS_BOTH, pinFor(), 'v0.337.0');
assert.deepEqual(state(wrongMarketing, 'marketing-version'), ['failure'],
    'Apple holding a different marketing version than the tag must fail');

// Tagless, the gate keeps working: the respin passes on the band, the stable
// record still passes exactly, and a build from another release still fails.
const respinTagless = classifyVersionRecord(healthyRecord({ build: respinBuild }), SHIPS_BOTH, pinFor());
assert.deepEqual(state(respinTagless, 'build-number'), ['ok'],
    'a respin build passes the lane-tolerant band with no tag');
assert.match(find(respinTagless, 'build-number')[0].detail, /respin 1/,
    'and the detail says it answered the lane-tolerant question');
assert.equal(state(respinTagless, 'marketing-version').length, 0,
    'with no tag there is nothing to check the marketing version against');
for (const wrong of ['3350050', '3360150', '3360049', '3360100']) {
    const out = classifyVersionRecord(healthyRecord({
        build: { version: wrong, processingState: 'VALID', expired: false },
    }), SHIPS_BOTH, pinFor());
    assert.deepEqual(state(out, 'build-number'), ['failure'],
        `build ${wrong} is outside 0.336.0's band and must still fail with no tag`);
}

// An unparseable tag is a configuration error, never a silent pass.
assert.equal(tagDerivations(null), null, 'no tag derives nothing');
assert.equal(tagDerivations('   '), null, 'a blank tag derives nothing');
assert.ok(tagDerivations('v0.336.0-nonsense.1').error, 'a malformed tag reports an error');
const badTag = classifyVersionRecord(healthyRecord(), SHIPS_BOTH, pinFor(), 'v0.336.0-nonsense.1');
assert.deepEqual(state(badTag, 'build-number'), ['failure'],
    'a malformed tag fails the check rather than falling back to the weaker one');
assert.deepEqual(
    tagDerivations(RESPIN_TAG),
    { tag: RESPIN_TAG, marketing: '0.336.0', build: '3360051' },
    'the derivations come from the version oracle, not from a second formula here',
);

// --- 4. §5's release control ------------------------------------------------

const autoRelease = classifyVersionRecord(healthyRecord({
    version: { id: 'v1', versionString: '0.336.0', state: 'PREPARE_FOR_SUBMISSION', releaseType: 'AFTER_APPROVAL' },
}), SHIPS_BOTH);
assert.equal(autoRelease.exit, EXIT.FAILURE, 'automatic release is forbidden by §5');
assert.deepEqual(state(autoRelease, 'release-type'), ['failure']);

// --- 5. The contact fields, which are a write lock --------------------------

for (const field of ['contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail']) {
    const rd = { ...healthyRecord().reviewDetail, [field]: '' };
    const out = classifyVersionRecord(healthyRecord({ reviewDetail: rd }), SHIPS_BOTH);
    assert.equal(out.exit, EXIT.FAILURE, `${field} empty must FAIL`);
    assert.match(find(out, 'review-contact')[0].detail, /WRITE LOCK/,
        'the message must say it blocks every other save, or the next person treats it as one more box');
}
// Whitespace is not a value. A form saved with a space in it looks filled.
const spaced = classifyVersionRecord(healthyRecord({
    reviewDetail: { ...healthyRecord().reviewDetail, contactPhone: '   ' },
}), SHIPS_BOTH);
assert.deepEqual(state(spaced, 'review-contact'), ['failure'], 'whitespace must not count as present');

// --- 6. The notes Apple holds, not the notes we wrote -----------------------

const noSwitch = classifyVersionRecord(healthyRecord({
    reviewDetail: { ...healthyRecord().reviewDetail, notes: '1. Import the phrase.\n2. Confirm the balance.' },
}), SHIPS_BOTH);
assert.equal(noSwitch.exit, EXIT.FAILURE, 'notes without the network switch must FAIL');
assert.deepEqual(state(noSwitch, 'review-notes-network'), ['failure']);
assert.match(find(noSwitch, 'review-notes-network')[0].detail, /MAINNET/,
    'the message must name why it matters: the demo wallet opens empty');

const falseClaim = classifyVersionRecord(healthyRecord({
    reviewDetail: {
        ...healthyRecord().reviewDetail,
        notes: '1. Import.\n2. The wallet is already set to a public test network, so set Network to nothing.',
    },
}), SHIPS_BOTH);
assert.equal(falseClaim.exit, EXIT.FAILURE, 'the reinstated false claim must FAIL');
assert.deepEqual(state(falseClaim, 'review-notes-network'), ['failure']);

const emptyNotes = classifyVersionRecord(healthyRecord({
    reviewDetail: { ...healthyRecord().reviewDetail, notes: '' },
}), SHIPS_BOTH);
assert.equal(emptyNotes.exit, EXIT.FAILURE, 'empty notes must FAIL');

// The seed placeholder: fatal, and it says it is the expected red.
const seedLeft = classifyVersionRecord(healthyRecord({
    reviewDetail: {
        ...healthyRecord().reviewDetail,
        notes: `1. Import.\n2. Open Settings and set Network to "Testnet".\n[${SEED_PLACEHOLDER}]`,
    },
}), SHIPS_BOTH);
assert.equal(seedLeft.exit, EXIT.FAILURE, 'the unfilled demo seed must FAIL');
assert.deepEqual(
    seedLeft.checks.filter((c) => c.state === 'failure').map((c) => c.id),
    ['review-notes-seed'],
    'the placeholder must be the ONLY failure it produces, so the operator can tell this red from a real one',
);
assert.match(find(seedLeft, 'review-notes-seed')[0].detail, /EXPECTED RED/,
    'a check that is red by design must say so, or it teaches people to ignore the gate');

// --- 7. Screenshots ---------------------------------------------------------

const missingIpad = classifyVersionRecord(healthyRecord({
    screenshotSets: [{ displayType: 'APP_IPHONE_67', count: 4, states: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE'] }],
}), SHIPS_BOTH);
assert.equal(missingIpad.exit, EXIT.FAILURE, 'a missing required idiom must FAIL');
assert.ok(state(missingIpad, 'screenshots').includes('failure'));

// A half-finished upload reports success, which is the whole reason state is
// checked rather than count.
const halfUploaded = classifyVersionRecord(healthyRecord({
    screenshotSets: REQUIRED_SCREENSHOT_TYPES.map((displayType) => ({
        displayType, count: 4, states: ['COMPLETE', 'COMPLETE', 'UPLOAD_COMPLETE', 'COMPLETE'],
    })),
}), SHIPS_BOTH);
assert.equal(halfUploaded.exit, EXIT.FAILURE, 'a non-COMPLETE delivery state must FAIL');

// --- 8. The privacy URL the App Privacy form is published against -----------

for (const url of [null, 'https://xchain.io/wallet/privacy', 'https://dankest.llc/privacy.html']) {
    const out = classifyVersionRecord(healthyRecord({
        appInfo: { privacyPolicyUrl: url, ageRating: 'FOUR_PLUS' },
    }), SHIPS_BOTH);
    assert.equal(out.exit, EXIT.FAILURE, `privacy URL ${JSON.stringify(url)} must FAIL`);
}
// Including the trailing slash deliberately: the published form cites the
// directory URL, and verify-privacy-url.mjs measures that exact address.
assert.ok(CANONICAL_PRIVACY_URL.endsWith('/'), 'the canonical privacy URL is the directory form');

// --- 9. The age rating against what the BINARY ships ------------------------

// Messaging ships and is declared NO: a rejection class, so fatal.
for (const declared of [false, undefined, null]) {
    const out = classifyVersionRecord(healthyRecord({
        ageRating: { messagingAndChat: declared, gambling: false, gamblingSimulated: 'NONE' },
    }), SHIPS_BOTH);
    assert.equal(out.exit, EXIT.FAILURE, `messagingAndChat=${declared} while messaging ships must FAIL`);
    assert.deepEqual(state(out, 'age-messaging'), ['failure']);
}

// Compiling the capability OUT is the one thing that legitimately lets the
// question stay NO - so the guard must EXEMPT it, not merely always-assert.
const messagingHidden = classifyVersionRecord(healthyRecord({
    ageRating: { messagingAndChat: false, gambling: false, gamblingSimulated: 'NONE' },
}), { messaging: false, betting: true });
assert.deepEqual(state(messagingHidden, 'age-messaging'), ['ok'],
    'a compiled-out capability must be exempt, or the guard is asserting a constant');

// Gambling: LOUD while it ships undeclared, plain OK once compiled out, and
// plain OK if it is ever declared. Never fatal in any of the three.
const bettingHidden = classifyVersionRecord(healthyRecord(), { messaging: true, betting: false }, pinFor());
assert.deepEqual(state(bettingHidden, 'age-gambling'), ['ok']);
assert.equal(bettingHidden.exit, EXIT.READY);

const gamblingDeclared = classifyVersionRecord(healthyRecord({
    ageRating: { messagingAndChat: true, gambling: true, gamblingSimulated: 'NONE' },
}), SHIPS_BOTH);
assert.deepEqual(state(gamblingDeclared, 'age-gambling'), ['ok']);

// The deferral must never be able to fail the gate, whatever else is true.
const deferredOnly = classifyVersionRecord(healthyRecord(), SHIPS_BOTH);
assert.ok(
    !deferredOnly.checks.some((c) => c.id === 'age-gambling' && c.state === 'failure'),
    'a standing operator decision must never be a veto - that is how a gate gets routed around',
);
assert.match(find(deferredOnly, 'age-gambling')[0].detail, /age-gambling declaration/,
    'the note must cite the item, or the next session cannot find the decision');

// --- 10. Config and inconclusive never become a pass ------------------------

assert.ok(credentialsFromEnv({}).error, 'no credentials must be a config error, not a pass');
assert.ok(credentialsFromEnv({ APPLE_API_KEY: 'x', APPLE_API_KEY_ID: 'y' }).error, 'a partial set is still config');
assert.ok(
    credentialsFromEnv({ APPLE_API_KEY_PATH: '/nonexistent/AuthKey.p8', APPLE_API_KEY_ID: 'y', APPLE_API_ISSUER: 'z' }).error,
    'a key path that does not exist must be a config error',
);
assert.equal(
    credentialsFromEnv({ APPLE_API_KEY: 'pem', APPLE_API_KEY_ID: 'y', APPLE_API_ISSUER: 'z' }).error,
    undefined,
    'a complete set must not report an error',
);

const unreadableVersion = classifyVersionRecord(healthyRecord({
    version: { id: 'v1', versionString: 'not-a-version', state: 'PREPARE_FOR_SUBMISSION', releaseType: 'MANUAL' },
}), SHIPS_BOTH);
assert.ok(state(unreadableVersion, 'build-number').includes('inconclusive'),
    'an underivable version string must be inconclusive, never a silent pass');
assert.equal(unreadableVersion.exit, EXIT.INCONCLUSIVE);

// Failure outranks inconclusive, so a run that found something real is not
// softened by a run that also could not read something.
const bothStates = classifyVersionRecord(healthyRecord({
    version: { id: 'v1', versionString: 'not-a-version', state: 'PREPARE_FOR_SUBMISSION', releaseType: 'AFTER_APPROVAL' },
}), SHIPS_BOTH);
assert.equal(bothStates.exit, EXIT.FAILURE, 'a failure must outrank an inconclusive');

// --- 10b. Whether Apple holds the images we PINNED --------------------------
//
// "Present and COMPLETE" says an upload finished, not that it uploaded the
// right pictures, and the two are not the same question. Measured against live
// App Store Connect on 2026-08-09: both screenshot sets were 4-of-4 COMPLETE
// while every one of the 8 images Apple held was a different file from the
// pinned set on disk - a listing showing one build while the binary is
// another, which is the accurate-metadata rejection the pin exists to prevent
// and which nothing could see from a terminal.

const wrongUpload = classifyVersionRecord(healthyRecord({
    screenshotSets: REQUIRED_SCREENSHOT_TYPES.map((displayType) => ({
        displayType,
        count: 4,
        states: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE'],
        checksums: ['d0', 'd1', 'd2', 'd3'].map((d) => d.padStart(32, 'f')),
    })),
}), SHIPS_BOTH, pinFor());
assert.equal(wrongUpload.exit, EXIT.FAILURE, 'images Apple holds that nothing pinned must FAIL');
assert.deepEqual(state(wrongUpload, 'screenshots-pinned'), ['failure', 'failure']);
assert.deepEqual(state(wrongUpload, 'screenshots'), ['ok', 'ok'],
    'the old check must still pass here, or this case is not reproducing the trap');

// One stale image among three current ones is the likelier real shape, and it
// must be as fatal as eight: a listing is judged as a set.
const oneStale = classifyVersionRecord(healthyRecord({
    screenshotSets: REQUIRED_SCREENSHOT_TYPES.map((displayType) => ({
        displayType,
        count: 4,
        states: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE'],
        checksums: [...UPLOADED[displayType].slice(0, 3), 'e'.repeat(32)],
    })),
}), SHIPS_BOTH, pinFor());
assert.equal(oneStale.exit, EXIT.FAILURE, 'one unpinned image must fail the set');
assert.ok(
    find(oneStale, 'screenshots-pinned')[0].detail.includes('04-scene.png'),
    'the failure must name WHICH image is missing, or it cannot be acted on',
);

// Every pinned image present AND an extra one beside them. This is the case a
// count check exists for: set membership alone says yes, and the listing still
// carries an image nothing recorded.
const extraImage = classifyVersionRecord(healthyRecord({
    screenshotSets: REQUIRED_SCREENSHOT_TYPES.map((displayType) => ({
        displayType,
        count: 5,
        states: Array(5).fill('COMPLETE'),
        checksums: [...UPLOADED[displayType], 'b'.repeat(32)],
    })),
}), SHIPS_BOTH, pinFor());
assert.equal(extraImage.exit, EXIT.FAILURE, 'an unpinned extra image must fail even when all pinned ones are there');
assert.ok(
    find(extraImage, 'screenshots-pinned')[0].detail.includes('nothing recorded'),
    'the extra-image failure must say what is wrong, not repeat the missing-image wording',
);

// No pin at all is an unanswered question, not a pass. This is the branch that
// makes the check honest: a gate with nothing to compare against must not
// report a listing as verified.
const noPin = classifyVersionRecord(healthyRecord(), SHIPS_BOTH, null);
assert.equal(noPin.exit, EXIT.INCONCLUSIVE, 'no capture pin must be INCONCLUSIVE, never READY');
assert.deepEqual(state(noPin, 'screenshots-pinned'), ['inconclusive']);

// Apple withholding a checksum is the same unanswered question, per set.
const noChecksum = classifyVersionRecord(healthyRecord({
    screenshotSets: REQUIRED_SCREENSHOT_TYPES.map((displayType) => ({
        displayType,
        count: 4,
        states: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE'],
        checksums: [UPLOADED[displayType][0], null, null, null],
    })),
}), SHIPS_BOTH, pinFor());
assert.equal(noChecksum.exit, EXIT.INCONCLUSIVE, 'an uncomparable set must not read as verified');

// The idiom-to-directory map is what joins the two halves, and asserting only
// its KEYS is not enough: pointing both types at one directory would compare
// the iPad set against iPhone images and pass, which is worse than no check.
// So the values are asserted DISTINCT and asserted against the directories the
// capture script actually writes, derived from its own device list rather than
// restated here.
assert.deepEqual(
    Object.keys(SCREENSHOT_DIR_BY_TYPE).sort(),
    [...REQUIRED_SCREENSHOT_TYPES].sort(),
    'every required display type needs a capture directory, or its set goes unchecked',
);
const dirs = Object.values(SCREENSHOT_DIR_BY_TYPE);
assert.equal(new Set(dirs).size, dirs.length, 'two display types sharing a directory compares a set against the wrong idiom');
const captureScript = readFileSync(
    new URL('../../../packages/mobile/scripts/screenshots.sh', import.meta.url), 'utf8',
);
// The script slugs each device name the same way: lowercase, spaces to
// hyphens, everything else dropped.
// Read the devices= line whole rather than balancing parentheses: a device
// name contains them ("iPad Pro 13-inch (M5)"), and a lazy bracket match stops
// inside the name and silently yields half a list.
const slugs = captureScript.split('\n')
    .filter((line) => /^\s*devices=\(\s*"/.test(line))
    .flatMap((line) => [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]))
    .filter((name) => !name.includes('$'))
    .map((name) => name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, ''));
assert.equal(slugs.length, REQUIRED_SCREENSHOT_TYPES.length,
    `expected one default capture device per display type, read ${JSON.stringify(slugs)}`);
for (const dir of dirs) {
    assert.ok(
        slugs.includes(dir),
        `${dir} is not a directory ${'packages/mobile/scripts/screenshots.sh'} writes (it writes ${slugs.join(', ')})`,
    );
}

// And the reader must survive a repository with no capture at all rather than
// throwing, since that is the state of any fresh clone.
assert.equal(pinnedListingDigests('/nonexistent-worktree'), null);

// --- 11. The two inputs that must be derived, never restated ----------------

// The project declares the bundle id TWICE and the uitests target is FIRST, so
// a first-match read queries an app that does not exist and reports a missing
// listing for one that is fine.
const bundleId = bundleIdFromProject();
assert.equal(bundleId, 'io.xchain.wallet.ios', 'the shipping bundle id comes from the Xcode project');
assert.ok(!bundleId.endsWith('.uitests'), 'the uitests target must never be what this gate queries');

// The capability inputs come from the same HIDDEN_SURFACES the runbook guard
// (mobile-ios-shell.smoke.js §16) reads, so the two cannot disagree about what
// the binary contains.
const ships = await shippedCapabilities();
assert.equal(typeof ships.messaging, 'boolean');
assert.equal(typeof ships.betting, 'boolean');
assert.equal(ships.messaging, true, 'messaging ships in the store profile today');
assert.equal(ships.betting, true, 'the betting lane ships in the store profile today ()');

// --- 12. The JWT is JOSE-shaped, not DER ------------------------------------
//
// Node signs ES256 as DER; App Store Connect accepts only fixed-width r||s. A
// DER signature fails as a 401, which reads exactly like a revoked key and
// sends the next person to rotate a credential that is fine.
// Generated fresh per run: the assertions below pin signature SHAPE (64-byte
// r||s, JOSE header, claim layout), none of which depends on which key signs,
// and a committed PEM would trip every secret scanner the day the repo is public.
const KEY_PEM = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' });
const jwt = ascToken({ keyPem: KEY_PEM, keyId: 'TESTKEYID', issuer: 'test-issuer', nowSec: 1_700_000_000 });
const [h, p, sig] = jwt.split('.');
assert.equal(jwt.split('.').length, 3, 'a JWT has three parts');
assert.equal(Buffer.from(sig, 'base64url').length, 64, 'the ES256 signature must be 64 bytes (r||s), not DER');
assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'ES256', kid: 'TESTKEYID', typ: 'JWT' });
const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
assert.equal(claims.aud, 'appstoreconnect-v1');
assert.equal(claims.iss, 'test-issuer');
assert.equal(claims.exp - claims.iat, 600, 'the token is short-lived');
assert.ok(!jwt.includes('='), 'base64url carries no padding');

console.log('appstore-version-check.smoke.js: OK');
