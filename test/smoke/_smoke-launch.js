// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// How one smoke process starts, shared by the full runner (_run-smokes.js) and
// the push gate's changed-test tier (tools/ci_fast_select.js), so a smoke reads
// source the same way under both. Every smoke but the raw-source ones reads
// wallet source with plain t('key') calls swapped for their English text
// (_english-source.mjs); the raw-source ones audit the t() calls themselves.

import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const RAW_SOURCE_SMOKES = new Set([
    'audits/history-export-modal.smoke.js',
    'audits/scan-route.smoke.js',
    'core/i18n.smoke.js',
    'markets/place-order.smoke.js',
    'ui/ads-onboarding-notice.smoke.js',
    'ui/demo-disclosure-on-home.smoke.js',
    'ui/input-capslock-warning.smoke.js',
    'ui/reachability-banner.smoke.js',
    'ui/send-autocomplete.smoke.js',
    'ui/verify-signature.smoke.js',
]);

/** Node arguments that run the smoke at `fullPath` with the English-copy loader. */
export function smokeNodeArgs(fullPath) {
    return ['--import', pathToFileURL(join(here, '_english-source.mjs')).href, fullPath];
}

/** The environment for the smoke at `fullPath`: raw-source smokes opt out of the loader. */
export function smokeEnv(fullPath, env = process.env) {
    const display = relative(here, fullPath).split('\\').join('/');
    return RAW_SOURCE_SMOKES.has(display) ? { ...env, XC_SMOKE_RAW_SOURCE: '1' } : env;
}
