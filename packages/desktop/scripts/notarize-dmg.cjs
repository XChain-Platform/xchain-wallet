//*********************************************************************
//
// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
//
//*********************************************************************

// Notarizes and staples the.dmg itself (row 140).
//
// THE DEFECT THIS EXISTS FOR, measured on the published v0.338.0 bytes
// rather than reasoned about: the app INSIDE the disk image was signed,
// notarized and stapled, and the disk image AROUND it was not signed at
// all. `spctl -a -t open --context context:primary-signature` on the
// published dmg answered `rejected: no usable signature`, and Apple's own
// `syspolicy_check distribution` called it a fatal notary error - while
// the same tools on the bundle inside answered `accepted, source=
// Notarized Developer ID`. So the update path (which consumes the
// `-mac.zip`, and therefore the bundle) was sound, and the FIRST INSTALL
// path was the broken one: the file a user downloads and double-clicks.
//
// WHY electron-builder DOES NOT DO THIS FOR US, read out of the installed
// code rather than assumed:
//
//   - `dmg-builder/out/dmg.js` signs the image only when `dmg.sign ===
//     true` (strict equality, so the default of false is a silent skip).
//     That is now set in electron-builder.config.cjs.
//   - even at `sign: true` that path stops at `codesign`. Nothing
//     submits the image to notarytool, because `mac.notarize` runs
//     @electron/notarize during `afterSign`, on the .app, and the dmg is
//     built AFTER that step from the already-notarized bundle.
//
// A signature alone would not have been enough either: Gatekeeper rejects
// a quarantined image that carries a valid Developer ID signature and no
// notarization ticket, which is why this staples rather than stopping at
// codesign, and then RE-READS the result with the same assessment a user's
// machine performs.
//
// FAIL-CLOSED, deliberately. Every step here throws on failure. The whole
// Family of defects this row belongs to (row 139, and the
// `dmg.sign` default above) is "signing step skipped, exit 0, artifact
// ships looking correct", so a notarization that cannot run must stop the
// build rather than leave a dmg that only LOOKS distributable. The one
// legitimate quiet path is a build that was handed no credentials at all
// (a dev build, or the reproduce container), which is the `shouldNotarize`
// test below and nothing else.

'use strict';

const { execFile } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

/**
 * Should this build notarize its disk images?
 *
 * The trigger is deliberately the SAME pair the app's own notarization
 * uses - a signing identity plus App Store Connect credentials - so a
 * build cannot end up with a notarized app inside an un-notarized image
 * or the reverse. Anything less than both is a build that was handed no
 * credentials, which is the dev and reproduce case and stays quiet.
 *
 * @param {{platform?: string, identity?: string|null, env?: NodeJS.ProcessEnv}} opts
 * @returns {{notarize: boolean, reason: string}}
 */
function shouldNotarize({ platform = process.platform, identity = null, env = process.env } = {}) {
    if (platform !== 'darwin') {
        return { notarize: false, reason: `not macOS (${platform}); notarytool and stapler do not exist here` };
    }
    if (!identity) {
        return { notarize: false, reason: 'no macOS signing identity; this is an unsigned dev or reproduce build' };
    }
    if (!env.APPLE_API_KEY_ID) {
        return { notarize: false, reason: 'APPLE_API_KEY_ID unset; the app itself is not notarized either' };
    }
    return { notarize: true, reason: 'signing identity and App Store Connect credentials both present' };
}

/**
 * Materialize the App Store Connect key as a file path for notarytool.
 *
 * This repo carries TWO conventions for `APPLE_API_KEY` and both are real:
 * the iOS lane (`tools/release/ios-archive.sh`) puts the .p8 CONTENTS in
 * it, while @electron/notarize - and therefore `mac.notarize` in the same
 * config as this hook - reads it as a PATH. Accepting either is what keeps
 * one credential working for both lanes; guessing at one would break the
 * other on a machine that had it set the other way.
 *
 * The contents branch writes a 0600 temp file the same way ios-archive.sh
 * does. The key never reaches argv, a log line, or this function's return
 * value beyond the path itself.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{keyPath: string, cleanup: () => void}}
 */
