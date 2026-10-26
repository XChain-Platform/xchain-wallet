// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Answers the wallet's boot-time chain-registry sync locally. main.jsx asks the
// hub for its signed registry on every page load; with nothing stubbed, a
// run without the host-resolver block reached the mainnet hub and one with it
// logged a console error that failed four specs for a reason unrelated to
// their subject.
//
// The body is built from the repo's own bundled descriptors, never fetched.
// It is unsigned on purpose: the federation signing key is not ours, so the
// app's pinned-key check rejects it and keeps serving the bundled descriptors,
// which is exactly what these specs assume. That rejection is an info log, not
// a console error.

import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/descriptors/index.js';

const REGISTRY_URL = 'https://hub.xchain.io/api/v1/chain-registry**';

/**
 * Builds the JSON body the hub registry endpoint would return, unsigned.
 *
 * @returns {object}
 */
export function hubRegistryBody() {
    return {
        schema_version: 1,
        generatedAt: new Date().toISOString(),
        descriptors: BUNDLED_DESCRIPTORS,
    };
}

/**
 * Routes the hub chain-registry request of a browser context to the local stub.
 *
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function stubHubRegistry(context) {
    await context.route(REGISTRY_URL, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(hubRegistryBody()),
        });
    });
}
