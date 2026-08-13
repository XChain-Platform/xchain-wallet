// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §14: a release lane cannot produce UNSIGNED or UNNOTARIZED macOS
// artifacts quietly. It either signs and notarizes them or fails by name.
//
// THIS IS NOT A HYPOTHETICAL DEFECT, it is the one that happened. v0.336.0
// shipped `xchain-wallet-0.336.0-x64-mac.zip` and its arm64 twin with no
// `_CodeSignature/CodeResources`, and both dmgs assessing as `rejected:
// no usable signature`, from a job that went green. The cause, measured in
// the workflow rather than inferred: the mac step passed
// `CSC_LINK: ${{ secrets.MACOS_CSC_LINK }}` unconditionally, an unset secret
// expands to the empty string, and app-builder-lib treats "no certificate"
// as a configuration choice. The Snap and Mac App Store lanes in the SAME
// file guard themselves (`if: env.*_CSC_LINK != ''`, `forceCodeSigning`) and
// the two mainline desktop lanes did not.
//
// THE FOUR SHAPES OF THE FAILURE, all silent, which is why all four are
// tested rather than one:
//   1. no certificate at all - mac.identity resolves to null and
//      `macPackager.sign` returns before it signs anything;
//   2. a certificate with no passphrase - the .p12 cannot be imported and
//      the import failure does not stop the build;
//   3. a signed build that is never NOTARIZED - `mac.notarize` is
//      `Boolean(APPLE_API_KEY_ID)`, so one absent variable turns it off with
//      no message, and Gatekeeper blocks an un-notarized download exactly as
//      it blocks an unsigned one;
//   4. a certificate that is present and matches nothing - caught not by the
//      credential check but by `forceCodeSigning`, which turns
//      app-builder-lib's `handleNullIdentity` from a log line into a throw.
//
// THE OTHER HALF OF THIS FILE IS THE WORKFLOW, and it is the half most likely
// to rot. The requirement is opt-in (an unsigned dev build is legitimate), so
// a mac build step added later without the flag is exactly as silent as the
// defect above. Every step in release.yml that builds a mainline mac artifact
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
const HELPER = join(root, 'packages/desktop/scripts/macos-signing.cjs');

const {
    REQUIRE_VAR,
    CERT_VARS,
    CERT_PASSWORD_VAR,
    NOTARIZE_VARS,
    macosSigningStatus,
    assertMacosSigningMaterial,
} = require(HELPER);

// The SHAPE of a signing environment, never a real credential: a fixture that
// looked like a secret would be one more thing to rotate.
const CERT_ENV = {
    CSC_LINK: 'file:///dev/null',
    CSC_KEY_PASSWORD: 'passphrase-placeholder',
};
const NOTARIZE_ENV = {
    APPLE_API_KEY: 'key-placeholder',
    APPLE_API_KEY_ID: 'ABCD1234EF',
    APPLE_API_ISSUER: 'issuer-placeholder',
    APPLE_TEAM_ID: '829JG9YLH3',
};
const SIGNED_ENV = { ...CERT_ENV, ...NOTARIZE_ENV, [REQUIRE_VAR]: '1' };

// Every variable the config or the helper reads, cleared before each load so
// the assertions describe the config and not the shell that invoked the suite.
const OWNED_VARS = [REQUIRE_VAR, ...CERT_VARS, CERT_PASSWORD_VAR, ...NOTARIZE_VARS,
    'CSC_IDENTITY_NAME', 'MAS_IDENTITY_NAME', 'XCHAIN_STAGING_FEED_URL',
    'XCHAIN_BUILD_MAS', 'XCHAIN_BUILD_APPX', 'XCHAIN_BUILD_SNAP',
    'XCHAIN_REQUIRE_WIN_SIGNING'];

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
    assert.equal(cfg.mac.identity, null,
        'with no certificate and no requirement the identity stays null, which is the'
        + ' quiet dev-build path');
    assert.equal(cfg.forceCodeSigning, false,
        'and a dev build is not forced to sign');
    assert.equal(cfg.mac.notarize, false,
        'nor to notarize');

    // Not '1' means not required. A lane that writes `true` or `yes` gets an
    // unsigned build, which is worse than a typo that fails, so pin the
    // comparison rather than accepting anything truthy, and keep the pin
    // visible here where the workflow assertion below can be read against it.
    assert.equal(macosSigningStatus({ [REQUIRE_VAR]: 'true' }).required, false,
        `${REQUIRE_VAR} is exactly '1'; release.yml is asserted to set that literal below`);
}

