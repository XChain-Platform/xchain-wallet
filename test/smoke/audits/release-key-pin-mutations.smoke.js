// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Guards the guards.
//
// Three copies of K1's fingerprint have to agree: `SECURITY.md` here,
// `xchain.io/security/` in the sibling xchain-websites repo, and
// `UPDATE_PINNED_FINGERPRINT` in packages/desktop/main/updateVerify.js,
// which is the pin that actually gates a desktop update. Two suites hold
// them together: release-key-pin.smoke.js (this repo's pair) and
// xchain-websites' test/release-key-channels.test.js (the two publication
// channels).
//
// Both of those suites are GREEN today and will stay green until the key
// ceremony runs, which is the state in which a guard is easiest to get
// wrong: a check that reads nothing, or reads the wrong file, or asserts a
// condition that cannot fail, is indistinguishable from a working one while
// there is no key. The ceremony is run once, offline, under a passphrase.
// Finding out then that the guard never fired is finding out too late.
//
// So this drives the ceremony's real failure modes against a FIXTURE tree -
// a throwaway copy of the four files, never this checkout - and asserts that
// each one turns the expected suite red, for the expected reason. The reason
// matters as much as the colour: an assertion that fires with the wrong
// message is an assertion pointed at the wrong thing.
//
// Every mode also asserts which suite stays GREEN. That is not decoration.
// The pin is invisible to the websites test and the published page is
// invisible to this repo, so "the other one did not notice" is the seam
// these two suites exist to cover between them, and it is worth stating
// once per mode rather than assuming.
//
// The websites half needs the sibling checkout. Absent, it skips, and says
// which modes went unrun.

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));       // test/smoke/audits
const wsRoot = join(here, '..', '..', '..');                 // xchain-wallet

// Resolved from this file's location, never cwd: a run from anywhere finds
// the same checkout (a sibling resolved from cwd is how a gate ends up
// testing a directory that happens to be beside wherever it was launched).
const SITES_ROOT = process.env.XCHAIN_WEBSITES_ROOT || join(wsRoot, '..', 'xchain-websites');

const WALLET_GUARD = join(here, 'release-key-pin.smoke.js');
const SECURITY_REL = 'SECURITY.md';
const VERIFY_REL = join('packages', 'desktop', 'main', 'updateVerify.js');
const SITES_GUARD_REL = join('test', 'release-key-channels.test.js');
const PAGE_REL = join('xchain.io', 'security', 'index.html');

const sitesAvailable = existsSync(join(SITES_ROOT, SITES_GUARD_REL)) && existsSync(join(SITES_ROOT, PAGE_REL));

/* Same rule the docs sibling learned the hard way in: a sibling that
 * .ci-siblings PROMISES and the checkout does not have is a harness failure,
 * not a skip, because the skip is what let a gate report green having checked
 * nothing. xchain-websites is NOT declared today, so the channel half skips on
 * a lone wallet checkout and runs in the platform tree where the sibling sits
 * beside this repo. Adding the line to .ci-siblings is all it takes to make
 * FM3 and ES4 gate-enforced, and this refuses rather than skips from then on. */
if (!sitesAvailable) {
    const declared = (() => {
        try {
            return readFileSync(join(wsRoot, '.ci-siblings'), 'utf8')
                .split('\n').map((l) => l.trim())
                .filter((l) => l && !l.startsWith('#'))
                .includes('xchain-websites');
        } catch { return false; }
    })();
    if (declared) {
        console.error('FAIL release-key-pin-mutations.smoke.js: .ci-siblings declares xchain-websites, '
            + `so the harness is contracted to ship it, and it is not at ${SITES_ROOT}. Skipping here `
            + 'would report green on the two failure modes (FM3 channel disagreement, ES4 a blanked '
            + 'security page) that ONLY the websites suite can catch. Fix the checkout or set '
            + 'XCHAIN_WEBSITES_ROOT.');
        process.exit(1);
    }
}

/* Fixture values. Not real fingerprints and not real key material: the
 * point is the shape (40 uppercase hex) and whether two copies of it
 * match, so an obviously synthetic value is the honest one to use. */
const FP_A = 'A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4';
const FP_B = '0F1E2D3C4B5A69788796A5B4C3D2E1F009182736';
const SHORT_ID = FP_A.slice(-16);
const ARMORED = '-----BEGIN PGP PUBLIC KEY BLOCK-----\\n\\nZmFrZSBmaXh0dXJlIGtleSwgbm90IGEga2V5\\n-----END PGP PUBLIC KEY BLOCK-----\\n';

