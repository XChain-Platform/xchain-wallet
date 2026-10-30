// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from '@babel/parser';

const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;
const CONFIG_EXTENSIONS = /\.(?:json|ya?ml|toml|sh)$/;
const LOCKFILES = /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/;
const DEPENDENCY_FIELDS = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
];
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

function packageName(specifier) {
    if (
        typeof specifier !== 'string'
        || specifier.startsWith('.')
        || specifier.startsWith('/')
        || specifier.startsWith('#')
        || specifier.startsWith('node:')
        || specifier.includes('://')
        || BUILTINS.has(specifier)
    ) {
        return null;
    }
    const parts = specifier.split('/');
    const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    return /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name)
        ? name
        : null;
}

function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const [key, value] of Object.entries(node)) {
        if (key === 'loc' || key === 'start' || key === 'end') continue;
        if (Array.isArray(value)) {
            for (const child of value) walk(child, visit);
        } else if (value && typeof value === 'object' && typeof value.type === 'string') {
            walk(value, visit);
        }
    }
}

function literalValue(node) {
    return node?.type === 'StringLiteral' || node?.type === 'Literal'
        ? node.value
        : null;
}

function analyzeSource(source, filename) {
    const ast = parse(source, {
        sourceType: 'unambiguous',
        sourceFilename: filename,
        errorRecovery: true,
        plugins: ['jsx', 'typescript', 'importAttributes', 'topLevelAwait'],
    });
    const imports = new Set();
    const literals = [];
    const add = (value) => {
        const name = packageName(value);
        if (name) imports.add(name);
    };

    walk(ast, (node) => {
        const literal = literalValue(node);
        if (typeof literal === 'string') literals.push(literal);
        if (
            node.type === 'ImportDeclaration'
            || node.type === 'ExportNamedDeclaration'
            || node.type === 'ExportAllDeclaration'
        ) {
            add(literalValue(node.source));
            return;
        }
        if (node.type === 'ImportExpression') {
            add(literalValue(node.source));
            return;
        }
        if (node.type !== 'CallExpression') return;

        const callee = node.callee;
        const isRequire = callee?.type === 'Identifier' && callee.name === 'require';
        const isDynamicImport = callee?.type === 'Import';
        const isRequireResolve = callee?.type === 'MemberExpression'
            && callee.object?.type === 'Identifier'
            && callee.object.name === 'require'
            && callee.property?.type === 'Identifier'
            && callee.property.name === 'resolve';
        const isTestImport = callee?.type === 'MemberExpression'
            && callee.object?.type === 'Identifier'
            && ['vi', 'vitest', 'jest'].includes(callee.object.name)
            && callee.property?.type === 'Identifier'
            && ['mock', 'doMock', 'unmock', 'importActual', 'importMock'].includes(
                callee.property.name,
            );
        if (isRequire || isDynamicImport || isRequireResolve || isTestImport) {
            add(literalValue(node.arguments?.[0]));
        }
    });
    return { imports, literals };
}

/** Return package names loaded by static ESM, CommonJS, or test-runner imports. */
export function extractPackageImports(source, filename = 'source.js') {
    return analyzeSource(source, filename).imports;
}

function declaredDependencies(pkg) {
    return new Set(DEPENDENCY_FIELDS.flatMap((field) => Object.keys(pkg[field] ?? {})));
}

function packageMetadata(manifestPath, dependency) {
    try {
        const requireFromManifest = createRequire(pathToFileURL(manifestPath));
        const dependencyManifest = JSON.parse(readFileSync(
            requireFromManifest.resolve(`${dependency}/package.json`),
            'utf8',
        ));
        const bins = typeof dependencyManifest.bin === 'string'
            ? [dependencyManifest.name]
            : Object.keys(dependencyManifest.bin ?? {});
        return {
            bins,
            peers: Object.keys(dependencyManifest.peerDependencies ?? {}),
        };
    } catch {
        return { bins: [], peers: [] };
    }
}

function scriptUsesDependency(scripts, dependency, bins) {
    const commands = Object.values(scripts ?? {}).join('\n');
    if (commands.includes(dependency)) return true;
    return bins.some((bin) => new RegExp(`(^|[;&|\\s])${bin.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
    )}(?=$|\\s)`).test(commands));
}