// ------------------------------------- 1. nothing configured, but required

{
    const err = loadError({ [REQUIRE_VAR]: '1' });
    assert.ok(err, 'a required macOS signature with no material fails the build');
    assert.equal(err.name, 'MacSigningCredentialsMissing',
        'the failure is named, so a release log says what happened');

    // Named variables, not a vague "signing is not configured". The whole
    // point is that the operator reads the message and knows which secret to
    // set on which lane.
    for (const name of [...CERT_VARS, ...NOTARIZE_VARS]) {
        assert.ok(err.message.includes(name), `the error names ${name} as missing`);
    }
    assert.ok(/UNSIGNED/.test(err.message),
        'and says what would otherwise have been produced');
}

// ------------------ 2. a certificate with no passphrase is not a signed lane

{
    const noPassword = { ...SIGNED_ENV };
    delete noPassword.CSC_KEY_PASSWORD;

    const err = loadError(noPassword);
    assert.ok(err, 'a .p12 with no passphrase fails when a signature is required');
    assert.equal(err.name, 'MacSigningCredentialsMissing');
    assert.deepEqual(err.missing, [CERT_PASSWORD_VAR],
        'and exactly the passphrase is what is missing');
    assert.ok(!err.message.includes(`  - CSC_LINK`),
        'the certificate that IS supplied is not listed as missing');
}

// --------- 3. a SIGNED build with no notarization credentials still fails

{
    // The sharpest case, and the one that reads as configured everywhere
    // else: the certificate is there, `mac.identity` resolves, every existing
    // assertion about the mac config passes, and `mac.notarize` quietly
    // becomes false. Gatekeeper blocks the download regardless.
    const err = loadError({ ...CERT_ENV, [REQUIRE_VAR]: '1' });
    assert.ok(err, 'a signed lane with no App Store Connect key fails');
    assert.equal(err.name, 'MacSigningCredentialsMissing');
    assert.deepEqual(err.missing, NOTARIZE_VARS,
        'and exactly the four notarization values are what is missing');
    assert.ok(/notariz/i.test(err.message),
        'the message says notarization rather than only signing');

    // One value short is the same failure: three of four is not "mostly
    // notarized", and the trigger being the absent one is the silent case.
    const threeOfFour = { ...SIGNED_ENV };
    delete threeOfFour.APPLE_API_KEY_ID;
    const partial = loadError(threeOfFour);
    assert.ok(partial, 'one missing notarization value fails as hard as four');
    assert.deepEqual(partial.missing, ['APPLE_API_KEY_ID']);
}

// ------------------------------------------ the complete environment builds

{
    const cfg = loadConfig(SIGNED_ENV);
    assert.equal(cfg.mac.identity, 'Dankest, LLC',
        'a complete environment resolves the Developer ID qualifier');
    assert.equal(cfg.mac.notarize, true, 'and notarizes');
    assert.equal(cfg.dmg.sign, true, 'and signs the disk image');

    // 4. The second check, and not a duplicate of the first: a certificate
    // that matches nothing in the keychain passes the credential assert and
    // then reaches `handleNullIdentity`, which logs and returns false unless
    // this flag is on. Present-but-wrong is a different failure from absent.
    assert.equal(cfg.forceCodeSigning, true,
        'a lane that declared the requirement also refuses a signature that does not land');

    // The passphrase must not have been copied into the config on the way
    // through this check; it would end up in builder-effective-config.yaml.
    const serialised = JSON.stringify(cfg);
    assert.ok(!serialised.includes(CERT_ENV.CSC_KEY_PASSWORD),
        'the certificate passphrase stays out of the emitted config');
}

