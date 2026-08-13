// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// packages/desktop/scripts/macos-signing.cjs - is this build allowed to
// produce UNSIGNED or UNNOTARIZED macOS artifacts, and if not, what exactly
// is missing?
//
// THE TWIN OF scripts/windows-signing.cjs, and it exists because the macOS
// lane had the same hole the Windows one had. The v0.336.0 release shipped
// both mac zips with no `_CodeSignature/CodeResources` and both dmgs with no
// usable signature, from a GREEN job, because `CSC_LINK: ${{ secrets.
// MACOS_CSC_LINK }}` on an unset secret expands to the empty string and
// app-builder-lib treats "no certificate" as a configuration choice rather
// than as a failure. The Snap and Mac App Store lanes in the same workflow
// guard themselves (`if: env.*_CSC_LINK != ''`, `forceCodeSigning`); the
// mainline desktop lane did not.
//
// THREE SILENT PATHS, and this file is scoped to all three because they end
// in the same place:
//
//   1. no certificate at all - `MAC_IDENTITY` in the build config resolves
//      to null, `macPackager.sign` returns before it looks at anything else,
//      and the build exits 0 with correctly named unsigned artifacts;
//   2. a certificate with no passphrase - CSC_LINK carries a .p12 (or its
//      base64), and electron-builder cannot import it without
//      CSC_KEY_PASSWORD, so the import fails and signing is skipped;
//   3. a signed build that is never NOTARIZED - `mac.notarize` in the config
//      is `Boolean(process.env.APPLE_API_KEY_ID)`, so one absent variable
//      turns notarization off with no message at all. Gatekeeper blocks an
//      un-notarized download exactly as it blocks an unsigned one, and
//      `verify-signatures.mjs` fails the `codesign-dmg` row for it.
//
// WHY IT IS NOT ENOUGH TO LET THE ARTIFACT GATE CATCH IT.
// `verify-signatures.mjs` answers "nothing signed this file", at the far end
// of the release, after both OS lanes have run, the artifacts are staged and
// a human is standing at the signing machine. This answers "the lane was
// never given <VARIABLE>", before a single byte is packed. Both answers are
// wanted and neither substitutes for the other: this one cannot see whether
// Apple actually issued a ticket, and that one cannot see why.
//
// THE REQUIREMENT IS OPT-IN, ON PURPOSE. `pnpm run dist` on a dev machine
// with no certificate is a legitimately unsigned build and must stay quiet,
// which is also why the build config leaves `mac.identity` null there. A
// release lane building the artifact users install is never legitimately
// unsigned, so it declares XCHAIN_REQUIRE_MAC_SIGNING=1 and this file
// refuses. A lane added later without the flag is exactly as silent as the
// defect above, so test/smoke/audits/macos-signing-required.smoke.js asserts
// from the workflow text that every step building a mainline mac artifact
// declares it and passes the values through.

'use strict';

/** The env var a lane sets to say "an unsigned macOS build is a failure". */
const REQUIRE_VAR = 'XCHAIN_REQUIRE_MAC_SIGNING';

/**
 * The certificate itself. EITHER of these satisfies the requirement, which
 * is why they are one list with an either/or rule rather than two required
 * variables: CSC_LINK is how release.yml supplies a Developer ID .p12,
 * CSC_KEYCHAIN is how a local Developer-ID rehearsal points at one already
 * imported. The build config reads exactly this pair to decide whether a
 * certificate was supplied at all (`macSigningCertSupplied`).
 */
const CERT_VARS = ['CSC_LINK', 'CSC_KEYCHAIN'];

/**
 * Required only alongside CSC_LINK. A .p12 is an encrypted container and
 * electron-builder imports it with this passphrase; a keychain that is
 * already unlocked needs none, so demanding it unconditionally would break
 * the local rehearsal path this check is meant to leave alone.
 */
const CERT_PASSWORD_VAR = 'CSC_KEY_PASSWORD';

/**
 * The App Store Connect API key the notarization half needs. APPLE_API_KEY_ID
 * is the trigger the build config reads, and the other three are what the
 * request cannot be made without, so a lane carrying only the trigger fails
 * mid-notarization instead of before the build. All four are listed because
 * the interesting failure is the reverse: the trigger absent and the rest
 * present, which turns notarization off in silence.
 */
