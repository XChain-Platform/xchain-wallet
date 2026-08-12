// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The copy for the three passwords a restore asks for.
//
// A restore is the only screen in the wallet that asks for three different
// passwords at once (§19.4):
//
//   file     opens the backup FILE's envelope
//   wallet   opens the backed-up WALLET's seed / imported keys
//   device   what the restored wallet is re-sealed under here
//
// The mechanism shipped; the copy did not. Every failure came
// back saying "wrong password" without saying WHICH of the three it meant, so
// a password that is perfectly correct in one role reads as a failure when it
// is typed into another. The user has no way to tell a typo from a mix-up, and
// the mix-up is the likely one: two of the three are passwords they still use.
//
// Two things live here so they cannot drift apart:
//
//   1. The field LABELS. The restore screen renders them and the failure copy
//      quotes them, so a message always names a field the user can see. Tests
//      (unit, and the e2e that types the device password into the file field)
//      assert on these same constants.
//   2. The classification of a raw failure into copy that names the field.
//      It lives at the flow layer rather than in the form because the error
//      crosses the shell messaging boundary as a bare string: by the time the
//      extension popup sees it, the class and any code are gone and only
//      `message` survives. Same reason `_wifFailureMessage.js` sits here.
//
// The matchers below deliberately accept the OLD wording as well as the new.
// A shell that is one release behind still throws "wrong password or tampered
// file" across the boundary, and the user of the newer screen should still be
// told which password it wants.

/**
 * The restore screen's three field labels.
 *
 * `device` differs by mode on purpose: on a fresh install the user is choosing
 * this password, on an open vault they are confirming one they already have.
 */
export const RESTORE_PASSWORD_LABELS = {
    file: 'Backup password',
    wallet: 'Password of the wallet in this backup',
    device: {
        fresh: 'Password for this device',
        add: 'Your password on this device',
    },
};

/**
 * @param {'fresh' | 'add'} [mode]
 * @returns {string} the device field's label for this restore mode
 */
export function restoreDeviceLabel(mode) {
    return mode === 'add'
        ? RESTORE_PASSWORD_LABELS.device.add
        : RESTORE_PASSWORD_LABELS.device.fresh;
}

/**
 * Said once, above the three boxes.
 *
 * A user who does not know there are three roles reads the second and third
 * fields as the app asking for the same thing twice, and fills them with the
 * same string. That restores a wallet sealed under a password they think is
 * something else.
 */
export const RESTORE_PASSWORD_INTRO =
    'A restore asks for three different passwords: the one that opens this backup file, the one '
    + 'the backed-up wallet used on the device it came from, and the one this device unlocks '
    + 'with. They are often not the same, so each box below says which one it wants.';

/** Hints rendered under each field. Each one says what the field is NOT. */
export const RESTORE_PASSWORD_HINTS = {
    file: 'The password you set when you exported this backup file. Not the password of the '
        + 'wallet inside it, and not the password you unlock this app with.',
    wallet: 'What you unlocked this wallet with on the device you backed it up from. The backup '
        + 'file holds the wallet still locked, and this is the only thing that opens it.',
    device: {
        fresh: 'Pick the password this app will unlock with from now on. The restored wallet is '
            + 're-locked with it, so this is the only password you will need afterwards.',
        add: 'The password you already unlock this app with. The restored wallet is re-locked '
            + 'with it, so one password opens everything here.',
    },
};

/**
 * @param {'fresh' | 'add'} [mode]
 * @returns {string} the device field's hint for this restore mode
 */
export function restoreDeviceHint(mode) {
    return mode === 'add'
        ? RESTORE_PASSWORD_HINTS.device.add
        : RESTORE_PASSWORD_HINTS.device.fresh;
}

/** Copy for "this field is empty", by role. Named so the form cannot reword one. */
export function restorePasswordRequiredMessage(role, mode) {
    if (role === 'file') {
        return `The "${RESTORE_PASSWORD_LABELS.file}" field is required. It is the password you `
            + 'set when you exported this backup file.';
    }
    if (role === 'wallet') {
        return `The "${RESTORE_PASSWORD_LABELS.wallet}" field is required. It is the password you `
            + 'used on the device you backed it up from.';
    }
    return `The "${restoreDeviceLabel(mode)}" field is required. `
        + (mode === 'add'
            ? 'It is the password you already unlock this app with; the restored wallet is re-locked with it.'
            : 'It is the password this app will unlock with from now on; the restored wallet is re-locked with it.');
}

/**
 * Turn whatever a restore threw into copy that names the password it wants.
 *
 * @param {unknown} reason   the caught error, or its message
 * @param {{ mode?: 'fresh' | 'add' }} [opts]
 * @returns {string} plain-language copy naming a field on the restore screen
 */