{
    // The keychain path also satisfies the requirement: the check asks whether
    // this build can sign, not how the certificate arrived. A local
    // Developer-ID rehearsal imports the cert into a keychain and needs no
    // passphrase, and a check that refused it would be a policy pin hiding
    // inside a credential check.
    const cfg = loadConfig({ CSC_KEYCHAIN: 'xchain-release.keychain', ...NOTARIZE_ENV,
        [REQUIRE_VAR]: '1' });
    assert.equal(cfg.mac.identity, 'Dankest, LLC',
        'an already-imported certificate satisfies the requirement');
}

// --------------------------------------------------- the status helper

{
    // The helper is what the config calls and what the message is built from,
    // so its verdicts are pinned directly rather than only through thrown
    // errors.
    const none = macosSigningStatus({});
    assert.equal(none.required, false);
    assert.equal(none.certSource, 'none');
    assert.equal(none.ready, false);

    const full = macosSigningStatus({ ...CERT_ENV, ...NOTARIZE_ENV });
    assert.equal(full.certSource, 'csc-link');
    assert.equal(full.ready, true);
    assert.deepEqual(full.missingCert, []);
    assert.deepEqual(full.missingNotarize, []);

    assert.equal(macosSigningStatus({ CSC_KEYCHAIN: 'login.keychain' }).certSource, 'keychain',
        'a keychain with no CSC_LINK is its own certificate source');

    // Whitespace is not a value. A workflow that hands through an unset
    // secret supplies the empty string, and GitHub's `${{ secrets.X }}`
    // expansion of a missing secret is exactly that.
    assert.equal(macosSigningStatus({ ...CERT_ENV, ...NOTARIZE_ENV, CSC_LINK: '  ' }).certSource,
        'none', 'a blank value counts as missing, which is how an unset secret arrives');

    // And the assert returns the status rather than throwing when it is
    // satisfied, so a caller can log which path a signed build took.
    const ok = assertMacosSigningMaterial(SIGNED_ENV);
    assert.equal(ok.certSource, 'csc-link');
    assert.equal(ok.ready, true);
}

// ----------------------------------------- every mainline mac lane declares it

