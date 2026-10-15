// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    existsSync,
    readFileSync,
    realpathSync,
} from 'node:fs';
import {
    dirname,
    join,
} from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const shippedPackages = [
    'packages/web',
    'packages/extension',
    'packages/desktop',
    'packages/mobile',
];

function readManifest(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function resolveManifest(name, fromDirectory) {
    let directory = fromDirectory;

    while (true) {
        const candidate = join(directory, 'node_modules', name, 'package.json');
        if (existsSync(candidate)) return realpathSync(candidate);

        const parent = dirname(directory);
        if (parent === directory) return null;
        directory = parent;
    }
}

function productionDependencyGraph(rootManifests) {
    const queue = rootManifests.map((manifestPath) => ({
        manifestPath,
        path: [readManifest(manifestPath).name],
    }));
    const visited = new Set();
    const pathsByName = new Map();

    while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current.manifestPath)) continue;
        visited.add(current.manifestPath);

        const manifest = readManifest(current.manifestPath);
        pathsByName.set(manifest.name, current.path);
        const dependencies = manifest.dependencies ?? {};
        const optionalDependencies = manifest.optionalDependencies ?? {};

        for (const name of [...Object.keys(dependencies), ...Object.keys(optionalDependencies)]) {
            const dependencyManifest = resolveManifest(name, dirname(current.manifestPath));
            if (!dependencyManifest) {
                if (name in dependencies) {
                    throw new Error(`Cannot resolve production dependency ${[...current.path, name].join(' -> ')}`);
                }
                continue;
            }
            queue.push({
                manifestPath: dependencyManifest,
                path: [...current.path, name],
            });
        }
    }

    return pathsByName;
}

describe('shipped dependency boundary', () => {
    it('keeps http-cache-semantics out of every wallet runtime', () => {
        const rootManifests = shippedPackages.map((directory) => (
            join(repoRoot, directory, 'package.json')
        ));
        const productionGraph = productionDependencyGraph(rootManifests);

        expect(
            productionGraph.get('http-cache-semantics'),
            'http-cache-semantics entered the production dependency closure for web, extension, '
                + 'desktop, or mobile',
        ).toBeUndefined();
    });

    it('does not classify desktop packaging tools as runtime dependencies', () => {
        const desktop = readManifest(join(repoRoot, 'packages/desktop/package.json'));

        expect(desktop.dependencies).not.toHaveProperty('electron-builder');
        expect(desktop.devDependencies).toHaveProperty('electron-builder');
    });
});
