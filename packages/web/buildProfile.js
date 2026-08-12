// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Which build profile this build is (; rails §3 owns the
// names and tools/release records them in the signed manifest).
//
// BUILD-ONLY, like sri.js beside it: it reads `process.env`, which exists in
// the Vite process and not in the browser. The profile NAMES and the policy
// differences live in `src/csp.js`, which the app bundles; this file only
// answers "which one are we building right now".
//
// COMPILE-TIME ONLY, permanently. §2.3 is explicit and the reason is
// not stylistic: a store-hidden surface that can be switched on at runtime is
// an App Review guideline 2.3.1 hidden-feature violation, and the penalty is
// developer-account termination, which takes every Apple surface with it
// (iOS AND the desktop Developer ID notarization). There is no remote config
// here and there must never be one, however convenient it looks later.
//
// The stamp file exists because `packages/mobile` stages `packages/web/dist`
// VERBATIM: the mobile build does not compile the SPA, it copies it. Without
// a stamp travelling inside the dist there is nothing to stop a `default`
// bundle being wrapped in a store artifact and labelled `store` in a signed
// manifest, which is exactly the false claim the release gate refuses.

import { BUILD_PROFILES, DEFAULT_BUILD_PROFILE } from './src/csp.js';

export { BUILD_PROFILES, DEFAULT_BUILD_PROFILE };

/** Written into the built dist so downstream tooling can read it back. */
export const PROFILE_STAMP_FILE = 'build-profile.txt';

/**
 * The profile for this build, from `XCHAIN_BUILD_PROFILE`.
 *
 * An unset variable means `default`, which is what every existing build and
 * every contributor's `pnpm build` should keep producing. An unrecognized
 * value THROWS rather than falling back: a typo silently producing a
 * `default` build that a release then labels `store` is the failure this
 * whole mechanism exists to prevent.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveBuildProfile(env = process.env) {
    const raw = env?.XCHAIN_BUILD_PROFILE;
    if (raw === undefined || raw === '') return DEFAULT_BUILD_PROFILE;
    const profile = String(raw).trim();
    if (!BUILD_PROFILES.includes(profile)) {
        throw new Error(
            `XCHAIN_BUILD_PROFILE=${JSON.stringify(raw)} is not a build profile;`
            + ` expected one of ${BUILD_PROFILES.join(', ')}`,
        );
    }
    return profile;
}

/** The stamp file's contents: the profile name, one line. */
export function profileStampFor(profile) {
    if (!BUILD_PROFILES.includes(profile)) {
        throw new Error(`cannot stamp an unknown build profile ${JSON.stringify(profile)}`);
    }
    return `${profile}\n`;
}

/**
 * Read a stamp back. Returns null when the file is absent or unreadable,
 * which callers must treat as "unknown", never as `default`: an unstamped
 * bundle is one whose profile nobody recorded, not one built without flags.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function parseProfileStamp(text) {
    const first = String(text ?? '').split('\n')[0]?.trim();
    return first && BUILD_PROFILES.includes(first) ? first : null;
}
