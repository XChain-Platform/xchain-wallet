// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §14: a release lane cannot produce UNSIGNED Windows artifacts
// quietly. It either signs them or fails by name.
//
// WHAT WAS ALREADY GUARDED AND WHAT WAS NOT. `verify-signatures.mjs` reads
// the PE certificate table of every staged `.exe` and refuses a release whose
// installers are unsigned; `release-signature-gate.smoke.js` drives that in
// both directions. So the FAR end of the release was covered. The near end
// was not: the build itself treated a missing credential as a configuration
// choice, produced correctly-named installers, and exited 0, so the answer
// arrived at manifest-signing time as "these files are unsigned" with nothing
// saying which variable was absent on which lane.
//
// The three shapes of that failure are all silent, which is why the check
// tests all three rather than one:
//   1. nothing configured at all - the classic signtool path with no
//      certificate, which signs nothing and warns nobody;
//   2. a PARTIAL Azure environment - the config drops `azureSignOptions`
//      entirely and falls back to (1), so a lane with two of three config
//      values looks configured and is not;
//   3. a COMPLETE Azure config with missing Entra credentials - the config
//      emits a perfect `azureSignOptions` block, and it cannot see the
//      credentials at all because the Azure SDK reads them, not the config.
//
// THE OTHER HALF OF THIS FILE IS THE WORKFLOW, and it is the half most likely
// to rot. The requirement is opt-in (an unsigned dev build is legitimate), so
// a Windows build step added later without the flag is exactly as silent as
// the defect above. Every step in release.yml that builds a Windows artifact
// must declare it, and that is asserted from the workflow text rather than
// remembered.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const require = createRequire(import.meta.url);

const CONFIG = join(root, 'packages/desktop/electron-builder.config.cjs');
const HELPER = join(root, 'packages/desktop/scripts/windows-signing.cjs');

const {
    REQUIRE_VAR,
    AZURE_CONFIG_VARS,
    AZURE_CREDENTIAL_VARS,
    CLASSIC_VARS,
    windowsSigningStatus,
    assertWindowsSigningMaterial,
} = require(HELPER);

const AZURE_CONFIG = {
    AZURE_CODE_SIGNING_ENDPOINT: 'https://eus.codesigning.azure.net/',
    AZURE_CODE_SIGNING_NAME: 'xchain-signing',
    AZURE_CERT_PROFILE_NAME: 'xchain-profile',
};
// Values, never real credentials: these are the SHAPE of the environment, and
// a fixture that looked like a secret would be one more thing to rotate.
const AZURE_CREDS = {
    AZURE_TENANT_ID: 'tenant-placeholder',
    AZURE_CLIENT_ID: 'client-placeholder',
    AZURE_CLIENT_SECRET: 'secret-placeholder',
};

// Every variable the config or the helper reads, cleared before each load so
// the assertions describe the config and not the shell that invoked the suite.
const OWNED_VARS = [REQUIRE_VAR, ...AZURE_CONFIG_VARS, ...AZURE_CREDENTIAL_VARS,
    ...CLASSIC_VARS, 'CSC_KEYCHAIN', 'CSC_IDENTITY_NAME', 'XCHAIN_STAGING_FEED_URL',
    'XCHAIN_BUILD_MAS', 'XCHAIN_BUILD_APPX', 'XCHAIN_BUILD_SNAP'];

/** Load the build config fresh under a given environment. */
function loadConfig(env = {}) {
    const saved = {};
    for (const k of OWNED_VARS) {
        saved[k] = process.env[k];
        delete process.env[k];
    }
    Object.assign(process.env, env);
    try {
        delete require.cache[require.resolve(CONFIG)];
        return require(CONFIG);
    } finally {
        for (const k of OWNED_VARS) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
        delete require.cache[require.resolve(CONFIG)];
    }
}

/** Load the config and return the error it threw, or null. */
function loadError(env) {
    try {
        loadConfig(env);
        return null;
    } catch (err) {
        return err;
    }
}

// ---------------------------------------------- the requirement is opt-in

{
    // A dev build with no signing environment stays a dev build. This is the
    // property the whole check is scoped around: making an unsigned build fail
    // everywhere would break `pnpm run dist` on every machine that has no
    // certificate, which is every machine except the release lane.
    const cfg = loadConfig();
    assert.ok(cfg.win.signtoolOptions,
        'with no requirement declared the classic path is still configured');
    assert.equal(cfg.win.azureSignOptions, undefined,
        'and no Azure block is invented');

    // Not '1' means not required. A lane that writes `true` or `yes` gets an
    // unsigned build, which is worse than a typo that fails - so pin the
    // comparison rather than accepting anything truthy, and keep the pin
    // visible here where the workflow assertion below can be read against it.
    assert.equal(windowsSigningStatus({ [REQUIRE_VAR]: 'true' }).required, false,
        `${REQUIRE_VAR} is exactly '1'; release.yml is asserted to set that literal below`);
}

