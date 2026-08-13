// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Store-listing capture mode: the frozen inputs that make a capture
// REPRODUCIBLE.
//
// The listing screenshots are produced by driving the real build
// through the "Try in demo mode" lane and photographing it
// (packages/extension/scripts/capture-listing-screenshots.mjs and its
// desktop twin). Two captures of an UNCHANGED tree used to differ,
// because that lane rolls dice on every run:
//
//   1. the demo wallet's mnemonic, so the address printed in the image
//      is different every time;
//   2. the wall clock, which every synthesized demo timestamp is
//      measured against (demoFixtures.js);
//   3. the demo wallet's id, a fresh UUID, which seeds the portfolio
//      chart's synthetic price walk (PortfolioChart.jsx) and therefore
//      moves both the sparkline and the price-change figure beside it.
//
// That is why the verifier's own way out could never prove anything:
// verify-listing-assets.mjs tells a STALE operator to "rebuild at the
// ref you are submitting and re-run the capture, which re-pins as it
// goes", and a re-capture ALWAYS produced different bytes, so it could
// not distinguish "the product changed" from "the dice rolled
// differently" - and taking it re-rolled the numbers the public
// listing advertises. Measured 2026-08-08 on the Chrome set: three
// images, all bytes different, and the only moving pixels were the
// price-change figure, the sparkline and the demo address.
//
// This module freezes (1) and publishes the instant used to freeze
// (2); (3) is frozen unconditionally for demo wallets, in
// PortfolioChart.jsx, because a demo wallet's chart is synthetic data
// like the rest of the demo and had no reason to be per-session
// random. Nothing here changes what a normal user gets: capture mode
// is off unless the capture harness turns it on, and the default demo
// wallet is still a freshly generated, never-funded, throwaway one.

/**
 * localStorage key the capture harness sets (to `'1'`) before the app
 * boots. Chosen to sit beside the other `xc:`-prefixed shell keys, and
 * read through the same best-effort try/catch they use, so a shell
 * without localStorage simply behaves as "not capturing".
 */
export const DEMO_CAPTURE_FLAG_KEY = 'xc:demoCapture';

/**
 * THIS IS NOT A LEAKED SEED PHRASE, AND NOTHING OF VALUE CAN EVER SIT
 * ON IT.
 *
 * It is the BIP39 specification's own all-zero-entropy test vector -
 * the most widely published mnemonic in existence, already present in
 * a dozen test files in this repository (test/unit/crypto/hd.test.js,
 * test/boundary/crypto/hd-paths.test.js, the onboarding e2e specs...).
 * Every address it derives is watched by sweepers, which is exactly
 * why it is the right choice here: no reader can mistake it for an
 * operator's wallet, and no future contributor can be tempted to fund
 * it.
 *
 * It is used ONLY when capture mode is armed (see
 * {@link isDemoCaptureMode}), so a real user entering demo mode still
 * gets a freshly generated throwaway wallet. Its only job is to make
 * the demo address printed in the public store screenshots the same
 * address on every capture, so two captures of an unchanged tree
 * produce byte-identical images.
 */
export const DEMO_CAPTURE_MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/**
 * The instant every capture pretends to run at, epoch ms
 * (2026-01-15T15:04:00Z).
 *
 * The capture harness installs this as the page clock, so the demo
 * fixtures and the UI that renders their relative timestamps ("3
 * minutes ago") agree on one frozen "now". Freezing only the fixtures
 * would be worse than not freezing them: the fixture rows would be
 * dated at this instant while the UI aged them against the real clock,
 * and the store listing would advertise a wallet whose last activity
 * was months ago.
 *
 * A capture-time value rather than a build-time one, deliberately: it
 * has to be identical across runs, which `Date.now()` is not and a
 * commit timestamp is only until the next commit.
 */
export const DEMO_CAPTURE_CLOCK_MS = Date.UTC(2026, 0, 15, 15, 4, 0);

/**
 * Seed the portfolio chart uses for a demo wallet's synthesized price
 * walk, in place of the wallet's per-session UUID. See
 * PortfolioChart.jsx; this is applied to every demo wallet, capture
 * mode or not.
 */
export const DEMO_CHART_SEED = 'xc-demo-wallet';

/**
 * True when the store-listing capture harness armed capture mode
 * before this page loaded.
 *
 * @returns {boolean}
 */
export function isDemoCaptureMode() {
    try {
        return globalThis.localStorage?.getItem(DEMO_CAPTURE_FLAG_KEY) === '1';
    } catch {
        return false;
    }
}

/**
 * The frozen demo mnemonic when capture mode is armed, otherwise null.
 * A null means "generate a fresh one", which is what every real user
 * gets.
 *
 * @returns {string | null}
 */
export function demoCaptureMnemonic() {
    return isDemoCaptureMode() ? DEMO_CAPTURE_MNEMONIC : null;
}