// ------------------------------------------------------------ mutators

/** Rewrite one single-quoted `export const NAME = '...'` in updateVerify.js. */
function setConstant(source, name, value) {
    const re = new RegExp(`(export const ${name} = ')[^']*(')`);
    assert.match(source, re, `updateVerify.js no longer exports ${name} as a single-quoted constant, `
        + 'so this harness cannot build the fixture. Point it at wherever the pin moved to.');
    return source.replace(re, `$1${value}$2`);
}

const pin = (source, { fingerprint = '', armored = '' } = {}) =>
    setConstant(setConstant(source, 'UPDATE_PINNED_FINGERPRINT', fingerprint),
        'UPDATE_PINNED_PUBKEY_ARMORED', armored);

/** Rewrite the value SECURITY.md publishes, keeping the label. */
function statesFingerprint(md, value) {
    const re = /(PGP fingerprint:)[^*\n]*/i;
    assert.match(md, re, 'SECURITY.md has no "PGP fingerprint:" label to mutate.');
    return md.replace(re, `$1 ${value}`);
}

/** Rewrite what xchain.io/security/ publishes. */
/* The page's own words for "no release exists yet". Named once because
 * three things now depend on the exact string: the two state-specific
 * guards in release-key-channels.test.js, and the fixtures below. */
const NO_RELEASE_SENTENCE = 'No XChain Wallet release has been signed or published yet';

/* The per-lane version of the same protection, for the state the project is
 * actually in: one signed release covering Android alone, and three lanes that
 * a reader must still be told nothing has been signed for. Written out rather
 * than derived, because the page names the lanes in its own words and the
 * websites guard builds the same sentence from data-release-coverage; two
 * independent constructions that must agree is the property worth having here.
 * It has a scheduled end: see mode ES5c. */
const UNSIGNED_LANES_SENTENCE = 'No desktop, extension or iOS release has been signed or published yet';

/* Sets the fingerprint AND the release-state attribute that has to agree with
 * it, because the page carries both and the guards read both.
 *
 * The attribute half was added 2026-08-08. Until then this rewrote only the
 * <code> block, which was coherent for as long as the live page said
 * data-release-state="none" - and it stopped being coherent the moment a real
 * release was published (xchain-websites `47c2247`). Every base here is DERIVED
 * from the live page, so an "unpublished" fixture then meant a page whose
 * fingerprint said "not yet published" while its own attribute said a release
 * was out: exactly the contradiction the guard `a published key is not by
 * itself a published release` exists to catch, arriving from the fixture rather
 * than from a defect. Three modes went red for the venue rather than the tree.
 *
 * This file's own header says a harness whose meaning depends on which side of
 * the ceremony the repo is on is not a harness on either side. Deriving one of
 * the two coupled values and inheriting the other was that dependency, hiding
 * in a helper. */
