// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The web shell's variant resolution, and the trap it used to set.
//
// The bug this locks down was measured against the live web wallet: at a
// 1489px viewport the unlock screen rendered inside a ~245px column pinned
// to the right edge, leaving the rest of the page empty, and it survived a
// hard reload. That is the `sidebar` dev-preview frame
// (DevVariantShell.module.css docks a fixed 375px column to the right),
// applied on a desktop because `resolveVariant` fell back to a
// `localStorage` copy of a variant somebody pinned once. The web wallet is
// the public download page's primary call to action, so a stranger landing
// on a browser carrying that key saw a broken app with no way back.
//
// Two properties are asserted here, and they are the fix:
//   1. Stored state is not a variant source. Only the URL and the viewport
//      decide.
//   2. A stored key is ERASED on the way past, so a browser already
//      carrying one heals on its next load rather than staying stuck.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    STORAGE_KEY,
    purgeStoredVariantOverride,
    resolveVariant,
} from '../../../packages/web/src/devVariant.js';

/**
 * The variants that pin a fixed-width dev preview frame
 * (DevVariantShell.module.css). Each one is a way for stale state to make
 * a wide window render a narrow column, so each one is a case here.
 */
const PREVIEW_VARIANTS = ['small', 'sidebar', 'extension'];

/** Point the document at a URL without navigating (jsdom refuses navigation). */
function setUrl(search) {
    window.history.replaceState({}, '', `/${search}`);
}

/** jsdom's innerWidth is writable; the module reads it through the same door a browser does. */
function setViewport(px) {
    Object.defineProperty(window, 'innerWidth', { value: px, configurable: true, writable: true });
}

describe('web shell variant resolution', () => {
    beforeEach(() => {
        window.localStorage.clear();
        setUrl('');
        setViewport(1489);
    });

    afterEach(() => {
        window.localStorage.clear();
        setUrl('');
    });

    it('resolves a desktop viewport to the full variant', () => {
        expect(resolveVariant()).toMatchObject({ variant: 'full', source: 'auto' });
    });

    it('resolves a phone-width viewport to the small variant', () => {
        setViewport(390);
        expect(resolveVariant()).toMatchObject({ variant: 'small', source: 'auto' });
    });

    // The regression itself: the exact state the live wallet was found in.
    it.each(PREVIEW_VARIANTS)('ignores a stored %s override on a desktop viewport', (variant) => {
        window.localStorage.setItem(STORAGE_KEY, variant);
        expect(resolveVariant()).toMatchObject({ variant: 'full', source: 'auto' });
    });

    it('erases the stored override rather than only ignoring it', () => {
        window.localStorage.setItem(STORAGE_KEY, 'sidebar');
        resolveVariant();
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('reports no stored override to erase once the key is gone', () => {
        window.localStorage.setItem(STORAGE_KEY, 'sidebar');
        expect(purgeStoredVariantOverride()).toBe(true);
        expect(purgeStoredVariantOverride()).toBe(false);
    });

    it('never reports a storage source', () => {
        window.localStorage.setItem(STORAGE_KEY, 'extension');
        setUrl('?variant=sidebar');
        expect(resolveVariant().source).toBe('url');
        setUrl('');
        expect(resolveVariant().source).toBe('auto');
    });

    // A designer pinning a preview for one navigation is the supported
    // path, and it stays supported: it is visible in the address bar and
    // gone the moment the bare origin is opened.
    it('honours a preview variant asked for in this navigation', () => {
        setUrl('?variant=sidebar');
        expect(resolveVariant()).toMatchObject({ variant: 'sidebar', source: 'url' });
    });

    it('still maps the legacy popup alias onto the extension frame', () => {
        setUrl('?variant=popup');
        expect(resolveVariant()).toMatchObject({ variant: 'extension', source: 'url' });
    });

    it('ignores a URL value that names no variant', () => {
        setUrl('?variant=enormous');
        expect(resolveVariant()).toMatchObject({ variant: 'full', source: 'auto' });
    });

});
