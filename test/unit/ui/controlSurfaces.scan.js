// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Scanners behind controlSurfaces.test.js: raw control elements in screen
// source, and control skin set by hand in CSS modules outside the kit.

import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const repoRoot = process.env.CONTROL_SURFACES_ROOT || process.cwd();
const requireFromVite = createRequire(
    createRequire(join(repoRoot, 'packages', 'web', 'package.json')).resolve('vite'),
);
const postcss = requireFromVite('postcss');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'style-guide', 'scripts', 'test', '__tests__']);

function walk(directory, wanted) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(path, wanted);
        return wanted(entry.name) ? [path] : [];
    });
}

function rel(path) {
    return relative(repoRoot, path).split(sep).join('/');
}

/** The kit itself (packages/core/src/ui) is where raw controls and skins belong. */
function isKit(file) {
    return file.startsWith('packages/core/src/ui/');
}

function packageSources() {
    const packages = readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(repoRoot, 'packages', entry.name, 'src'));
    return packages.flatMap((directory) => {
        try {
            return walk(directory, (name) => /\.(jsx|js)$/.test(name) && !/\.test\./.test(name));
        } catch {
            return [];
        }
    }).map(rel).filter((file) => !isKit(file)).sort();
}

function packageStyles() {
    const packages = readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(repoRoot, 'packages', entry.name, 'src'));
    return packages.flatMap((directory) => {
        try {
            return walk(directory, (name) => name.endsWith('.module.css'));
        } catch {
            return [];
        }
    }).map(rel).filter((file) => !isKit(file)).sort();
}

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** Number of raw <button>, <input>, <select> and <textarea> elements in one source file. */
export function rawControlCount(source) {
    return (stripComments(source).match(/<(?:button|input|select|textarea)(?=[\s/>])/g) || []).length;
}

const CONTROL_WORDS = new Set([
    'button', 'buttons', 'btn', 'input', 'inputs', 'select', 'selects',
    'field', 'fields', 'picker', 'pickers', 'textarea', 'segment', 'segments',
]);
const SKIN_PROPERTIES = /^(?:border(?:-(?:top|bottom|left|right|inline|block)[a-z-]*)?|border-radius|background(?:-color)?|outline(?:-[a-z]+)*|box-shadow)$/;

function subjectOf(selector) {
    let start = 0;
    let depth = 0;
    for (let index = 0; index < selector.length; index += 1) {
        const character = selector[index];
        if (character === '(' || character === '[') depth += 1;
        else if (character === ')' || character === ']') depth -= 1;
        else if (depth === 0 && /[>+~\s]/.test(character)) start = index + 1;
    }
    return selector.slice(start).trim();
}

function splitSelectors(selector) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < selector.length; index += 1) {
        const character = selector[index];
        if (character === '(' || character === '[') depth += 1;
        else if (character === ')' || character === ']') depth -= 1;
        else if (character === ',' && depth === 0) {
            parts.push(selector.slice(start, index).trim());
            start = index + 1;
        }
    }
    parts.push(selector.slice(start).trim());
    return parts;
}

function classWords(className) {
    return className.replace(/([a-z0-9])([A-Z])/g, '$1-$2').split(/[-_]/).map((word) => word.toLowerCase());
}

function isControlSubject(subject) {
    const bare = subject.replace(/\[[^\]]*\]/g, '').replace(/:[\w-]+(?:\([^)]*\))?/g, '');
    if (/(?:^|[^\w-])(?:button|input|select|textarea)(?![\w-])/.test(bare.replace(/\.[\w-]+/g, '.'))) return true;
    return [...subject.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)]
        .some((match) => classWords(match[1]).some((word) => CONTROL_WORDS.has(word)));
}

/** Distinct selectors whose subject is a control and which set border, radius, background, outline or shadow. */
export function handSetControlSelectors(source, file = 'Fixture.module.css') {
    const found = new Set();
    postcss.parse(source, { from: file }).walkRules((rule) => {
        for (const selector of splitSelectors(rule.selector)) {
            if (!isControlSubject(subjectOf(selector))) continue;
            let sets = false;
            rule.each((node) => {
                if (node.type === 'decl' && SKIN_PROPERTIES.test(node.prop.toLowerCase())) sets = true;
            });
            if (sets) found.add(selector.replace(/\s+/g, ' '));
        }
    });
    return [...found];
}

export function scanRawControls() {
    const counts = {};
    for (const file of packageSources()) {
        const count = rawControlCount(readFileSync(join(repoRoot, file), 'utf8'));
        if (count > 0) counts[file] = count;
    }
    return counts;
}

export function scanHandSetStyles() {
    const counts = {};
    for (const file of packageStyles()) {
        const count = handSetControlSelectors(readFileSync(join(repoRoot, file), 'utf8'), file).length;
        if (count > 0) counts[file] = count;
    }
    return counts;
}
