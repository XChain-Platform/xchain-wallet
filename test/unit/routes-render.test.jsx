// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Render harness — mount every shared route and fail if it throws a
// code-bug crash, in two layers: initial render, then a post-mount
// effects flush.
//
// WHY THIS EXISTS
// ---------------
// The wallet is largely AI-generated and several route screens shipped
// having clearly never been rendered. Crash classes that slipped through
// a "green" suite:
//   * a botched import-organizer dropped the `ScreenHeader` import from
//     35 route files → `ReferenceError: ScreenHeader is not defined` →
//     white screen on mount;
//   * a `StakeForm` effect dep-array referenced `fromAddress` before its
//     `const fromAddress = useMemo(...)` → TDZ `ReferenceError: Cannot
//     access 'fromAddress' before initialization`;
//   * two more never-rendered screens called registry methods that don't
//     exist — `chainRegistry.list()` / `.all()` (the enumerator is
//     `supportedChains()`) → `TypeError: … is not a function`.
// None were caught because the smoke suite is source-regex assertions
// that never actually render a component, and there were zero form-level
// render tests. This file institutionalises the throwaway jsdom probe
// that found them, and extends it one layer deeper.
//
// TWO LAYERS
// ----------
// Layer 1 — INITIAL RENDER. Mount each route with a *never-resolving*
//   messaging mock, so routes stay in their loading branch and we observe
//   only render-time code. Fail policy is the widest here (INITIAL_BUG_RE,
//   incl. `is not a function`) because every crash this layer sees is on a
//   module-level import/singleton — never on the generic prop bag — so
//   `is not a function` has no false positives (it caught the registry
//   bugs above).
//
// Layer 2 — EFFECTS FLUSH. Mount with a *resolving* messaging mock
//   (every host call resolves to a shared frozen `[]` — a non-null,
//   iterable generic that penetrates deepest; see its definition) and
//   drain microtasks inside `act()`, so each route's post-await
//   data-handling path actually runs.
//   This surfaces `ReferenceError`/TDZ bugs that live in effect bodies,
//   `.then` callbacks, and the "loaded" branch — code Layer 1 never
//   reaches. Fail policy is NARROWER here (EFFECT_BUG_RE, drops
//   `is not a function`): feeding `undefined` where real code expects an
//   array/fn legitimately produces `x is not a function` / `Cannot read
//   properties of undefined`, which is mock-shape noise, not a defect.
//   We still catch the unambiguous classes — a missing import or TDZ in
//   an effect body throws `is not defined` / `before initialization`
//   regardless of data shape.
//
// Layer 3 — INTERACTION. After the effects flush, fill every field and
//   click every enabled button, draining microtasks between. Handler code
//   (onClick/submit) is the least-executed surface in an AI-generated app,
//   so missing-import/TDZ bugs hide there. Same NARROW policy as Layer 2 —
//   validation throws from a garbage-form submit and jsdom gaps
//   (`window.confirm` "Not implemented", navigation) don't match it, so
//   Layer 3 needs no per-route allow-list.
//
// SCOPE / LIMITS
// --------------
// Covers initial render + a microtask-bounded effects flush + a single
// pass of field-fill/button-click interaction. It does NOT let real timers
// fire (Layers 2–3 await microtasks ONLY, so `setInterval`/`setTimeout`
// pollers never fire and can't hang the run), drive multi-step flows
// (wizard step 2+), or assert on rendered output — it's a crash probe, not
// a behaviour spec. Field-fill uses a single generic value (`'1'`), so
// format-specific paths (a valid address, a real mnemonic) stay unexercised.
//
// Runs as ONE vitest process by design: the Parallels share thrashes
// under hundreds of rapid node spawns, so a single-process render sweep
// is both faster and far less flaky than the per-file smoke runner. Use
// the LOCAL vitest bin — `npx vitest` pulls a fresh major into the npx
// cache that can't find jsdom; the workspace pins a compatible version.
//   node_modules/.bin/vitest run test/unit/routes-render.test.jsx \
//     --config test/vitest/unit.config.js

