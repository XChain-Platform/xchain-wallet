// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Suspense, createElement, lazy, useEffect, useState } from 'react';

/**
 * A component whose module, and the CSS that module imports, stay out of the
 * startup bundle and load when first needed or when the browser is idle.
 *
 * Once the module has loaded, every later mount renders the real component
 * synchronously, so refs, focus moves and layout effects run in the same
 * commit exactly as they did with a static import. A mount that comes before
 * the load waits inside a `null` Suspense boundary: the user sees the element
 * a chunk-load late, never as unstyled markup, because Vite resolves a lazy
 * chunk only after its stylesheet has loaded. Each mount keeps the path it
 * started on, so a load landing mid-life never remounts a subtree.
 *
 * @template P
 * @param {() => Promise<Record<string, import('react').ComponentType<P>>>} load
 * @param {string} exportName
 * @returns {import('react').FunctionComponent<P> & { preload: () => Promise<unknown>, isLoaded: () => boolean }}
 */
export function onDemandComponent(load, exportName) {
    let loaded = null;
    let pending = null;
    const preload = () => {
        if (!pending) {
            pending = load().then((module) => {
                loaded = module[exportName];
                return loaded;
            });
            // A failed fetch (offline, a redeploy) may be retried by the next caller.
            pending.catch(() => { pending = null; });
        }
        return pending;
    };
    const Lazy = lazy(() => preload().then((component) => ({ default: component })));

    function OnDemand(props) {
        const [Component] = useState(() => loaded);
        if (Component) return createElement(Component, props);
        return createElement(Suspense, { fallback: null }, createElement(Lazy, props));
    }
    OnDemand.displayName = `OnDemand(${exportName})`;
    OnDemand.preload = preload;
    OnDemand.isLoaded = () => loaded !== null;
    return OnDemand;
}

/**
 * Loads on-demand components once the browser is idle after this component
 * mounts, so the first open of a dialog or toast finds its module ready.
 *
 * @param {...{ preload: () => Promise<unknown> }} components
 */
export function useIdlePreload(...components) {
    useEffect(() => {
        const work = () => {
            for (const component of components) component.preload().catch(() => {});
        };
        if (typeof globalThis.requestIdleCallback === 'function') {
            const id = globalThis.requestIdleCallback(work, { timeout: 1000 });
            return () => globalThis.cancelIdleCallback?.(id);
        }
        const id = setTimeout(work, 16);
        return () => clearTimeout(id);
    // The components are module-level constants; one schedule per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
}

/**
 * Runs `open` once the component is ready: at once when its module is loaded,
 * else after the load, so the owner's refs and focus effects see the rendered
 * surface in the commit that opens it.
 *
 * @param {{ preload: () => Promise<unknown>, isLoaded: () => boolean }} component
 * @param {() => void} open
 */
export function openWhenLoaded(component, open) {
    if (component.isLoaded()) {
        open();
        return;
    }
    component.preload().then(open, open);
}
