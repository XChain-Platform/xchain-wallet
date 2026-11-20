// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export function deterministicCssModuleOrderPlugin() {
    return {
        name: 'xchain-deterministic-css-module-order',
        apply: 'build',
        configResolved(config) {
            const cssPostPlugin = config.plugins.find((plugin) => plugin.name === 'vite:css-post');
            const renderChunk = cssPostPlugin?.renderChunk;
            const handler = typeof renderChunk === 'function'
                ? renderChunk
                : renderChunk?.handler;

            if (typeof handler !== 'function') {
                throw new Error('vite:css-post renderChunk hook was not found');
            }

            const orderedRenderChunk = function renderOrderedCss(code, chunk, ...args) {
                const moduleIds = new Set(chunk.moduleIds);
                const ids = [
                    ...chunk.moduleIds,
                    ...Object.keys(chunk.modules)
                        .filter((id) => !moduleIds.has(id))
                        .sort((a, b) => a.localeCompare(b)),
                ];
                chunk.modules = Object.fromEntries(ids.map((id) => [id, chunk.modules[id]]));
                return handler.call(this, code, chunk, ...args);
            };

            cssPostPlugin.renderChunk = typeof renderChunk === 'function'
                ? orderedRenderChunk
                : { ...renderChunk, handler: orderedRenderChunk };
        },
    };
}
