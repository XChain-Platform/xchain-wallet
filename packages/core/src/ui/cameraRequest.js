// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// How many camera starts are waiting on the system.
//
// In the Android app, asking for the camera opens the system permission
// dialog over the activity, and Android pauses the activity for it. The
// native lifecycle hook reads `pending` so that pause is not treated as the
// user leaving the app: the scanner stays on screen to show the answer. A
// real background still follows as the page turning hidden. The scanner
// counts its own requests and the bounded wait lives in cameraWait.js, so
// the startup bundle carries only this counter.

/** @type {{ pending: number }} */
export const cameraRequests = { pending: 0 };