{
    const wf = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');

    // Steps are `- name:` blocks at a fixed indent in this file; split on them
    // rather than parsing YAML, the same way release-ci.smoke.js does.
    const steps = wf.split(/^ {6}- /m).slice(1);
    const macBuilds = steps.filter((s) => /dist --mac/.test(s));
    assert.ok(macBuilds.length >= 3,
        `release.yml builds mac artifacts in more than one step (found ${macBuilds.length})`);

    // The store lane is deliberately exempt and says so in one place rather
    // than by omission: it carries no App Store Connect key (a store package
    // is not notarized, the store signs the receipt), and it is already
    // guarded by `forceCodeSigning`, which XCHAIN_BUILD_MAS turns on.
    const mainline = macBuilds.filter((s) => !/XCHAIN_BUILD_MAS:\s*'1'/.test(s));
    assert.ok(mainline.length >= 2,
        `the mainline mac lanes are the production build and the rehearsal (found ${mainline.length})`);

    for (const step of mainline) {
        const name = (/name:\s*(.+)/.exec(step) || [, '(unnamed)'])[1].trim();
        assert.ok(new RegExp(`${REQUIRE_VAR}:\\s*'1'`).test(step),
            `the mac build step '${name}' must set ${REQUIRE_VAR}: '1', or a missing`
            + ' signing secret produces unsigned artifacts and a green lane');
        // The requirement without the values is a lane that can only fail, so
        // both halves are asserted together: certificate AND notarization.
        for (const [envVar, secret] of [
            ['CSC_LINK', 'MACOS_CSC_LINK'],
            ['CSC_KEY_PASSWORD', 'MACOS_CSC_KEY_PASSWORD'],
        ]) {
            assert.ok(new RegExp(`${envVar}:\\s*\\$\\{\\{\\s*secrets\\.${secret}\\s*\\}\\}`).test(step),
                `the mac build step '${name}' must pass ${secret} through as ${envVar}, or the`
                + ' requirement it declares can never be met');
        }
        for (const secret of NOTARIZE_VARS) {
            assert.ok(new RegExp(`${secret}:\\s*\\$\\{\\{\\s*secrets\\.${secret}\\s*\\}\\}`).test(step),
                `the mac build step '${name}' must pass ${secret} through, or the`
                + ' requirement it declares can never be met');
        }
    }

    // The store step must NOT declare it, because it would then demand
    // notarization credentials it has no use for and could never be met. The
    // exemption is asserted rather than assumed, so a well-meaning edit that
    // "makes them consistent" fails here instead of at release time.
    const mas = macBuilds.filter((s) => /XCHAIN_BUILD_MAS:\s*'1'/.test(s));
    assert.equal(mas.length, 1, 'exactly one Mac App Store build step');
    assert.ok(!new RegExp(`${REQUIRE_VAR}:`).test(mas[0]),
        `the Mac App Store step must not set ${REQUIRE_VAR}: it carries no App Store`
        + ' Connect key and is already guarded by forceCodeSigning');
}

// ------------------------------- the far end still rejects an unsigned mac set

{
    // Not a duplicate of release-signature-gate.smoke.js, which drives the
    // checker over fixtures. This asserts the DECLARATION the two ends share:
    // the build must attempt a signature, and every mac row - production and
    // rehearsal, zip and dmg - must be one the artifact gate actually
    // verifies. Either half alone leaves a hole this item exists to close.
    const { SIGNATURE_CLASSES, parseExpected } = await import(
        join(root, 'tools/release/verify-signatures.mjs'));
    const declared = readFileSync(join(root, 'tools/release/expected-artifacts.txt'), 'utf8');

    const { rows, problems } = parseExpected(declared, 'release');
    assert.deepEqual(problems, [], 'the release declaration parses clean');

    const zips = rows.filter((r) => r.pattern.includes('mac') && r.pattern.endsWith('.zip'));
    assert.ok(zips.length, 'the release set declares the mac zip');
    for (const row of zips) {
        assert.equal(row.cls, 'codesign',
            `${row.pattern} is checked for a real signature, not recorded`);
        assert.ok(SIGNATURE_CLASSES[row.cls].verify,
            'and `codesign` is a class that fails the release when absent');
    }

    const dmgs = rows.filter((r) => r.pattern.endsWith('.dmg'));
    assert.ok(dmgs.length, 'the release set declares the disk image');
    for (const row of dmgs) {
        assert.equal(row.cls, 'codesign-dmg',
            `${row.pattern} is assessed the way Gatekeeper assesses a download`);
        assert.ok(SIGNATURE_CLASSES[row.cls].verify,
            'and `codesign-dmg` is a class that fails the release when absent');
    }

    const staging = parseExpected(declared, 'staging');
    assert.deepEqual(staging.problems, [], 'the staging declaration parses clean');
    const stagingMac = staging.rows.filter((r) => r.pattern.includes('mac'));
    assert.ok(stagingMac.length, 'the staging set declares the mac zip the rehearsal builds');
    for (const row of stagingMac) {
        assert.equal(row.cls, 'codesign',
            `${row.pattern} (staging) is checked for a real signature`);
    }
}

process.stdout.write('macos-signing-required.smoke.js ok\n');