export function restoreFailureMessage(reason, { mode = 'fresh' } = {}) {
    const raw = typeof reason === 'string'
        ? reason
        : (reason && typeof (/** @type {any} */ (reason).message) === 'string'
            ? /** @type {any} */ (reason).message
            : '');
    const name = reason && typeof (/** @type {any} */ (reason).name) === 'string'
        ? /** @type {any} */ (reason).name
        : '';
    const hay = `${name} ${raw}`.toLowerCase();

    // Checked before any password matcher: this one is NOT about a password at
    // all, and its old wording ("the backed-up wallet record has no kdfParams")
    // mentions the backed-up wallet, so the wallet matcher below would claim it
    // and send the user off to retype a password that was never the problem.
    if (/no kdfparams|missing the details needed to unlock/.test(hay)) {
        return 'The wallet inside this backup file is missing the details needed to unlock it, so '
            + 'no password can open it. Restore from a different backup file.';
    }
    // "Required" failures, from core (which words them with the fresh-install
    // labels, having no idea which mode is restoring) or from a shell guard
    // (which still words them as parameter names). Re-worded here so an 'add'
    // restore names the label that screen is actually showing.
    //
    // Checked BEFORE the wrong-password matchers, not after: core's "the
    // Password of the wallet in this backup field is required" quotes a label
    // the wrong-password matcher also looks for, so the later ordering turned
    // an empty box into "that is not the password", which is a different
    // instruction and the wrong one.
    if (isRequiredFailure(hay, 'wallet')) return restorePasswordRequiredMessage('wallet', mode);
    if (isRequiredFailure(hay, 'device')) return restorePasswordRequiredMessage('device', mode);
    if (isRequiredFailure(hay, 'file')) return restorePasswordRequiredMessage('file', mode);
    // The backed-up wallet's own password. Checked before the file one: its
    // message also
    // mentions the backup file (it says the file opened), so the file matcher
    // below would otherwise claim it and name the wrong field.
    if (/backupseedpassworderror|backed-up wallet|wallet inside it did not|wallet in this backup/.test(hay)) {
        return `The backup file opened, but that is not the password of the wallet inside it. `
            + `The "${RESTORE_PASSWORD_LABELS.wallet}" field wants the password you unlocked that `
            + `wallet with on the device you backed it up from, not this file's password and not `
            + `the password for this device.`;
    }
    if (/backuppassworderror|wrong password or tampered file|did not open the backup file/.test(hay)) {
        return `That password did not open the backup file. The "${RESTORE_PASSWORD_LABELS.file}" `
            + 'field wants the password you set when you exported this file, not the password of '
            + `the wallet inside it and not the "${restoreDeviceLabel(mode)}" you are setting `
            + 'below. If all three are right, the file itself has been changed.';
    }
    if (/refusing to overwrite/.test(hay)) {
        return 'This backup holds records this device already has, so nothing was changed. Tick '
            + '"Overwrite if any record collides" to restore over them.';
    }
    return sanitize(raw);
}

/**
 * Does this failure say "one of the boxes is empty", and about which role?
 *
 * Two spellings reach here and both have to be caught: the label-quoting copy
 * core throws now, and the parameter-name spelling the shell guards (and older
 * shells) still use.
 *
 * @param {string} hay   lowercased `${name} ${message}`
 * @param {'file' | 'wallet' | 'device'} role
 * @returns {boolean}
 */
function isRequiredFailure(hay, role) {
    if (!/is required/.test(hay)) return false;
    if (role === 'wallet') {
        return /walletpassword is required/.test(hay)
            || hay.includes(RESTORE_PASSWORD_LABELS.wallet.toLowerCase());
    }
    if (role === 'device') {
        return /devicepassword is required/.test(hay)
            || hay.includes(RESTORE_PASSWORD_LABELS.device.fresh.toLowerCase())
            || hay.includes(RESTORE_PASSWORD_LABELS.device.add.toLowerCase());
    }
    return /backuppassword is required/.test(hay)
        || hay.includes(RESTORE_PASSWORD_LABELS.file.toLowerCase());
}

/**
 * Last resort for a failure this module does not recognize: drop the
 * `someFunction: ` / `wallet.importBackup: ` prefix that identifies the code
 * rather than the problem, and hand back a sentence.
 *
 * @param {string} raw
 * @returns {string}
 */
function sanitize(raw) {
    const stripped = String(raw || '')
        .replace(/^[a-z][A-Za-z0-9_$]*(\.[A-Za-z0-9_$]+)*:\s*/, '')
        .trim();
    const guidance = 'Check the backup file, then each of the three passwords above.';
    if (stripped.length === 0) {
        return `That backup could not be restored. ${guidance}`;
    }
    const capitalized = stripped[0].toUpperCase() + stripped.slice(1);
    const sentence = /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
    // An unclassified failure is the one case where naming a single field
    // would be a guess, so it names all three rather than none.
    return `${sentence} ${guidance}`;
}
