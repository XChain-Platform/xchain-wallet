// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Arrow-key support for every `role="tablist"` in the app. The wallet has
// about twenty hand-rolled tab strips (home views, chart ranges, detail
// panes, import lanes); each is a row of buttons carrying role="tab", which
// promises the ARIA tab keyboard model but gave only Tab and Enter. One
// delegated listener supplies the rest for all of them instead of twenty
// copies: Left/Right move to the neighbouring tab (wrapping), Home/End jump
// to the ends, and the tab that receives focus is activated, because every
// strip here selects on click.

import { useEffect } from 'react';

/**
 * Index of the tab to move to for an arrow/Home/End key, or null when the
 * key is not a tab-navigation key.
 *
 * @param {string} key
 * @param {number} index  current tab
 * @param {number} count  number of tabs
 * @param {boolean} [rtl]  right-to-left layout flips the arrows
 * @returns {number | null}
 */
export function nextTabIndex(key, index, count, rtl = false) {
    if (count < 1) return null;
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (key === forward) return (index + 1) % count;
    if (key === backward) return (index - 1 + count) % count;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    return null;
}

/** Handle one delegated tablist keydown. */
function handleTablistKeyDown(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const target = e.target;
    if (!target || typeof target.closest !== 'function') return;
    const tab = target.closest('[role="tab"]');
    const list = tab && tab.closest('[role="tablist"]');
    if (!tab || !list) return;
    const tabs = Array.from(list.querySelectorAll('[role="tab"]'))
        .filter((t) => !t.disabled && t.getAttribute('aria-disabled') !== 'true' && !t.hidden);
    const index = tabs.indexOf(tab);
    if (index < 0) return;
    const rtl = typeof getComputedStyle === 'function' && getComputedStyle(list).direction === 'rtl';
    const next = nextTabIndex(e.key, index, tabs.length, rtl);
    if (next === null || next === index) return;
    e.preventDefault();
    tabs[next].focus();
    tabs[next].click();
}

/** Installs the delegated tablist key handler for the life of the shell. */
export function useTablistKeys() {
    useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        document.addEventListener('keydown', handleTablistKeyDown);
        return () => document.removeEventListener('keydown', handleTablistKeyDown);
    }, []);
}