function resolveApiKeyFile(env) {
    const raw = env.APPLE_API_KEY;
    if (!raw) {
        throw new Error('notarize-dmg: APPLE_API_KEY is unset, but APPLE_API_KEY_ID is set. '
            + 'Supply the .p8 (contents or path) or unset both.');
    }
    if (!raw.includes('BEGIN PRIVATE KEY') && existsSync(raw)) {
        return { keyPath: raw, cleanup: () => {} };
    }
    const dir = mkdtempSync(join(tmpdir(), 'xchain-asc-key-'));
    const keyPath = join(dir, `AuthKey_${env.APPLE_API_KEY_ID}.p8`);
    const previousMask = process.umask(0o077);
    try {
        writeFileSync(keyPath, raw, { mode: 0o600 });
    } finally {
        process.umask(previousMask);
    }
    return { keyPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Notarize, staple and then RE-ASSESS one disk image.
 *
 * The third step is the one worth defending, and it is not belt-and-braces
 * over the first two. `notarytool submit --wait` reports a submission that
 * came back Invalid through its printed status rather than reliably
 * through its exit code, so trusting the exit code alone would repeat the
 * exact mistake this row is about. Stapling a rejected submission fails,
 * which catches it; and `spctl -a -t open --context
 * context:primary-signature` is then the assessment LaunchServices itself
 * performs on a quarantined disk image, so it is the reading that decides
 * whether a user sees a warning. It is taken here rather than assumed.
 *
 * @param {string} dmgPath
 * @param {{keyPath: string, keyId: string, issuer: string, log: (m: string) => void}} ctx
 */
async function notarizeOneDmg(dmgPath, { keyPath, keyId, issuer, log }) {
    log(`notarize-dmg: submitting ${dmgPath}`);
    await execFileAsync('xcrun', [
        'notarytool', 'submit', dmgPath,
        '--key', keyPath,
        '--key-id', keyId,
        '--issuer', issuer,
        '--wait',
    ], { maxBuffer: 8 * 1024 * 1024 });

    await execFileAsync('xcrun', ['stapler', 'staple', dmgPath], { maxBuffer: 8 * 1024 * 1024 });

    const { stdout, stderr } = await execFileAsync('spctl', [
        '-a', '-t', 'open', '--context', 'context:primary-signature', '-vv', dmgPath,
    ], { maxBuffer: 8 * 1024 * 1024 }).catch((err) => {
        throw new Error(`notarize-dmg: ${dmgPath} is still rejected by Gatekeeper after stapling: `
            + `${String(err?.stderr || err?.message || err).trim()}`);
    });
    const assessment = `${stdout}${stderr}`;
    if (!/source=Notarized Developer ID/.test(assessment)) {
        throw new Error(`notarize-dmg: ${dmgPath} was stapled but assesses as `
            + `"${assessment.trim().replace(/\n/g, ' ')}", not a notarized Developer ID image.`);
    }
    log(`notarize-dmg: ${dmgPath} accepted, source=Notarized Developer ID`);
}

/**
 * Notarize and staple every .dmg an electron-builder run produced.
 *
 * @param {{artifactPaths: string[], identity?: string|null, env?: NodeJS.ProcessEnv,
 *          platform?: string, log?: (m: string) => void}} opts
 * @returns {Promise<string[]>} the dmg paths that were notarized
 */
async function notarizeDmgArtifacts({
    artifactPaths,
    identity = null,
    env = process.env,
    platform = process.platform,
    log = (m) => process.stdout.write(`${m}\n`),
}) {
    const dmgs = (artifactPaths || []).filter((f) => f.endsWith('.dmg'));
    if (dmgs.length === 0) return [];

    const decision = shouldNotarize({ platform, identity, env });
    if (!decision.notarize) {
        // Said out loud rather than skipped silently: an unsigned dmg is a
        // legitimate dev artifact and an illegitimate release one, and the
        // release gate (tools/release/verify-signatures.mjs) is what tells
        // those two apart. This line is how a build log shows which case
        // it was.
        log(`notarize-dmg: NOT notarizing ${dmgs.length} disk image(s) - ${decision.reason}`);
        return [];
    }

    const issuer = env.APPLE_API_ISSUER;
    if (!issuer) {
        throw new Error('notarize-dmg: APPLE_API_ISSUER is required to notarize the disk image');
    }
    const { keyPath, cleanup } = resolveApiKeyFile(env);
    try {
        for (const dmg of dmgs) {
            await notarizeOneDmg(dmg, { keyPath, keyId: env.APPLE_API_KEY_ID, issuer, log });
        }
    } finally {
        cleanup();
    }
    return dmgs;
}

module.exports = { notarizeDmgArtifacts, shouldNotarize, resolveApiKeyFile };
