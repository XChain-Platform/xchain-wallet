// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The web shell and the desktop shell must route an `xchain:` link through
// the same mapping. Both are pinned here: the web source must call the shared
// function and carry no mapping of its own, and the shared function must keep
// producing the route each view expects.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { registry as registryLib } from '@xchain-wallet/core';
import { deepLinkRoute } from '../../packages/desktop/renderer/deepLinkRoute.js';

const webApp = readFileSync(resolve(process.cwd(), 'packages/web/src/App.jsx'), 'utf8');
const applyBody = webApp.slice(webApp.indexOf('const applyUriIntent'), webApp.indexOf('// §47 / Cluster L', webApp.indexOf('const applyUriIntent')));

const registry = registryLib.defaultRegistry();

describe('shared URI to view mapping', () => {
    it('web applyUriIntent delegates to deepLinkRoute', () => {
        expect(webApp).toMatch(/import \{ deepLinkRoute \} from '\.\.\/\.\.\/desktop\/renderer\/deepLinkRoute\.js'/);
        expect(applyBody).toContain('deepLinkRoute(raw');
    });

    it('web applyUriIntent holds no second mapping of its own', () => {
        expect(applyBody).not.toMatch(/parseXchainUri|hardenUriIntentText|intent\.kind/);
    });

    it('routes a receive link to the receive view', () => {
        expect(deepLinkRoute('xchain:BTC/receive', registry)).toEqual({ view: 'receive' });
    });

    it('routes an execute link with its prefill and drops one without a contract', () => {
        const route = deepLinkRoute('xchain:BTC/execute?contract=12&method=foo', registry);
        expect(route?.view).toBe('contract-execute');
        expect(route?.contractRef?.contractActionIndex).toBe('12');
        expect(route?.executePrefill?.method).toBe('foo');
        expect(deepLinkRoute('xchain:BTC/execute?method=foo', registry)).toBe(null);
    });

    it('routes nothing for non-strings and foreign schemes', () => {
        expect(deepLinkRoute(undefined, registry)).toBe(null);
        expect(deepLinkRoute('https://example.com', registry)).toBe(null);
    });
});
