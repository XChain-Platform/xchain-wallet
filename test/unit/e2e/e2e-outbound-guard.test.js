// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { expect, test } from 'vitest';

import { hubRegistryBody } from '../../e2e/fixtures/hubStub.js';
import { isLocalUrl } from '../../e2e/fixtures/outboundGuard.js';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/descriptors/index.js';

test('the hub stub serves the bundled descriptors in the shape the sync expects', () => {
    const body = hubRegistryBody();
    expect(body.schema_version).toBe(1);
    expect(body.descriptors).toBe(BUNDLED_DESCRIPTORS);
    expect(body.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('the outbound guard treats loopback and inline schemes as local only', () => {
    expect(isLocalUrl('http://localhost:5473/')).toBe(true);
    expect(isLocalUrl('ws://127.0.0.1:5473/')).toBe(true);
    expect(isLocalUrl('data:text/html,x')).toBe(true);
    expect(isLocalUrl('https://hub.xchain.io/api/v1/chain-registry')).toBe(false);
    expect(isLocalUrl('wss://explorer.example/ws')).toBe(false);
});
