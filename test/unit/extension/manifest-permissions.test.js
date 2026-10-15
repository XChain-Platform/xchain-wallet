// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(readFileSync(
    resolve(repo, 'packages/extension/manifest.json'),
    'utf8',
));

describe('extension manifest permissions', () => {
    it('matches the reviewed permission surface', () => {
        expect({
            permissions: manifest.permissions,
            host_permissions: manifest.host_permissions,
            optional_permissions: manifest.optional_permissions,
            content_security_policy: manifest.content_security_policy,
        }).toMatchInlineSnapshot(`
          {
            "content_security_policy": {
              "extension_pages": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'",
            },
            "host_permissions": [],
            "optional_permissions": [
              "notifications",
            ],
            "permissions": [
              "storage",
              "sidePanel",
              "alarms",
            ],
          }
        `);
    });
});