import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';

// `domAct` (Testing Library's `act`, bound to the installed React) flushes
// React effects/state in Layer 2.

// Run every test under fake timers. Some routes (e.g. MarketChart) schedule
// a setTimeout / rAF on mount — chart init, animations — that fires AFTER
// our microtask-only flush and throws in jsdom (`Cannot parse color:
// canvastext`, canvas not implemented, …) as an UNHANDLED exception. Vitest
// flags those as "might cause false positive tests", a flakiness vector for
// a kept guard. Fake timers capture those callbacks so they never execute;
// the global afterEach's `vi.useRealTimers()` (test/setup.js) discards them.
// We fake only timer APIs — NOT queueMicrotask/promises — so the effects-
// flush drain and React's scheduler keep working. This also hardens the
// "real timers deliberately never fire" guarantee Layers 2–3 rely on.
beforeEach(() => {
    vi.useFakeTimers({
        toFake: [
            'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
            'setImmediate', 'clearImmediate', 'requestAnimationFrame',
            'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
            'Date',
        ],
    });
});

// Discover every route module via vite's compile-time glob. Resolved
// relative to THIS file, so the suite works regardless of cwd — and it
// avoids fs/URL-scheme fragility (import.meta.url isn't a file:// URL
// under the vitest transform). Lazy importers (no `eager`) keep a
// module-load crash inside the route's own `it()` instead of failing the
// whole suite at collection time.
const routeModules = import.meta.glob(
    '../../packages/core/src/shared/routes/*.jsx',
);

// Layer 1 messaging: every property access yields a function returning a
// never-resolving promise → routes stay in their loading branch.
const pendingMessaging = new Proxy(
    {},
    { get: () => () => new Promise(() => {}) },
);

// Layer 2 messaging: every host call resolves to a shared frozen empty
// array so the post-await code path runs as DEEP as possible. `[]` beats
// `undefined` as a generic value on two counts: it's a non-null object,
// so property access (`result.items`) yields `undefined` gracefully
// instead of throwing and aborting; and it's iterable, so list-rendering
// code (`.map`/`.filter`/`.length`) runs all the way into the empty-state
// render. Frozen + shared (stable identity) so a route that puts the
// resolved value in an effect dep array doesn't churn into a re-fetch
// loop. Wrong-shape *method* calls still throw `is not a function`, which
// Layer 2 tolerates as mock-shape noise (see EFFECT_BUG_RE).
const EMPTY = Object.freeze([]);
const resolvingMessaging = new Proxy(
    {},
    { get: () => () => Promise.resolve(EMPTY) },
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

// Layer 1 (initial render): the crash sits on a module-level import or
// singleton, so `is not a function` is a real defect, not prop noise.
const INITIAL_BUG_RE = /is not defined|before initialization|is not a function/;
// Layer 2 (effects flush): drop `is not a function` — feeding `undefined`
// where real code expects an array/fn produces that message as mock-shape
// noise. Missing-symbol and TDZ bugs still throw the two we keep.
const EFFECT_BUG_RE = /is not defined|before initialization/;

// [importerPath, filename] pairs, sorted by filename for stable output.
const routeEntries = Object.keys(routeModules)
    .map((p) => [p, p.slice(p.lastIndexOf('/') + 1)])
    .sort((a, b) => a[1].localeCompare(b[1]));

// Resolve the route component: a named export matching the filename, else
// the first exported function. Returns null for non-component modules
// (route-dir helpers), which the caller skips.
async function resolveComponent(importer, file) {
    const mod = await routeModules[importer]();
    const name = file.replace(/\.jsx$/, '');
    return (
        mod[name] ||
        Object.values(mod).find((v) => typeof v === 'function') ||
        null
    );
}

function tree(Component, messaging) {
    return React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Component, props),
    );
}