function pagePublishes(html, value) {
    if (!html) return html;            // sibling absent: the wallet half still runs
    const re = /(<code id="release-key-fingerprint">)[^<]*(<\/code>)/;
    assert.match(html, re, 'the security page has no <code id="release-key-fingerprint"> to mutate.');

    const stateRe = /(data-release-state=")[^"]*(")/;
    assert.match(html, stateRe, 'the security page has no data-release-state to keep in step with the '
        + 'fingerprint. The guards read both, so a fixture that sets one and inherits the other is '
        + 'self-contradictory the moment the live page changes state.');

    // The page's own vocabulary for "no release yet", matched rather than
    // guessed at: anything that is not that phrase is a real fingerprint.
    const state = /not yet published/i.test(value) ? 'none' : 'published';
    let out = html.replace(re, `$1${value}$2`).replace(stateRe, `$1${state}$2`);

    /* The THIRD coupled value. A page in the `none` state must carry the
     * sentence, and a page in the `published` state must not - those are two
     * guards in release-key-channels.test.js, one per state. The live page is
     * `published` and therefore no longer contains the sentence, so a `none`
     * fixture derived from it is missing something its own state requires.
     * Setting it here is what lets both states be built from whichever page
     * happens to be live, which is the property this helper exists for. */
    const has = out.includes(NO_RELEASE_SENTENCE);
    if (state === 'none' && !has) {
        out = out.replace('</body>', `<p>${NO_RELEASE_SENTENCE}</p></body>`);
    } else if (state === 'published' && has) {
        out = out.split(NO_RELEASE_SENTENCE).join('');
    }
    return out;
}

/* Deletes EVERY occurrence. A first-occurrence-only delete left the security
 * page still naming the other channel further down, the mode came back green,
 * and the harness read that as the guard failing to fire: a mutation that does
 * not fully mutate accuses the wrong file. */
/* The mirror of drop(), for a guard that forbids a sentence rather than
 * requiring one. It refuses for the same reason drop() does, from the other
 * side: if the needle is ALREADY there, adding it changes nothing and the mode
 * would report the guard firing on the base rather than on the mutation. */
const readd = (text, needle) => {
    if (!text) return text;            // sibling absent: the wallet half still runs
    assert.ok(!text.includes(needle), `fixture source ALREADY contains ${JSON.stringify(needle)}, `
        + 'so this mode would add nothing and prove nothing.');
    const anchor = '</body>';
    assert.ok(text.includes(anchor), `the security page has no ${anchor} to insert before.`);
    return text.replace(anchor, `<p>${needle}</p>${anchor}`);
};

const drop = (text, needle) => {
    if (!text) return text;            // sibling absent: the wallet half still runs
    assert.ok(text.includes(needle), `fixture source no longer contains ${JSON.stringify(needle)}, `
        + 'so this mode would delete nothing and prove nothing.');
    return text.split(needle).join('');
};

// ------------------------------------------------------------ fixture

const fixtureRoot = mkdtempSync(join(tmpdir(), 'xc1111-key-pin-'));
const fxWallet = join(fixtureRoot, 'xchain-wallet');
const fxSites = join(fixtureRoot, 'xchain-websites');

/* Side by side under one throwaway root, because the websites guard finds
 * SECURITY.md as ITS sibling. A fixture that got that layout wrong would
 * make every websites mode pass by reading the real checkout. */
function buildFixture({ security, verify, page }) {
    rmSync(fixtureRoot, { recursive: true, force: true });
    mkdirSync(join(fxWallet, 'test', 'smoke', 'audits'), { recursive: true });
    mkdirSync(join(fxWallet, 'packages', 'desktop', 'main'), { recursive: true });
    // The guards are ESM and CJS respectively; without these the fixture
    // would inherit whatever package.json happens to sit above tmpdir.
    writeFileSync(join(fxWallet, 'package.json'), '{"name":"fixture-wallet","type":"module"}\n');
    writeFileSync(join(fxWallet, SECURITY_REL), security);
    writeFileSync(join(fxWallet, VERIFY_REL), verify);
    cpSync(WALLET_GUARD, join(fxWallet, 'test', 'smoke', 'audits', 'release-key-pin.smoke.js'));

    if (!sitesAvailable) return;
    mkdirSync(join(fxSites, 'test'), { recursive: true });
    mkdirSync(join(fxSites, 'xchain.io', 'security'), { recursive: true });
    writeFileSync(join(fxSites, 'package.json'), '{"name":"fixture-websites","type":"commonjs"}\n');
    writeFileSync(join(fxSites, PAGE_REL), page);
    cpSync(join(SITES_ROOT, SITES_GUARD_REL), join(fxSites, SITES_GUARD_REL));
}

const run = (args, cwd) => {
    const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
    return { ok: r.status === 0, output: `${r.stdout}${r.stderr}` };
};

const runWalletGuard = () => run([join(fxWallet, 'test', 'smoke', 'audits', 'release-key-pin.smoke.js')], fxWallet);
const runSitesGuard = () => run(['--test', join(fxSites, SITES_GUARD_REL)], fxSites);

// ------------------------------------------------------------ the modes

const security0 = readFileSync(join(wsRoot, SECURITY_REL), 'utf8');
const verify0 = readFileSync(join(wsRoot, VERIFY_REL), 'utf8');
const page0 = sitesAvailable ? readFileSync(join(SITES_ROOT, PAGE_REL), 'utf8') : '';

const LIVE = { security: security0, verify: verify0, page: page0 };

/* THE BASE STATES, and why the modes below no longer start from the live tree.
 *
 * Every failure mode used to mutate ONE field of the checkout as it stood and
 * silently assume the other two were still in their pre-ceremony state. That
 * assumption held for exactly as long as no key existed, and the key ceremony
 * is what ends it: publishing K1 into SECURITY.md and the security page turned
 * SEVEN of these checks wrong at once (measured 2026-08-06). FM1 and FM2 went
 * red for "the two name DIFFERENT keys" rather than for the runbook step they
 * exist to catch, and ES5 went GREEN, which is the dangerous direction - the
 * sentence protecting readers from a fake "signed release" stopped being
 * guarded at the moment the key it accompanies became real.
 *
 * A harness whose meaning depends on which side of the ceremony the repo is on
 * is not a harness on either side. So each mode now names the base it starts
 * from, both bases are DERIVED from the live files (so a rename or a moved
 * constant still breaks loudly here), and the live tree is exercised by the
 * control alone. */
const UNPUBLISHED_BASE = {
    security: statesFingerprint(security0, 'not yet published.'),
    verify: pin(verify0),
    page: pagePublishes(page0, 'not yet published'),
};
const PUBLISHED_BASE = {
    security: statesFingerprint(security0, `${FP_A}.`),
    verify: pin(verify0, { fingerprint: FP_A, armored: ARMORED }),
    page: pagePublishes(page0, FP_A),
};

/* `wallet` and `sites` are either 'green' or a regex the failure output must
 * match. A mode that only says "something went red" would pass on a syntax
 * error in the guard it is supposed to be exercising. */
const MODES = [
    {
        name: 'control: the tree as it stands',
        why: 'if the tree as it stands were not green, every mode below would be red for free',
        base: LIVE,
        wallet: 'green',
        sites: 'green',
        mutate: (f) => f,
    },
    {
        name: 'happy path: ceremony finished, all three copies agree',
        why: 'a guard that cannot go green after a correct ceremony blocks the release it exists to protect',
        base: UNPUBLISHED_BASE,
        wallet: 'green',
        sites: 'green',
        mutate: (f) => ({
            security: statesFingerprint(f.security, `${FP_A}.`),
            verify: pin(f.verify, { fingerprint: FP_A, armored: ARMORED }),
            page: pagePublishes(f.page, FP_A),
        }),
    },
    {
        name: 'FM1 pin without publish: runbook §6 done, §7 skipped',
        why: 'the desktop app would trust a key no user can look up',
        base: UNPUBLISHED_BASE,
        wallet: /PINS a release key that SECURITY\.md still calls unpublished/,
        // Both channels still say "not yet published" and agree, so the
        // websites test is RIGHT to stay green: the pin is not one of its
        // two channels. This mode is the reason the wallet-side guard exists.
        sites: 'green',
        mutate: (f) => ({ ...f, verify: pin(f.verify, { fingerprint: FP_A, armored: ARMORED }) }),
    },
    {
        name: 'FM2 publish without pin: runbook §7 done, §6 skipped',
        why: 'every desktop update fails closed with update-key-not-pinned while the docs say the key is live',
        base: UNPUBLISHED_BASE,
        wallet: /pins nothing/,
        sites: /disagree about whether the key is published at all/,
        mutate: (f) => ({ ...f, security: statesFingerprint(f.security, `${FP_A}.`) }),
    },
    {
        name: 'FM3 the two publication channels name different keys',
        why: 'our own policy tells a reader who sees this to trust neither, so it must never reach a reader',
        base: PUBLISHED_BASE,
        // The wallet pair agrees with itself and cannot see the page: green
        // here is the seam, and it is why the websites test is not optional.
        wallet: 'green',
        sites: /publish DIFFERENT fingerprints/,
        mutate: (f) => ({
            security: statesFingerprint(f.security, `${FP_A}.`),
            verify: pin(f.verify, { fingerprint: FP_A, armored: ARMORED }),
            page: pagePublishes(f.page, FP_B),
        }),
    },
    {
        name: 'FM4 a short key id is published instead of the full fingerprint',
        why: 'short ids are forgeable, and a reader comparing gpg output against one learns nothing',
        base: PUBLISHED_BASE,
        wallet: /contains no 40-character/,
        sites: /full 40 uppercase hex characters|DIFFERENT fingerprints/,
        mutate: (f) => ({
            security: statesFingerprint(f.security, `${SHORT_ID}.`),
            verify: pin(f.verify, { fingerprint: FP_A, armored: ARMORED }),
            page: pagePublishes(f.page, SHORT_ID),
        }),
    },
    {
        name: 'FM5 the pin is spaced and lowercased, the way gpg prints it',
        why: 'the verifier compares byte-for-byte, so this fails every update at runtime while reading as correct in a diff',
        base: PUBLISHED_BASE,
        wallet: /40 uppercase hex/,
        sites: 'green',
        mutate: (f) => ({
            security: statesFingerprint(f.security, `${FP_A}.`),
            verify: pin(f.verify, { fingerprint: FP_A.toLowerCase().replace(/(.{4})/g, '$1 ').trim(), armored: ARMORED }),
            page: pagePublishes(f.page, FP_A),
        }),
    },

    // ------------------------------- the empty state, gated as strictly

    {
        name: 'ES1 half a pin: an armored key with no fingerprint beside it',
        why: 'the fingerprint is what makes a swapped armored block fail loudly instead of being trusted',
        base: UNPUBLISHED_BASE,
        wallet: /armored key is pinned with no fingerprint/,
        sites: 'green',
        mutate: (f) => ({ ...f, verify: pin(f.verify, { armored: ARMORED }) }),
    },
    {
        name: 'ES2 SECURITY.md goes blank rather than saying "not yet published"',
        why: 'a blank reads as an oversight, and the reader looks for the value somewhere less trustworthy',
        base: UNPUBLISHED_BASE,
        wallet: /label with a BLANK value/,
        sites: /disagree about whether the key is published at all/,
        mutate: (f) => ({ ...f, security: statesFingerprint(f.security, '') }),
    },
    {
        name: 'ES3 SECURITY.md drops the "PGP fingerprint:" label entirely',
        why: 'a SECURITY.md with no fingerprint label has stopped being publication channel one',
        base: UNPUBLISHED_BASE,
        wallet: /no longer carries a "PGP fingerprint:" line/,
        sites: /no longer carries a "PGP fingerprint:" line/,
        mutate: (f) => ({ ...f, security: f.security.replace(/PGP fingerprint:/gi, 'PGP key:') }),
    },
    {
        name: 'ES4 the security page blanks the fingerprint element',
        why: 'an empty element publishes nothing while looking like a channel',
        base: UNPUBLISHED_BASE,
        wallet: 'green',
        sites: /disagree about whether the key is published at all/,
        mutate: (f) => ({ ...f, page: pagePublishes(f.page, '') }),
    },
    {
        /* This mode used to DELETE `No XChain Wallet release has been signed or
         * published yet` and require the sites guard to demand it back. That
         * sentence is gone from the live page on purpose as of 2026-08-08
         * (xchain-websites `47c2247`, "the trust root told every visitor the
         * real release was a forgery"): a release IS signed and published now,
         * so the page was telling readers that a genuine release was fake.
         *
         * The mode broke loudly rather than quietly, which is the design - both
         * bases are DERIVED from the live files, so a moved constant lands
         * here - and `drop()` refused rather than deleting nothing and passing.
         *
         * The property worth guarding did not disappear, it INVERTED, and the
         * websites guard inverted with it: `once a release is signed, the page
         * stops saying none is`. So this mode now adds the sentence back to a
         * page whose own `data-release-state` says published, which is exactly
         * the state `47c2247` found and fixed. Retiring the mode instead would
         * have left that guard with nothing proving it bites, in a file whose
         * whole doctrine is that an unexercised guard is not known to work. */
        name: 'ES5 the page stops saying that nothing has been signed yet',
        why: 'while no release exists that sentence is the whole protection against a fake "signed release"',
        base: UNPUBLISHED_BASE,
        wallet: 'green',
        sites: /must state plainly that nothing is signed yet/,
        mutate: (f) => ({ ...f, page: drop(f.page, NO_RELEASE_SENTENCE) }),
    },
    {
        /* The other side of the same property, and the side the project is on
         * today. `47c2247` in xchain-websites found the page telling every
         * visitor that a genuine, signed release was a forgery, which is the
         * costlier direction: ES5's failure makes a reader trust something they
         * should not, this one makes them REFUSE something they should trust.
         * The guard for it existed with nothing exercising it, because this
         * harness only ever drove the unpublished window. */
        name: 'ES5b the page claims nothing is signed while a release IS published',
        why: 'a reader who believes that sentence refuses a genuine release, which is the forgery reading in reverse',
        base: PUBLISHED_BASE,
        wallet: 'green',
        sites: /still tells readers nothing has been signed/,
        mutate: (f) => ({ ...f, page: readd(f.page, NO_RELEASE_SENTENCE) }),
    },
    {
        /* THE SENTENCE THAT IS PROTECTIVE NOW, which is neither of the two
         * above. ES5 and ES5b drive the global claim in each of its
         * states, and between them they leave a gap the project is standing in:
         * a release IS signed, so the global sentence is rightly gone, and yet
         * three of the four lanes are exactly as unsigned as they were the day
         * before. What protects a reader looking for a desktop build today is
         * the page naming those lanes, and until this mode existed nothing
         * exercised the guard that requires it.
         *
         * IT EXPIRES BY DESIGN, and that is the whole reason to write it down
         * here rather than trust it. The sentence names the extension, so
         * publishing the Chrome Web Store listing (Phase 8) makes it
         * false, as do the desktop and iOS lanes. Each of those adds its lane
         * to the page's data-release-coverage, the websites guard then demands
         * a sentence naming the lanes that are LEFT, and this mode goes red
         * until the needle below is repointed at it. Repoint it; retiring it
         * would leave the last unsigned lane unguarded on the day it matters
         * most, which is the failure ES5 already made once. */
        name: 'ES5c the page stops saying which lanes are still unsigned',
        why: 'a reader told a signed release exists reads it as covering the download in front of them unless the page says otherwise',
        base: PUBLISHED_BASE,
        wallet: 'green',
        sites: /must name every lane no signed release covers/,
        mutate: (f) => ({ ...f, page: drop(f.page, UNSIGNED_LANES_SENTENCE) }),
    },
    {
        /* This mode used to delete the page's link to SECURITY.md and expect
         * the sites guard to complain that a reader cannot find the other
         * channel. That link is gone on purpose as of 2026-08-06: the wallet
         * repository is private, so the URL 404s for every reader, and the
         * page now DECLARES how many channels a reader can actually reach
         * instead of naming one they cannot. The property worth guarding did
         * not change - a page must not claim a cross-check the reader cannot
         * perform - only where it is written down. */
        name: 'ES6 the page stops declaring how many channels a reader can reach',
        why: 'a page that claims a second channel a reader cannot find is worse than one that admits it has one',
        base: UNPUBLISHED_BASE,
        wallet: 'green',
        sites: /carries no data-channel-count/i,
        mutate: (f) => ({ ...f, page: drop(f.page, ' data-channel-count="one"') }),
    },
];

// ------------------------------------------------------------ drive them

const failures = [];
let sitesChecks = 0;

for (const mode of MODES) {
    if (!mode.base) throw new Error(`mode "${mode.name}" names no base state; every mode must say `
        + 'whether it starts from a published or an unpublished tree, or it silently means something '
        + 'different on each side of the key ceremony.');
    const fixture = mode.mutate(mode.base);
    buildFixture(fixture);

    const checks = [['release-key-pin.smoke.js', mode.wallet, runWalletGuard()]];
    if (sitesAvailable) {
        checks.push(['xchain-websites release-key-channels.test.js', mode.sites, runSitesGuard()]);
        sitesChecks += 1;
    }

    for (const [suite, expected, result] of checks) {
        if (expected === 'green') {
            if (!result.ok) {
                failures.push(`${mode.name}\n    ${suite} went RED and should not have.\n`
                    + `    ${mode.why}\n${result.output.trim().split('\n').map((l) => `      ${l}`).join('\n')}`);
            }
            continue;
        }
        if (result.ok) {
            failures.push(`${mode.name}\n    ${suite} stayed GREEN. The mutation is a real ceremony `
                + `mistake and nothing caught it.\n    ${mode.why}`);
        } else if (!expected.test(result.output)) {
            failures.push(`${mode.name}\n    ${suite} went red for a DIFFERENT reason than ${expected}.\n`
                + '    A guard that fires on the wrong condition is pointed at the wrong thing.\n'
                + `${result.output.trim().split('\n').map((l) => `      ${l}`).join('\n')}`);
        }
    }
}

rmSync(fixtureRoot, { recursive: true, force: true });

if (failures.length) {
    console.error(`FAIL release-key-pin-mutations.smoke.js: ${failures.length} of the release-key `
        + 'guards did not behave as claimed.\n');
    for (const f of failures) console.error(`  - ${f}\n`);
    process.exit(1);
}

const channelHalf = sitesChecks === MODES.length
    ? 'each also through the websites publication-channel test'
    : `${sitesChecks} of them also through the websites publication-channel test`;
console.log(`PASS release-key-pin-mutations.smoke.js (${MODES.length} ceremony states driven`
    + `against a fixture tree, ${channelHalf}, and every one left the claimed suite red for the `
    + 'claimed reason and the other suite green)');

if (!sitesAvailable) {
    console.log(`  NOTE: the sibling xchain-websites checkout was not found at ${SITES_ROOT}, so the `
        + 'publication-channel half of every mode went UNRUN, including the two modes (FM3, ES4) that '
        + 'ONLY that suite can catch. Clone it beside this repo, or set XCHAIN_WEBSITES_ROOT.');
}
