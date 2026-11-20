// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deterministicCssModuleOrderPlugin } from '../../../packages/web/cssDeterminism.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

for (const config of [
    'packages/web/vite.config.js',
    'packages/extension/vite.config.js',
]) {
    const source = readFileSync(join(root, config), 'utf8');
    assert.match(
        source,
        /deterministicCssModuleOrderPlugin\(\)/,
        `${config} must order CSS modules from the import graph`,
    );
}

const inboxCss = readFileSync(join(root,
    'packages/core/src/shared/routes/MessagingInbox.module.css'), 'utf8');
const inboxJsx = readFileSync(join(root,
    'packages/core/src/shared/routes/MessagingInbox.jsx'), 'utf8');
assert.doesNotMatch(inboxCss, /composes:\s*sellerAvatar/,
    'the messaging avatar must not schedule a transitive CSS-module load');
assert.match(inboxJsx, /import dispenserStyles from '\.\/DispenserExplorer\.module\.css';/,
    'the messaging avatar must put the shared stylesheet in the source import graph');
assert.match(inboxJsx, /dispenserStyles\.sellerAvatar/,
    'the messaging avatar must retain the shared seller-avatar class');

let receivedModules;
const cssPostPlugin = {
    name: 'vite:css-post',
    renderChunk(_code, chunk) { receivedModules = Object.keys(chunk.modules); },
};
const plugin = deterministicCssModuleOrderPlugin();
plugin.configResolved({
    root: '/repo',
    build: { rollupOptions: { input: { main: '/repo/main.js' } } },
    plugins: [cssPostPlugin],
});
const chunk = {
    moduleIds: ['/repo/main.js', '/repo/b.css', '/repo/a.css'],
    modules: { '/repo/a.css': {}, '/repo/main.js': {}, '/repo/b.css': {} },
};
cssPostPlugin.renderChunk('', chunk);
assert.deepEqual(receivedModules, [
    '/repo/main.js',
    '/repo/b.css',
    '/repo/a.css',
]);

console.log('OK: deterministic CSS build smoke');
