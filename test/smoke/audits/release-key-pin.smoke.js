// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// K1's fingerprint lives in THREE places by design, and the key ceremony
// writes all three by hand ( §4, the S3 runbook §6-§7):
//
//   1. SECURITY.md            - publication channel one
//   2. xchain.io/security/    - publication channel two, a different repo,
//                               host and deploy path, which is the whole
//                               point: an attacker must compromise both
//   3. updateVerify.js        - the PIN, compiled into the desktop app,
//                               which is what actually gates an update
//
// Channels one and two are compared by xchain-websites'
// test/release-key-channels.test.js. This file holds the seam that test
// cannot see, because it spans two repos in the other direction: the two
// copies that live HERE.
//
// The failure it exists to catch is not exotic, it is the ordinary one.
// The ceremony is a long checklist run once, under a passphrase, on
// detached media; §6 pins the key and §7 publishes it, and those are
// different steps with different edit targets. Pin without publishing and
// the desktop app trusts a key no user can check. Publish without pinning
// and every desktop update fails closed with `update-key-not-pinned`
// while SECURITY.md says the key is live - the app is right and the
// documentation is wrong, which is the harder one to diagnose.
//
// Both halves ship EMPTY today and that is the correct pre-launch state:
// there is no key, no signed release, and every verification fails closed.
// So this file checks the EMPTY state just as strictly as the filled one,
// because a guard that only starts working after the event it guards is
// not a guard.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const security = read('SECURITY.md');
const updateVerify = read('packages/desktop/main/updateVerify.js');

/* The pin is a source constant, so it is read as one. A regex over the
 * export keeps this from depending on the module's runtime (it imports
 * openpgp, which a smoke has no business loading to read a string). */
const constant = (name) => {
    const m = new RegExp(`export const ${name} = '([^']*)'`).exec(updateVerify);
    assert.ok(m, `updateVerify.js no longer exports ${name} as a single-quoted constant. `
        + 'It is the pinned trust root for every desktop update; if it moved, this smoke '
        + 'must be pointed at wherever it moved to, not deleted.');
    return m[1];
};

const pinnedFingerprint = constant('UPDATE_PINNED_FINGERPRINT');
const pinnedKey = constant('UPDATE_PINNED_PUBKEY_ARMORED');

/* SECURITY.md states it in prose. Bounded by the label on its left so a
 * reworded paragraph does not break the read, while REMOVING the label
 * does - correctly, since a SECURITY.md with no fingerprint label has
 * stopped being publication channel one.
 *
 * The whitespace classes are `[^\S\n]` and not `\s` ON PURPOSE. With `\s`
 * the match walks over the line break, so a label with nothing after it
 * captured the FIRST SENTENCE OF THE NEXT PARAGRAPH and this file then
 * compared a pin against that (measured 2026-08-04 by
 * release-key-pin-mutations.smoke.js mode ES2). A blank value has to read
 * as blank, which is what the emptiness check below can then say. */
const stated = (() => {
    const m = /PGP fingerprint:[^\S\n]*\**[^\S\n]*([^*\n.]*)/i.exec(security);
    assert.ok(m, 'SECURITY.md no longer carries a "PGP fingerprint:" line. It is one of the '
        + 'two channels  §4 requires K1 to be published through, and the ceremony '
        + 'runbook §7 edits exactly that line.');
    /* A label with nothing after it is the worst of the three states: it
     * reads as an oversight, so a reader goes looking for the fingerprint
     * somewhere with no provenance at all. Say "not yet published" or say
     * the value. */
    assert.notEqual(m[1].trim(), '', 'SECURITY.md carries the "PGP fingerprint:" label with a BLANK '
        + 'value. Publish the fingerprint or state that it is not yet published; a blank leaves the '
        + 'reader to find the trust root somewhere we do not control.');
    return m[1].trim();
})();

const UNPUBLISHED = /not yet published/i;
const statedPublished = !UNPUBLISHED.test(stated);
const pinPresent = pinnedFingerprint !== '';

// ------------------------------------------- pin and publication agree

{
    assert.equal(pinPresent, statedPublished,
        pinPresent
            ? 'the desktop app PINS a release key that SECURITY.md still calls unpublished. '
              + 'Users cannot check the key their wallet is trusting, which is the situation '
              + 'two-channel publication exists to prevent. Finish ceremony runbook §7.'
            : `SECURITY.md publishes a fingerprint ("${stated}") but updateVerify.js pins nothing, `
              + 'so every desktop update fails closed with `update-key-not-pinned` while the '
              + 'documentation says the key is live. Finish ceremony runbook §6.');
}

// ----------------------------------------------- the values are the same

if (pinPresent) {
    assert.match(pinnedFingerprint, /^[0-9A-F]{40}$/,
        `UPDATE_PINNED_FINGERPRINT is "${pinnedFingerprint}". It must be 40 uppercase hex `
        + 'characters with no spaces: the verifier compares it byte-for-byte against what '
        + 'openpgp reports, so a spaced or lowercased value fails every update at runtime '
        + 'while looking correct in a diff.');

    const statedHex = (/[0-9A-F]{40}/i.exec(stated) || [])[0];
    assert.ok(statedHex, `SECURITY.md states "${stated}", which contains no 40-character `
        + 'fingerprint. Channel one must publish the full fingerprint; a short key id is '
        + 'forgeable and cannot be compared against the pin.');
    assert.equal(statedHex.toUpperCase(), pinnedFingerprint,
        'SECURITY.md and the desktop pin name DIFFERENT keys. One of them is wrong and '
        + 'nothing in this repo can say which: check both against the key on the ceremony '
        + 'media before touching either.');

    assert.ok(pinnedKey.includes('BEGIN PGP PUBLIC KEY BLOCK'),
        'a fingerprint is pinned but no armored key is. verifyManifestSignature has nothing '
        + 'to verify against, so every update fails closed: paste the exported public key '
        + '(including the signing subkey) into UPDATE_PINNED_PUBKEY_ARMORED.');
} else {
    assert.equal(pinnedKey, '',
        'an armored key is pinned with no fingerprint beside it. The fingerprint is the '
        + 'cross-check that makes a swapped armored block fail loudly instead of being '
        + 'trusted, so half a pin is worse than none.');
}

// --------------------------------- the empty state says so, out loud

if (!pinPresent) {
    assert.match(security, /not yet published/i,
        'no key is pinned, so SECURITY.md must say the fingerprint is not yet published '
        + 'rather than leave a blank a reader could mistake for an oversight.');
    assert.match(updateVerify, /update-key-not-pinned/,
        'with nothing pinned, the updater must fail closed on a named reason. An unpinned '
        + 'key that verified anything would be an install path with no trust root at all.');
}

// Says which state it verified, because "no output" and "nothing was checked"
// look identical in a smoke run, and this file is green either way until the
// ceremony runs. release-key-pin-mutations.smoke.js proves it can go red.
console.log(`PASS release-key-pin.smoke.js (${pinPresent
    ? `K1 ${pinnedFingerprint} is pinned and published through SECURITY.md`
    : 'no key pinned and SECURITY.md says so: the pre-ceremony state, gated'})`);
