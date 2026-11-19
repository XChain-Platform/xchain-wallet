// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// History keeps Export and Refresh in the title line's ⋯ menu (operator
// 2026-11-13). These helpers open that menu and reach its items. They stay
// synchronous so a test running under fake timers can use them; a test that
// must wait for the page to load awaits the ⋯ button or a row first.

import { fireEvent, screen, within } from '@testing-library/react';

export const MORE_ACTIONS = 'More actions';
export const EXPORT_ITEM = 'Export…';
export const REFRESH_ITEM = /^Refresh(ing)? history$/;

export function historyMoreButton() {
    return screen.getByRole('button', { name: MORE_ACTIONS });
}

/**
 * Opens the ⋯ menu unless it is already open, and returns it. The button
 * toggles, so a blind click inside a waitFor retry would shut it again.
 */
export function openHistoryMoreMenu() {
    const trigger = historyMoreButton();
    if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
    return screen.getByRole('menu');
}

/**
 * The named menu item, opening the menu first. Choosing an item closes the
 * menu and unmounts it, so callers query again instead of holding the node.
 */
export function historyMenuItem(name) {
    return within(openHistoryMoreMenu()).getByRole('menuitem', { name });
}

/** The named menu item, or null when the open menu does not offer it. */
export function queryHistoryMenuItem(name) {
    return within(openHistoryMoreMenu()).queryByRole('menuitem', { name });
}

/** Opens the menu and clicks the named item. */
export function chooseHistoryMenuItem(name) {
    const item = historyMenuItem(name);
    fireEvent.click(item);
    return item;
}
