// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The core barrel's `registry` namespace keeps the signed hub sync beside the
// registry itself, so the extension worker, popup, approval window and desktop
// main still reach `registry.syncChainRegistryFromHub` after the sync moved off
// registry/index.js (the module first-paint web code imports).

import { describe, expect, it } from 'vitest';
import * as namespace from '../../../packages/core/src/registry/namespace.js';
import * as registryIndex from '../../../packages/core/src/registry/index.js';
import * as remote from '../../../packages/core/src/registry/remote.js';

describe('core registry namespace', () => {
    it('carries every registry export', () => {
        for (const [name, value] of Object.entries(registryIndex)) {
            expect(namespace[name], name).toBe(value);
        }
    });

    it('carries the signed hub sync and its constants', () => {
        for (const name of [
            'verifyChainRegistry',
            'syncChainRegistryFromHub',
            'REGISTRY_SIGNING_DOMAIN',
            'REGISTRY_PINNED_PUBKEY_HEX',
            'REGISTRY_DEFAULT_URL',
        ]) {
            expect(namespace[name], name).toBe(remote[name]);
        }
    });

    it('keeps the sync off the registry module first-paint code imports', () => {
        expect(registryIndex.syncChainRegistryFromHub).toBeUndefined();
        expect(registryIndex.verifyChainRegistry).toBeUndefined();
    });
});