const NOTARIZE_VARS = [
    'APPLE_API_KEY',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
    'APPLE_TEAM_ID',
];

const present = (env, name) => Boolean(env[name] && String(env[name]).trim());

/**
 * What macOS signing material does this environment actually carry?
 *
 * @param {Record<string, string|undefined>} env
 * @returns {{
 *   required: boolean,
 *   certSource: 'csc-link'|'keychain'|'none',
 *   ready: boolean,
 *   missingCert: string[],
 *   missingNotarize: string[],
 * }}
 */
function macosSigningStatus(env = process.env) {
    let certSource = 'none';
    if (present(env, 'CSC_LINK')) certSource = 'csc-link';
    else if (present(env, 'CSC_KEYCHAIN')) certSource = 'keychain';

    const missingCert = [];
    if (certSource === 'none') missingCert.push(...CERT_VARS);
    else if (certSource === 'csc-link' && !present(env, CERT_PASSWORD_VAR)) {
        missingCert.push(CERT_PASSWORD_VAR);
    }

    const missingNotarize = NOTARIZE_VARS.filter((name) => !present(env, name));

    return {
        required: env[REQUIRE_VAR] === '1',
        certSource,
        ready: missingCert.length === 0 && missingNotarize.length === 0,
        missingCert,
        missingNotarize,
    };
}

/**
 * The named missing-credential failure. Thrown while the config is being
 * loaded, so it lands before any packing work and cannot be mistaken for a
 * build error.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {ReturnType<typeof macosSigningStatus>}
 */
function assertMacosSigningMaterial(env = process.env) {
    const status = macosSigningStatus(env);
    if (!status.required || status.ready) return status;

    const lines = [
        'MacSigningCredentialsMissing: this lane set '
        + `${REQUIRE_VAR}=1, so an UNSIGNED or UNNOTARIZED macOS build is a`,
        'failure, and the material it needs is not in the environment.',
        '',
    ];

    if (status.missingCert.length) {
        if (status.certSource === 'none') {
            lines.push('No Developer ID certificate was supplied. Set ONE of:');
            for (const name of CERT_VARS) lines.push(`  - ${name}`);
            lines.push('');
            lines.push('With neither, the build config resolves mac.identity to null and'
                + ' app-builder-lib returns from macPackager.sign before it signs anything,'
                + ' exit 0, with correctly named unsigned artifacts. That is the silent'
                + ' unsigned release this check exists to refuse.');
        } else {
            lines.push('A certificate was supplied through CSC_LINK, but the passphrase that'
                + ' opens it is missing:');
            for (const name of status.missingCert) lines.push(`  - ${name}`);
            lines.push('');
            lines.push('A .p12 that cannot be imported signs nothing, and the import failure'
                + ' does not stop the build.');
        }
        lines.push('');
    }

    if (status.missingNotarize.length) {
        // The sharpest case, and the one that reads as configured: a build can
        // be perfectly signed and still be blocked on every user's machine,
        // because Gatekeeper wants the ticket rather than the signature.
        lines.push('Notarization is not configured. Missing:');
        for (const name of status.missingNotarize) lines.push(`  - ${name}`);
        lines.push('');
        lines.push('mac.notarize is Boolean(APPLE_API_KEY_ID), so an absent key id turns'
            + ' notarization off without a message, and an un-notarized download shows the'
            + ' unidentified-developer warning exactly as an unsigned one does.');
        lines.push('');
    }

    lines.push('Set the values on the release lane, or drop '
        + `${REQUIRE_VAR} to take a deliberately unsigned dev build.`);

    const err = new Error(lines.join('\n'));
    err.name = 'MacSigningCredentialsMissing';
    err.missing = [...status.missingCert, ...status.missingNotarize];
    throw err;
}

module.exports = {
    REQUIRE_VAR,
    CERT_VARS,
    CERT_PASSWORD_VAR,
    NOTARIZE_VARS,
    macosSigningStatus,
    assertMacosSigningMaterial,
};
