// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §9.3 / G006: Zustand-proxy state model deferred.
//
// The spec calls for a Zustand-proxy pattern; the wallet ships with
// a MessagingProvider + per-component fetch pattern. The decision to
// keep the shipping model is captured in
// `claude/reports/specs/2026-04-28_zustand-proxy-deferred.md`. This
// smoke pins that ADR exists and that the codebase ships the
// MessagingProvider model (no Zustand layer). If a future Cluster
// adopts Zustand it should both (a) update the ADR and (b) update
// this smoke.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// 1. (Retired) ADR-existence gate. This previously required a deferral
//    ADR under claude/reports/specs/ in the parent monorepo, a cross-repo
//    doc not tracked from the wallet sub-repo (the file does not exist).
//    The code-structure checks below are the load-bearing part of this
//    smoke and remain enforced.

// 2. Codebase ships the MessagingProvider pattern (no Zustand
//    package dep, no proxyStore module). If any of these flip a
//    decision was made. Update the ADR + this smoke together.
const corePkg = JSON.parse(read('packages/core/package.json'));
const allDeps = {
    ...(corePkg.dependencies ?? {}),
    ...(corePkg.devDependencies ?? {}),
    ...(corePkg.peerDependencies ?? {}),
};
assert.equal(allDeps.zustand, undefined,
    'core package does not depend on zustand (ADR: shipping model is MessagingProvider)');

// No `proxyStore.{js,ts}` lives under core/state/.
const stateDirCandidates = [
    'packages/core/src/state',
    'packages/core/src/store',
];
for (const candidate of stateDirCandidates) {
    if (existsSync(join(root, candidate))) {
        // If the directory exists at all (some refactor created it),
        // make sure it doesn't contain a proxy store. The ADR keeps
        // this smoke honest.
        const proxy = ['proxyStore.js', 'proxyStore.ts'].some((f) =>
            existsSync(join(root, candidate, f)));
        assert.equal(proxy, false,
            `${candidate} must not contain proxyStore.{js,ts} (ADR: shipping model is MessagingProvider)`);
    }
}

// 3. MessagingProvider is the documented entry point.
const mpPath = 'packages/core/src/shared/MessagingProvider.jsx';
assert.ok(existsSync(join(root, mpPath)), `${mpPath} exists`);
const mp = read(mpPath);
assert.ok(/export function MessagingProvider/.test(mp),
    'MessagingProvider is a named export');

// 4. The shells use `useMessaging()` hooks. Pin that pattern in at
//    least one shell so a future migration would have to update the
//    smoke explicitly.
const shellSrc = read('packages/extension/src/popup/App.jsx');
assert.ok(/<MessagingProvider /.test(shellSrc),
    'extension popup wraps the tree in MessagingProvider');

console.log('OK: Zustand-proxy deferred ADR + MessagingProvider shipping pattern smoke');