// ------------------------------------- 1. nothing configured, but required

{
    const err = loadError({ [REQUIRE_VAR]: '1' });
    assert.ok(err, 'a required Windows signature with no material fails the build');
    assert.equal(err.name, 'WindowsSigningCredentialsMissing',
        'the failure is named, so a release log says what happened');

    // Named credentials, not a vague "signing is not configured". The whole
    // point is that the operator reads the message and knows which secret to
    // set on which lane.
    for (const name of [...AZURE_CONFIG_VARS, ...AZURE_CREDENTIAL_VARS, ...CLASSIC_VARS]) {
        assert.ok(err.message.includes(name),
            `the error names ${name} as missing`);
    }
    assert.ok(/UNSIGNED/.test(err.message),
        'and says what would otherwise have been produced');
}

// ------------------------------ 2. a PARTIAL Azure environment still fails

{
    // Two of the three config values: `azureSignOptions` is dropped whole and
    // the build silently becomes a classic-path build with no certificate.
    // Without the requirement that is a legitimate dev fallback (asserted in
    // desktop-build-config.smoke.js); with it, it is a release that would
    // have shipped unsigned.
    const partial = { ...AZURE_CONFIG, [REQUIRE_VAR]: '1' };
    delete partial.AZURE_CODE_SIGNING_ENDPOINT;

    const err = loadError(partial);
    assert.ok(err, 'a partial Azure environment fails when a signature is required');
    assert.equal(err.name, 'WindowsSigningCredentialsMissing');
    assert.ok(err.message.includes('AZURE_CODE_SIGNING_ENDPOINT'),
        'the one missing config value is named');
    assert.ok(!err.message.includes('  - AZURE_CODE_SIGNING_NAME'),
        'the values that ARE set are not listed as missing');
}

// -------------- 3. a COMPLETE Azure config with no credentials still fails

{
    // The sharpest case, and the one nothing else in the tree can see: the
    // config emits a valid `azureSignOptions` block, so every existing
    // assertion about the config passes, and the credentials it needs are
    // read by a different process entirely.
    const err = loadError({ ...AZURE_CONFIG, [REQUIRE_VAR]: '1' });
    assert.ok(err, 'a configured Azure lane with no Entra credentials fails');
    assert.equal(err.name, 'WindowsSigningCredentialsMissing');
    for (const name of AZURE_CREDENTIAL_VARS) {
        assert.ok(err.message.includes(name), `the error names ${name}`);
    }
    assert.deepEqual(err.missing, AZURE_CREDENTIAL_VARS,
        'and exactly the three credentials are what is missing');
    for (const name of AZURE_CONFIG_VARS) {
        assert.ok(!err.message.includes(`  - ${name}`),
            `${name} is set and must not be listed as missing`);
    }

    // One credential short is the same failure: two of three is not "mostly
    // signed".
    const twoOfThree = { ...AZURE_CONFIG, ...AZURE_CREDS, [REQUIRE_VAR]: '1' };
    delete twoOfThree.AZURE_CLIENT_SECRET;
    const partialErr = loadError(twoOfThree);
    assert.ok(partialErr, 'one missing credential fails as hard as three');
    assert.deepEqual(partialErr.missing, ['AZURE_CLIENT_SECRET']);
}

// ------------------------------------------ the complete environment builds

{
    const cfg = loadConfig({ ...AZURE_CONFIG, ...AZURE_CREDS, [REQUIRE_VAR]: '1' });
    assert.ok(cfg.win.azureSignOptions,
        'a complete Azure environment satisfies the requirement and selects Azure');
    assert.equal(cfg.win.signtoolOptions, undefined,
        'still exactly one signing key: setting both silently defaults to Azure');

    // The credentials must not have been copied into the config on the way
    // through this check; they would end up in builder-effective-config.yaml.
    const serialised = JSON.stringify(cfg);
    for (const [name, value] of Object.entries(AZURE_CREDS)) {
        assert.ok(!serialised.includes(name) && !serialised.includes(value),
            `${name} stays out of the emitted config`);
    }
}

