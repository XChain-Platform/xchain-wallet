// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const coreSourceRoot = join(here, '..', 'src');
const tokensPath = join(coreSourceRoot, 'ui', 'tokens.css');

/**
 * CSS motion that must remain active under reduced motion. Each entry needs a
 * repo-relative path and a reason explaining why the motion is essential.
 */
export const ESSENTIAL_MOTION_ALLOWLIST = new Map();

function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

function mediaBodies(source, feature) {
    const css = stripComments(source);
    const bodies = [];
    const media = /@media\s*\(([^)]*)\)\s*\{/gi;
    let match;
    while ((match = media.exec(css)) !== null) {
        if (!feature.test(match[1])) continue;
        let depth = 1;
        let end = media.lastIndex;
        while (end < css.length && depth > 0) {
            if (css[end] === '{') depth += 1;
            else if (css[end] === '}') depth -= 1;
            end += 1;
        }
        bodies.push(css.slice(media.lastIndex, end - 1));
        media.lastIndex = end;
    }
    return bodies;
}

function motionDeclarations(source) {
    const declarations = [];
    const css = stripComments(source);
    const declaration = /(?:^|[;{])\s*((?:animation|transition)(?:-[a-z-]+)?)\s*:\s*([^;}]+)/gim;
    let match;
    while ((match = declaration.exec(css)) !== null) {
        declarations.push({
            kind: match[1].startsWith('animation') ? 'animation' : 'transition',
            value: match[2].trim(),
        });
    }
    return declarations;
}

function hasLocalOverride(source, kind) {
    const cancellation = kind === 'animation'
        ? /\banimation(?:-duration)?\s*:\s*(?:none|0(?:\.0+1)?ms)\b/i
        : /\btransition(?:-duration)?\s*:\s*(?:none|0(?:\.0+1)?ms)\b/i;
    return mediaBodies(source, /prefers-reduced-motion\s*:\s*reduce/i)
        .some((body) => cancellation.test(body));
}

export function hasGlobalReducedMotionGuard(source) {
    return mediaBodies(source, /prefers-reduced-motion\s*:\s*reduce/i).some((body) => {
        const compact = body.replace(/\s+/g, ' ');
        const root = ':root:not([data-xc-reduced-motion="no-preference"])';
        return compact.includes(`${root},`)
            && compact.includes(`${root} *`)
            && compact.includes(`${root} *::before`)
            && compact.includes(`${root} *::after`)
            && /animation-duration\s*:\s*0(?:\.0+1)?ms\s*!important/i.test(body)
            && /animation-iteration-count\s*:\s*1\s*!important/i.test(body)
            && /transition-duration\s*:\s*0(?:\.0+1)?ms\s*!important/i.test(body)
            && /scroll-behavior\s*:\s*auto\s*!important/i.test(body);
    });
}

function reducesTransitionToken(source) {
    return mediaBodies(source, /prefers-reduced-motion\s*:\s*reduce/i)
        .some((body) => /--xc-transition\s*:\s*0ms\b/i.test(body));
}

/**
 * Return each stylesheet whose motion is not covered by a global guard, a
 * local override, the reduced transition token, or the essential allowlist.
 *
 * @param {{file: string, source: string}[]} stylesheets
 * @param {string} globalCss
 * @param {Map<string, string>} allowlist
 */
export function findUncoveredMotionCss(
    stylesheets,
    globalCss,
    allowlist = ESSENTIAL_MOTION_ALLOWLIST,
) {
    const globalGuard = hasGlobalReducedMotionGuard(globalCss);
    const tokenReduced = reducesTransitionToken(globalCss);
    const uncovered = [];

    for (const { file, source } of stylesheets) {
        const declarations = motionDeclarations(source);
        if (declarations.length === 0 || allowlist.has(file) || globalGuard) continue;

        const kinds = [];
        const animations = declarations.filter(({ kind }) => kind === 'animation');
        if (animations.length > 0 && !hasLocalOverride(source, 'animation')) {
            kinds.push('animation');
        }

        const transitions = declarations.filter(({ kind }) => kind === 'transition');
        const usesReducedToken = transitions.length > 0
            && transitions.every(({ value }) => value.includes('var(--xc-transition)'))
            && tokenReduced;
        if (transitions.length > 0 && !usesReducedToken && !hasLocalOverride(source, 'transition')) {
            kinds.push('transition');
        }

        if (kinds.length > 0) uncovered.push({ file, kinds });
    }
    return uncovered;
}

function listCss(dir, files = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) listCss(path, files);
        else if (entry.name.endsWith('.css')) files.push(path);
    }
    return files;
}

export function runReducedMotionAudit() {
    const stylesheets = listCss(coreSourceRoot).map((path) => ({
        file: relative(repoRoot, path).split(sep).join('/'),
        source: readFileSync(path, 'utf8'),
    }));
    const globalCss = readFileSync(tokensPath, 'utf8');
    return {
        motionStylesheetCount: stylesheets.filter(({ source }) => motionDeclarations(source).length > 0).length,
        uncovered: findUncoveredMotionCss(stylesheets, globalCss),
    };
}
