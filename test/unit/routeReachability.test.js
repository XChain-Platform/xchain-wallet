// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { describe, expect, it } from 'vitest';
import { buildCommands } from '../../packages/core/src/shared/commandPalette/commandRegistry.js';
import webAppSource from '../../packages/web/src/App.jsx?raw';
import webDexSource from '../../packages/web/src/surfaces/dex.jsx?raw';
import extensionAppSource from '../../packages/extension/src/popup/App.jsx?raw';
import desktopAppSource from '../../packages/desktop/renderer/App.jsx?raw';
import leftNavSource from '../../packages/core/src/shared/components/LeftNav.jsx?raw';
import bottomTabBarSource from '../../packages/core/src/shared/components/BottomTabBar.jsx?raw';

const traverse = _traverse.default || _traverse;

const SHELLS = {
    web: [webAppSource, webDexSource],
    extension: [extensionAppSource],
    desktop: [desktopAppSource],
};

// Every entry stays on one line so an exception explains itself in review.
const UNREACHABLE_ROUTE_BASELINE = Object.freeze({
});

function registeredRoutes(sources) {
    const routes = new Set();
    for (const source of sources) {
        for (const match of source.matchAll(/unlockedView\s*===\s*(['"])([^'"]+)\1/g)) {
            routes.add(match[2]);
        }
        if (/unlockedView\s*!==\s*(['"])home\1/.test(source)) routes.add('home');
    }
    return routes;
}

function paletteTargets() {
    const targets = new Set();
    const commands = buildCommands({
        navigate: (route) => targets.add(route),
        hasBtcAddress: true,
        hasVmAddress: true,
        hasGovernanceAddress: true,
        hasDexSurface: true,
    });
    for (const command of commands) command.run();
    return targets;
}

function navigationTargets() {
    const targets = new Set();
    for (const source of [leftNavSource, bottomTabBarSource]) {
        const code = source
            .replace(/(^|[^:])\/\/.*$/gm, '$1')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        for (const match of code.matchAll(/\bid:\s*(['"])([^'"]+)\1/g)) {
            targets.add(match[2]);
        }
    }
    return targets;
}

function stringTargets(node, targets) {
    if (!node) return;
    if (node.type === 'StringLiteral') {
        targets.add(node.value);
        return;
    }
    if (node.type === 'ConditionalExpression') {
        stringTargets(node.consequent, targets);
        stringTargets(node.alternate, targets);
        return;
    }
    if (node.type === 'LogicalExpression') {
        stringTargets(node.left, targets);
        stringTargets(node.right, targets);
    }
}

function screenTargets(sources) {
    const targets = new Set();
    for (const source of sources) {
        const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
        traverse(ast, {
            CallExpression(path) {
                if (!path.findParent((parent) => parent.isJSXAttribute())) return;
                const { callee } = path.node;
                const direct = callee.type === 'Identifier'
                    && ['setUnlockedView', 'openForm'].includes(callee.name);
                const palette = callee.type === 'MemberExpression'
                    && !callee.computed
                    && callee.object.type === 'Identifier'
                    && callee.object.name === 'palette'
                    && callee.property.type === 'Identifier'
                    && callee.property.name === 'navigate';
                if (direct || palette) stringTargets(path.node.arguments[0], targets);
            },
        });
    }
    return targets;
}

function unreachableRoutes(shell, sources) {
    const reachable = new Set([
        ...paletteTargets(),
        ...navigationTargets(),
        ...screenTargets(sources),
    ]);
    return [...registeredRoutes(sources)]
        .filter((route) => !reachable.has(route))
        .map((route) => `${shell}:${route}`)
        .sort();
}

describe('shell route reachability', () => {
    it('collects a substantial route table from every shell', () => {
        for (const sources of Object.values(SHELLS)) {
            expect(registeredRoutes(sources).size).toBeGreaterThan(100);
        }
    });

    it('keeps unreachable routes equal to the reasoned baseline', () => {
        const unreachable = Object.entries(SHELLS)
            .flatMap(([shell, sources]) => unreachableRoutes(shell, sources))
            .sort();
        const baseline = Object.keys(UNREACHABLE_ROUTE_BASELINE).sort();

        for (const note of Object.values(UNREACHABLE_ROUTE_BASELINE)) {
            expect(note.trim().split(/\s+/).length).toBeGreaterThan(2);
            expect(note).not.toContain('\n');
        }
        expect(unreachable).toEqual(baseline);
    });

    it('reports a registered route that has no user-facing entry point', () => {
        const source = `
            function renderRoute(unlockedView) {
                if (unlockedView === 'audit-orphan') return null;
                if (unlockedView !== 'home') return null;
                return null;
            }
        `;

        expect(unreachableRoutes('fixture', [source])).toEqual([
            'fixture:audit-orphan',
        ]);
    });
});