{
    // The classic certificate path also satisfies the requirement: the check
    // asks whether this build can sign, not which vendor it uses. DD2 chose
    // Azure, and a check that refused a certificate outright would be a
    // policy pin hiding inside a credential check.
    const cfg = loadConfig({ CSC_LINK: 'file:///dev/null', CSC_KEY_PASSWORD: 'x', [REQUIRE_VAR]: '1' });
    assert.ok(cfg.win.signtoolOptions,
        'a supplied certificate satisfies the requirement on the classic path');
}

// --------------------------------------------------- the status helper

{
    // The helper is what the config calls and what the message is built from,
    // so its verdicts are pinned directly rather than only through thrown
    // errors.
    const none = windowsSigningStatus({});
    assert.equal(none.required, false);
    assert.equal(none.path, 'none');
    assert.equal(none.ready, false);

    const azure = windowsSigningStatus({ ...AZURE_CONFIG, ...AZURE_CREDS });
    assert.equal(azure.path, 'azure');
    assert.equal(azure.ready, true);
    assert.deepEqual(azure.missingAzure, []);

    // Whitespace is not a value. A workflow that hands through an unset
    // secret supplies the empty string, and GitHub's `${{ secrets.X }}`
    // expansion of a missing secret is exactly that.
    assert.equal(windowsSigningStatus({ ...AZURE_CONFIG, ...AZURE_CREDS, AZURE_CLIENT_ID: '  ' }).ready,
        false, 'a blank value counts as missing, which is how an unset secret arrives');

    // And the assert returns the status rather than throwing when it is
    // satisfied, so a caller can log which path a signed build took.
    const ok = assertWindowsSigningMaterial({ ...AZURE_CONFIG, ...AZURE_CREDS, [REQUIRE_VAR]: '1' });
    assert.equal(ok.path, 'azure');
    assert.equal(ok.ready, true);
}

// ------------------------------------------- every Windows lane declares it

{
    const wf = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');

    // Steps are `- name:` blocks at a fixed indent in this file; split on them
    // rather than parsing YAML, the same way release-ci.smoke.js does.
    const steps = wf.split(/^ {6}- /m).slice(1);
    const winBuilds = steps.filter((s) => /dist --win/.test(s));
    assert.ok(winBuilds.length >= 2,
        `release.yml builds Windows artifacts in more than one step (found ${winBuilds.length})`);

    for (const step of winBuilds) {
        const name = (/name:\s*(.+)/.exec(step) || [, '(unnamed)'])[1].trim();
        assert.ok(new RegExp(`${REQUIRE_VAR}:\\s*'1'`).test(step),
            `the Windows build step '${name}' must set ${REQUIRE_VAR}: '1', or a missing`
            + ' signing secret produces unsigned installers and a green lane');
        // The requirement without the values is a lane that can only fail, so
        // both halves are asserted together: config trio AND credentials.
        for (const secret of [...AZURE_CONFIG_VARS, ...AZURE_CREDENTIAL_VARS]) {
            assert.ok(new RegExp(`${secret}:\\s*\\$\\{\\{\\s*secrets\\.${secret}\\s*\\}\\}`).test(step),
                `the Windows build step '${name}' must pass ${secret} through, or the`
                + ' requirement it declares can never be met');
        }
    }
}

// ---------------------------------------- the far end still rejects an .exe

{
    // Not a duplicate of release-signature-gate.smoke.js, which drives the
    // checker over fixtures. This asserts the DECLARATION the two ends share:
    // the build must attempt a signature, and every `.exe` row - production
    // and rehearsal - must be one the artifact gate actually verifies. Either
    // half alone leaves a hole this item exists to close.
    const { SIGNATURE_CLASSES, parseExpected } = await import(
        join(root, 'tools/release/verify-signatures.mjs'));
    const declared = readFileSync(join(root, 'tools/release/expected-artifacts.txt'), 'utf8');

    for (const set of ['release', 'staging']) {
        const { rows, problems } = parseExpected(declared, set);
        assert.deepEqual(problems, [], `the ${set} declaration parses clean`);
        const exe = rows.filter((r) => r.pattern.endsWith('.exe'));
        assert.ok(exe.length, `the ${set} set declares the Windows installer`);
        for (const row of exe) {
            assert.equal(row.cls, 'authenticode',
                `${row.pattern} (${set}) is checked for a real signature, not recorded`);
            assert.ok(SIGNATURE_CLASSES[row.cls].verify,
                'and `authenticode` is a class that fails the release when absent');
        }
    }
}

process.stdout.write('windows-signing-required.smoke.js ok\n');
