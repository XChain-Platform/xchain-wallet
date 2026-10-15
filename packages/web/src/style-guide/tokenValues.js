// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The token values the style guide prints, read from tokens.css itself so a
// token change shows up in the guide without anyone retyping a hex value.
// Light is the top-level `:root` block; dark is that block overlaid with the
// explicit `:root[data-xc-theme="dark"]` block, which the dark media query
// block mirrors.
import tokensCss from '@xchain-wallet/core/ui/tokens.css?raw';

const LIGHT_SELECTOR = ':root {';
const DARK_SELECTOR = ':root[data-xc-theme="dark"] {';

/** The text between the braces of the first top-level block opened by `selector`. */
function blockBody(css, selector) {
    let index = -1;
    let from = 0;
    // A top-level block starts a line; `:root {` also appears nested in @media.
    while ((index = css.indexOf(selector, from)) !== -1) {
        if (index === 0 || css[index - 1] === '\n') break;
        from = index + selector.length;
    }
    if (index === -1) throw new Error(`tokens.css has no top-level ${selector} block`);
    let depth = 0;
    const start = index + selector.length;
    for (let i = start; i < css.length; i += 1) {
        if (css[i] === '{') depth += 1;
        else if (css[i] === '}') {
            if (depth === 0) return css.slice(start, i);
            depth -= 1;
        }
    }
    throw new Error(`tokens.css ${selector} block is not closed`);
}

/** `--xc-*` declarations in a block body, comments removed, whitespace collapsed. */
export function declarations(body) {
    const clean = body.replace(/\/\*[\s\S]*?\*\//g, '');
    return new Map(
        [...clean.matchAll(/(--xc-[\w-]+)\s*:\s*([^;]+);/g)]
            .map(([, name, value]) => [name, value.replace(/\s+/g, ' ').trim()]),
    );
}

/**
 * Parses tokens.css into its light and dark declaration maps.
 *
 * @param {string} css
 * @returns {{ light: Map<string, string>, dark: Map<string, string> }}
 */
export function parseThemeTokens(css) {
    const light = declarations(blockBody(css, LIGHT_SELECTOR));
    const dark = new Map([...light, ...declarations(blockBody(css, DARK_SELECTOR))]);
    return { light, dark };
}

/**
 * Follows `var(--xc-…)` references, including ones inside a longer value,
 * until only literal values remain. A reference with no declaration keeps its
 * fallback, or stays as written when it has none.
 *
 * @param {Map<string, string>} values
 * @param {string} name
 * @returns {string | undefined}
 */
export function resolveToken(values, name, seen = new Set()) {
    const value = values.get(name);
    if (value == null || seen.has(name)) return value;
    const nextSeen = new Set(seen).add(name);
    return value.replace(/var\((--xc-[\w-]+)(?:\s*,\s*([^()]*))?\)/g, (match, ref, fallback) => (
        resolveToken(values, ref, nextSeen) ?? fallback?.trim() ?? match
    ));
}

export const THEME_TOKENS = parseThemeTokens(tokensCss);

/** The declared value of `name` in the light (default) palette. */
export const declaredToken = (name) => THEME_TOKENS.light.get(name);

/** The resolved literal value of `name` in `theme`. */
export const tokenIn = (theme, name) => resolveToken(THEME_TOKENS[theme], name);