// Drain chained microtasks so resolved host calls + their setState
// re-renders settle. Microtasks ONLY — never `setTimeout` — so real-timer
// pollers can't fire and hang the run. Wrapped in act() by callers.
async function drainMicrotasks(rounds = 8) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

// jsdom doesn't implement these browser globals; a route touching one is
// a jsdom artifact, not a wallet bug. Stub them so they don't masquerade
// as failures.
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

describe('Layer 1 — every shared route renders without a code-bug crash', () => {
    // Guard against an empty glob silently passing the suite (e.g. if the
    // routes dir ever moves). If there are no routes, that's itself a bug.
    it('discovers route files to test', () => {
        if (routeEntries.length === 0) {
            throw new Error('no .jsx routes matched by import.meta.glob');
        }
    });

    routeEntries.forEach(([importer, file]) => {
        it(file, async () => {
            const Component = await resolveComponent(importer, file);
            if (!Component) return;

            let err = null;
            try {
                render(tree(Component, pendingMessaging));
            } catch (e) {
                err = e;
            }
            if (err && INITIAL_BUG_RE.test(String(err && err.message))) {
                throw err; // re-throw original so the stack points at the route
            }
            // Any other throw (prop/env/jsdom noise) is tolerated by design.
        });
    });
});

describe('Layer 2 — every shared route survives an effects flush', () => {
    routeEntries.forEach(([importer, file]) => {
        it(file, async () => {
            const Component = await resolveComponent(importer, file);
            if (!Component) return;

            let err = null;
            try {
                render(tree(Component, resolvingMessaging));
                await domAct(() => drainMicrotasks());
            } catch (e) {
                err = e;
            }
            if (err && EFFECT_BUG_RE.test(String(err && err.message))) {
                throw err;
            }
        });
    });
});

describe('Layer 3 — every shared route survives basic interaction', () => {
    // Mount, then exercise handler code: fill every field and click every
    // enabled button. Handlers in an AI-generated app with never-rendered
    // screens are the LEAST-executed code, so missing-import / TDZ bugs
    // hide here. Fail policy stays EFFECT_BUG_RE (is not defined / before
    // initialization): an empty/garbage-form submit legitimately throws
    // validation errors and jsdom gaps (`window.confirm` "Not implemented",
    // navigation), none of which match — so this needs no per-route
    // allow-list. Only an undefined symbol or TDZ in handler code fails it.
    routeEntries.forEach(([importer, file]) => {
        it(file, async () => {
            const Component = await resolveComponent(importer, file);
            if (!Component) return;

            let err = null;
            try {
                const { container } = render(
                    tree(Component, resolvingMessaging),
                );
                await domAct(() => drainMicrotasks());

                // Populate fields so submit handlers run their build path
                // instead of bailing at "required" before reaching real code.
                await domAct(async () => {
                    container
                        .querySelectorAll('input, textarea, select')
                        .forEach((el) => {
                            const type = (
                                el.getAttribute('type') || ''
                            ).toLowerCase();
                            if (type === 'checkbox' || type === 'radio') {
                                fireEvent.click(el);
                            } else {
                                fireEvent.change(el, {
                                    target: { value: '1' },
                                });
                            }
                        });
                    await drainMicrotasks();
                });

                // Click every enabled button. querySelectorAll snapshots,
                // so re-render churn can't skip or double-fire a node.
                const buttons = Array.from(
                    container.querySelectorAll('button'),
                );
                for (const btn of buttons) {
                    if (btn.disabled) continue;
                    // eslint-disable-next-line no-await-in-loop
                    await domAct(async () => {
                        fireEvent.click(btn);
                        await drainMicrotasks(4);
                    });
                }
            } catch (e) {
                err = e;
            }
            if (err && EFFECT_BUG_RE.test(String(err && err.message))) {
                throw err;
            }
        });
    });
});
