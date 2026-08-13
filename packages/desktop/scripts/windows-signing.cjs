// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// packages/desktop/scripts/windows-signing.cjs - is this build allowed to
// produce UNSIGNED Windows artifacts, and if not, what exactly is missing?
//
// WHY THIS IS ITS OWN FILE AND ITS OWN DECISION. Windows signing is
// selected in electron-builder.config.cjs off the environment, and every
// missing piece of that environment is silent by construction:
//
//   - the three Azure CONFIG values are read by the config itself, and one
//     of them absent drops the whole `azureSignOptions` block and falls
//     back to the classic signtool path;
//   - the classic path with no CSC_LINK signs nothing and exits 0;
//   - the three Azure CREDENTIALS are read by the Azure SDK, never by the
//     config, so the config cannot even see whether they are there.
//
// The end of every one of those paths is the same: a complete,
// correctly-named, two-architecture set of UNSIGNED installers, built by a
// green lane. `verify-signatures.mjs` catches that at the far end of the
// release, after both OS lanes have run and the artifacts are staged. This
// catches it at the near end, before a single byte is packed, and names the
// variable that is missing instead of leaving an operator to diff a
// workflow against a config.
//
// BOTH CHECKS ARE WANTED, and they are not redundant. This one cannot see
// whether the signature actually landed (a live Azure endpoint can reject a
// request, a certificate profile can be revoked), and the artifact check
// cannot see WHY a file is unsigned. One says "the lane was never given
// credentials"; the other says "nothing signed this file". A release needs
// both answers, because the fixes are different.
//
// THE REQUIREMENT IS OPT-IN, ON PURPOSE. `pnpm run dist` on a dev machine
// with no signing environment at all is a legitimately unsigned build and
// must stay quiet; a release lane building the artifact users install never
// is. So the release workflow declares the requirement with
// XCHAIN_REQUIRE_WIN_SIGNING=1, the same shape as `forceCodeSigning` on the
// Mac App Store lane. A lane that forgets to declare it is the obvious way
// to lose this guard, so test/smoke/audits/windows-signing-required.smoke.js
// asserts that every step in release.yml which builds a Windows artifact sets
// it, and passes the six values through so the requirement can be met.

'use strict';

/** The env var a lane sets to say "an unsigned Windows build is a failure". */
const REQUIRE_VAR = 'XCHAIN_REQUIRE_WIN_SIGNING';

/**
 * The three Azure Trusted Signing values the BUILD CONFIG reads (rails D3 /
 * DD2). `endpoint` is required by electron-builder's v26 type and is
 * region-specific, so none of these can be defaulted.
 */
const AZURE_CONFIG_VARS = [
    'AZURE_CODE_SIGNING_ENDPOINT',
    'AZURE_CODE_SIGNING_NAME',
    'AZURE_CERT_PROFILE_NAME',
];

/**
 * The three Entra ID credentials the AZURE SDK reads. They are deliberately
 * absent from the build config (they would land in
 * `builder-effective-config.yaml`), which is exactly why their absence is
 * invisible there and has to be checked here: with the config trio set and
 * these three missing, the config emits a perfect `azureSignOptions` block
 * and the signing call fails or is skipped at pack time.
 */
const AZURE_CREDENTIAL_VARS = [
    'AZURE_TENANT_ID',
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET',
];

/** The classic certificate path, kept because the config still offers it. */
const CLASSIC_VARS = ['CSC_LINK', 'CSC_KEY_PASSWORD'];

const present = (env, name) => Boolean(env[name] && String(env[name]).trim());

/**
 * What signing material does this environment actually carry?
 *
 * @param {Record<string, string|undefined>} env
 * @returns {{
 *   required: boolean,
 *   path: 'azure'|'classic'|'none',
 *   ready: boolean,
 *   missingAzure: string[],
 *   missingClassic: string[],
 * }}
 */
function windowsSigningStatus(env = process.env) {
    const missingAzure = [...AZURE_CONFIG_VARS, ...AZURE_CREDENTIAL_VARS]
        .filter((name) => !present(env, name));
    const missingClassic = CLASSIC_VARS.filter((name) => !present(env, name));
    // Which path the config will take is decided by the CONFIG trio alone
    // (see azureSigning in electron-builder.config.cjs), not by whether the
    // credentials are there - that asymmetry is the whole trap, so it is
    // modelled rather than smoothed over.
    const azureSelected = AZURE_CONFIG_VARS.every((name) => present(env, name));
    const path = azureSelected ? 'azure' : (missingClassic.length ? 'none' : 'classic');
    const ready = azureSelected ? missingAzure.length === 0 : missingClassic.length === 0;
    return {
        required: env[REQUIRE_VAR] === '1',
        path,
        ready,
        missingAzure,
        missingClassic,
    };
}

/**
 * The named missing-credential failure. Thrown while the config is being
 * loaded, so it lands before any packing work and cannot be mistaken for a
 * build error.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {ReturnType<typeof windowsSigningStatus>}
 */
function assertWindowsSigningMaterial(env = process.env) {
    const status = windowsSigningStatus(env);
    if (!status.required || status.ready) return status;

    const lines = [
        'WindowsSigningCredentialsMissing: this lane set '
        + `${REQUIRE_VAR}=1, so an UNSIGNED Windows build is a failure, and the`,
        'signing material it needs is not in the environment.',
        '',
    ];
    if (status.path === 'azure') {
        // The sharpest case: the config trio is complete, so the build looks
        // configured for Azure and would have been packed and signed by
        // nothing at all.
        lines.push('Azure Trusted Signing is SELECTED (the three config values are set) but'
            + ' these credentials are missing, and the build config never reads them,'
            + ' so nothing else can notice:');
        for (const name of status.missingAzure) lines.push(`  - ${name}`);
    } else {
        lines.push('Azure Trusted Signing (rails D3 / DD2) is not configured. Missing:');
        for (const name of status.missingAzure) lines.push(`  - ${name}`);
        lines.push('');
        lines.push('The classic signtool path is not configured either. Missing:');
        for (const name of status.missingClassic) lines.push(`  - ${name}`);
        lines.push('');
        lines.push('With a partial Azure environment the config drops azureSignOptions'
            + ' entirely and falls back to the classic path, which signs nothing when'
            + ' CSC_LINK is unset. That is the silent unsigned release this check exists'
            + ' to refuse.');
    }
    lines.push('');
    lines.push('Set the values on the release lane, or drop '
        + `${REQUIRE_VAR} to take a deliberately unsigned dev build.`);

    const err = new Error(lines.join('\n'));
    err.name = 'WindowsSigningCredentialsMissing';
    err.missing = status.path === 'azure'
        ? status.missingAzure
        : [...status.missingAzure, ...status.missingClassic];
    throw err;
}

module.exports = {
    REQUIRE_VAR,
    AZURE_CONFIG_VARS,
    AZURE_CREDENTIAL_VARS,
    CLASSIC_VARS,
    windowsSigningStatus,
    assertWindowsSigningMaterial,
};