function mentionsDependency(text, dependency) {
    const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9._~@/-])${escaped}(?:/|$|[^a-z0-9._~-])`, 'i').test(text);
}

function ownerOf(file, manifests) {
    return manifests.find(({ directory }) => (
        directory === '' || file === directory || file.startsWith(`${directory}/`)
    ));
}

/**
 * Audit already-loaded workspace files. This shape keeps the dependency rules
 * independently testable without creating a fixture repository.
 */
export function auditLoadedWorkspace({
    files,
    manifests,
    metadataByManifest = new Map(),
    binsByManifest = new Map(),
}) {
    const orderedManifests = [...manifests].sort(
        (left, right) => right.directory.length - left.directory.length,
    );
    const imports = new Map(manifests.map(({ path }) => [path, new Map()]));
    const references = new Map(manifests.map(({ path }) => [path, new Set()]));

    for (const file of files) {
        const owner = ownerOf(file.path, orderedManifests);
        if (!owner) continue;
        if (!SOURCE_EXTENSIONS.test(file.path)) {
            if (CONFIG_EXTENSIONS.test(file.path) && !file.path.endsWith('package.json')) {
                for (const dependency of declaredDependencies(owner.package)) {
                    if (mentionsDependency(file.source, dependency)) {
                        references.get(owner.path).add(dependency);
                    }
                }
            }
            continue;
        }
        let analysis;
        try {
            analysis = analyzeSource(file.source, file.path);
        } catch (error) {
            throw new Error(`cannot parse ${file.path}: ${error.message}`, { cause: error });
        }
        for (const dependency of analysis.imports) {
            const locations = imports.get(owner.path).get(dependency) ?? [];
            locations.push(file.path);
            imports.get(owner.path).set(dependency, locations);
        }
        for (const dependency of declaredDependencies(owner.package)) {
            if (analysis.literals.some((literal) => mentionsDependency(literal, dependency))) {
                references.get(owner.path).add(dependency);
            }
        }
    }

    return manifests.map((manifest) => {
        const declared = declaredDependencies(manifest.package);
        const ownName = manifest.package.name;
        const undeclared = [...imports.get(manifest.path)]
            .filter(([dependency]) => dependency !== ownName && !declared.has(dependency))
            .map(([dependency, locations]) => ({
                dependency,
                files: [...new Set(locations)].sort(),
            }))
            .sort((left, right) => left.dependency.localeCompare(right.dependency));
        const used = new Set([
            ...imports.get(manifest.path).keys(),
            ...references.get(manifest.path),
        ]);
        for (const dependency of declared) {
            const metadata = metadataByManifest.get(manifest.path)?.get(dependency);
            const bins = metadata?.bins
                ?? binsByManifest.get(manifest.path)?.get(dependency)
                ?? [];
            if (scriptUsesDependency(manifest.package.scripts, dependency, bins)) {
                used.add(dependency);
            }
        }
        let expanded = true;
        while (expanded) {
            expanded = false;
            for (const dependency of [...used]) {
                const peers = metadataByManifest.get(manifest.path)?.get(dependency)?.peers ?? [];
                for (const peer of peers) {
                    if (declared.has(peer) && !used.has(peer)) {
                        used.add(peer);
                        expanded = true;
                    }
                }
            }
        }
        const unused = [...declared].filter((dependency) => !used.has(dependency)).sort();
        return { manifest: manifest.path, undeclared, unused };
    });
}

export function auditRepository(repoRoot) {
    const tracked = execFileSync('git', ['ls-files', '-z'], {
        cwd: repoRoot,
        encoding: 'utf8',
    }).split('\0').filter(Boolean);
    const manifestPaths = tracked.filter((file) => file.endsWith('package.json'));
    const manifests = manifestPaths.map((path) => ({
        path,
        directory: dirname(path) === '.' ? '' : dirname(path),
        package: JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8')),
    }));
    const files = tracked.filter((path) => (
        SOURCE_EXTENSIONS.test(path) || (CONFIG_EXTENSIONS.test(path) && !LOCKFILES.test(path))
    )).map((path) => ({
        path,
        source: readFileSync(resolve(repoRoot, path), 'utf8'),
    }));
    const metadataByManifest = new Map(manifests.map((manifest) => [
        manifest.path,
        new Map([...declaredDependencies(manifest.package)].map((dependency) => [
            dependency,
            packageMetadata(resolve(repoRoot, manifest.path), dependency),
        ])),
    ]));
    return auditLoadedWorkspace({ files, manifests, metadataByManifest });
}

export function formatAudit(results) {
    const lines = [];
    for (const result of results) {
        lines.push(result.manifest);
        lines.push(`  unused: ${result.unused.length ? result.unused.join(', ') : 'none'}`);
        if (result.undeclared.length === 0) {
            lines.push('  imported but undeclared: none');
        } else {
            lines.push('  imported but undeclared:');
            for (const missing of result.undeclared) {
                lines.push(`    ${missing.dependency}: ${missing.files.join(', ')}`);
            }
        }
    }
    return lines.join('\n');
}

const isMain = process.argv[1]
    && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const results = auditRepository(repoRoot);
    console.log(formatAudit(results));
    if (process.argv.includes('--check') && results.some(
        (result) => result.unused.length || result.undeclared.length,
    )) {
        process.exitCode = 1;
    }
}
