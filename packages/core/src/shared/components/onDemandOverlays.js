// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { onDemandComponent } from '../utils/onDemandComponent.js';

// The startup screens (lock, header, tab bar) only open these dialogs after a
// user action, so they import them through here: the dialogs and the
// OverlaySurface styles load on idle after first paint instead of with the
// startup CSS. Screens that load later import the real modules directly.

/** OverlaySurface for an owner that opens it with `openWhenLoaded`. */
export const OverlaySurfaceOnDemand = onDemandComponent(() => import('./OverlaySurface.jsx'), 'OverlaySurface');

/** ConfirmModal, mounted whole once loaded, so its focus trap sees its panel. */
export const ConfirmModalOnDemand = onDemandComponent(() => import('./ConfirmModal.jsx'), 'ConfirmModal');

/** NoticeModal, mounted whole once loaded, so its focus trap sees its panel. */
export const NoticeModalOnDemand = onDemandComponent(() => import('./NoticeModal.jsx'), 'NoticeModal');

/** DemoExitConfirm (a ConfirmModal), mounted whole once loaded. */
export const DemoExitConfirmOnDemand = onDemandComponent(() => import('./DemoExitConfirm.jsx'), 'DemoExitConfirm');

/** Loads every overlay above now instead of on idle, for a caller that needs them at once. */
export function preloadOnDemandOverlays() {
    return Promise.all([
        OverlaySurfaceOnDemand.preload(),
        ConfirmModalOnDemand.preload(),
        NoticeModalOnDemand.preload(),
        DemoExitConfirmOnDemand.preload(),
    ]).then(() => {});
}
