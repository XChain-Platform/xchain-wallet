// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Render harness — mount every shared route and fail if it throws a
// code-bug crash on first render.
//
// WHY THIS EXISTS
// ---------------
// The wallet is largely AI-generated and several route screens shipped
// having clearly never been rendered. Two crash classes slipped through
// a "green" suite:
//   * a botched import-organizer dropped the `ScreenHeader` import from
//     35 route files → `ReferenceError: ScreenHeader is not defined` →
//     white screen on mount;
//   * a `StakeForm` effect dep-array referenced `fromAddress` before its
//     `const fromAddress = useMemo(...)` → TDZ `ReferenceError: Cannot
//     access 'fromAddress' before initialization`.
// Neither was caught because the smoke suite is source-regex assertions
// that never actually render a component, and there were zero form-level
// render tests. This file institutionalises the throwaway jsdom probe
// that found them: it imports each route, mounts it inside a
// MessagingProvider with a never-resolving messaging mock, and fails the
// route's case if the mount throws a *definitive code bug*.
//
// FAIL POLICY (deliberately narrow)
// ---------------------------------
// We fail ONLY on errors whose message matches CODE_BUG_RE:
//   * `is not defined`        — ReferenceError: missing import / undefined
//                               symbol (the 35-file ScreenHeader class);
//   * `before initialization` — TDZ (the StakeForm class);
//   * `is not a function`     — calling a method/binding that doesn't
//                               exist on a module-level value.
// That third clause was earned: this harness caught two more never-rendered
// screens calling registry methods that don't exist — VerifySignatureForm
// (`chainRegistry.list()`) and ViewPrivateKey (`chainRegistry.all()`); the
// enumerator is `supportedChains()`. Both are now fixed; the policy keeps
// the class guarded.
//
// These three are unambiguous code defects with effectively no false
// positives even against a permissive props superset, because the crashes
// they catch are on module-level imports/singletons, not on the generic
// prop bag. Prop-shape mismatches, missing-context reads in effects, and
// jsdom-only gaps (e.g. ResizeObserver) produce OTHER messages
// (`Cannot read properties of undefined`, `is not iterable`, …) and are
// intentionally NOT failed here — they would be noise. See the "widening"
// note at the bottom before loosening this further.
//
// SCOPE / LIMITS
// --------------
// This covers INITIAL render only. Bugs that need effects, state, async
// resolution, or user interaction to surface are out of scope (the
// messaging mock never resolves on purpose, so loading branches stay
// mounted). A future layer can drive effects/interaction; see TODO below.
//
// Runs as ONE vitest process by design: the Parallels share thrashes
// under hundreds of rapid node spawns, so a single-process render sweep
// is both faster and far less flaky than the per-file smoke runner.
//   npx vitest run test/unit/routes-render.test.jsx \
//     --config test/vitest/unit.config.js

import { describe, it, beforeAll, afterAll } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';

// Discover every route module via vite's compile-time glob. Resolved
// relative to THIS file, so the suite works regardless of cwd — and it
// avoids fs/URL-scheme fragility (import.meta.url isn't a file:// URL
// under the vitest transform). `eager: false` keeps these as lazy
// importers so a module-load crash surfaces inside the route's own
// `it()` rather than failing the whole suite at collection time.
const routeModules = import.meta.glob(
    '../../packages/core/src/shared/routes/*.jsx',
);

// A messaging module stand-in: every property access yields a function
// that returns a never-resolving promise. Routes that fire host calls in
// an effect stay in their loading branch instead of resolving into a
// state we haven't shaped, which keeps the probe focused on render-time
// code bugs rather than data-driven branches.
const messaging = new Proxy(
    {},
    { get: () => () => new Promise(() => {}) },
);

// Permissive superset of the props the shared routes read. Individual
// routes ignore the keys they don't use; the goal is only to get far
// enough into render that a missing import / TDZ would throw.
const props = {
    walletId: 'w',
    accountId: 'a',
    chainId: 'bitcoin-mainnet',
    onBack() {},
    onDone() {},
    onClose() {},
    onNavigate() {},
    onSelect() {},
    tick: 'JDOG',
    tick1: 'A',
    tick2: 'B',
    mode: 'transfer',
    divisibility: 0,
    actionIndex: '1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    contractId: '1',
    dispenserId: '1',
};

// Only these messages indicate a real defect we want to fail on. Keep
// this tight — see the header's FAIL POLICY note.
const CODE_BUG_RE = /is not defined|before initialization|is not a function/;

// [importerPath, filename] pairs, sorted by filename for stable output.
const routeEntries = Object.keys(routeModules)
    .map((p) => [p, p.slice(p.lastIndexOf('/') + 1)])
    .sort((a, b) => a[1].localeCompare(b[1]));

// jsdom doesn't implement these browser globals; a route touching one is
// a jsdom artifact, not a wallet bug. Stub them so they don't masquerade
// as failures (and, were we to widen the fail policy, don't read red).
let savedGlobals;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    }
    savedGlobals = {
        ResizeObserver: globalThis.ResizeObserver,
        IntersectionObserver: globalThis.IntersectionObserver,
        matchMedia: globalThis.matchMedia,
    };
    globalThis.ResizeObserver = globalThis.ResizeObserver || StubObserver;
    globalThis.IntersectionObserver =
        globalThis.IntersectionObserver || StubObserver;
    globalThis.matchMedia =
        globalThis.matchMedia ||
        ((query) => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent() { return false; },
        }));
});
afterAll(() => {
    globalThis.ResizeObserver = savedGlobals.ResizeObserver;
    globalThis.IntersectionObserver = savedGlobals.IntersectionObserver;
    globalThis.matchMedia = savedGlobals.matchMedia;
});

describe('every shared route renders without a code-bug crash', () => {
    // Guard against an empty glob silently passing the suite (e.g. if the
    // routes dir ever moves). If there are no routes, that's itself a bug.
    it('discovers route files to test', () => {
        if (routeEntries.length === 0) {
            throw new Error('no .jsx routes matched by import.meta.glob');
        }
    });

    routeEntries.forEach(([importer, file]) => {
        it(file, async () => {
            const mod = await routeModules[importer]();
            // Routes export a named component matching the filename; fall
            // back to the first exported function for any that don't.
            const name = file.replace(/\.jsx$/, '');
            const Component =
                mod[name] ||
                Object.values(mod).find((v) => typeof v === 'function');
            // Not a component module (a route dir helper) — nothing to render.
            if (!Component) return;

            let err = null;
            try {
                render(
                    React.createElement(
                        MessagingProvider,
                        { shell: 'web', messaging },
                        React.createElement(Component, props),
                    ),
                );
            } catch (e) {
                err = e;
            }

            if (err && CODE_BUG_RE.test(String(err && err.message))) {
                // Re-throw the original so the stack points at the route.
                throw err;
            }
            // Any other throw (prop/env/jsdom noise) is tolerated by
            // design — this probe only asserts the absence of definitive
            // render-time code bugs.
        });
    });
});

// WIDENING THIS PROBE (future work)
// ---------------------------------
// To catch the next layer of latent bugs, two extensions are natural:
//   1. Fail on ANY throw, once each route's prop-driven noise is triaged
//      and either fixed or explicitly allow-listed. Higher signal, but
//      needs per-route curation against the generic props bag above.
//   2. Drive effects/interaction: `await Promise.resolve()` to flush
//      microtasks, resolve a few messaging calls with realistic shapes,
//      fire a click — surfacing crashes that only fire post-mount.
