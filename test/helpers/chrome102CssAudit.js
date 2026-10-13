// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const VALUE_FEATURES = [
    { name: 'color-mix()', value: /color-mix\s*\(/i, supports: /color-mix\s*\(/i },
    {
        name: 'modern color function',
        value: /(?:oklch|oklab|lab|lch|light-dark|color-contrast|device-cmyk)\s*\(/i,
        supports: /(?:oklch|oklab|lab|lch|light-dark|color-contrast|device-cmyk)\s*\(/i,
    },
    {
        name: 'container unit',
        value: /(^|[^\w-])(?:\d*\.)?\d+(?:cqw|cqh|cqi|cqb|cqmin|cqmax)(?![\w-])/i,
        supports: /(?:cqw|cqh|cqi|cqb|cqmin|cqmax)/i,
    },
    {
        name: 'modern viewport unit',
        value: /(^|[^\w-])(?:\d*\.)?\d+(?:svw|svh|lvw|lvh|dvw|dvh|svi|svb|lvi|lvb|dvi|dvb)(?![\w-])/i,
        supports: /(?:svw|svh|lvw|lvh|dvw|dvh|svi|svb|lvi|lvb|dvi|dvb)/i,
    },
    { name: 'subgrid', value: /(^|\s)subgrid(?:\s|$)/i, supports: /subgrid/i },
    {
        name: 'lh/rlh unit',
        value: /(^|[^\w-])(?:\d*\.)?\d+(?:lh|rlh)(?![\w-])/i,
        supports: /(?:\d*\.)?\d+(?:lh|rlh)/i,
    },
    {
        name: 'modern math function',
        value: /(?:^|[^\w-])(?:round|mod|rem|sin|cos|tan|asin|acos|atan|atan2|pow|sqrt|hypot|log|exp|abs|sign)\s*\(/i,
        supports: /(?:round|mod|rem|sin|cos|tan|asin|acos|atan|atan2|pow|sqrt|hypot|log|exp|abs|sign)\s*\(/i,
    },
    { name: 'linear() easing', value: /(?:^|[^\w-])linear\s*\(/i, supports: /linear\s*\(/i },
];

const NEW_PROPERTIES = /^(?:anchor-name|anchor-scope|field-sizing|interpolate-size|position-anchor|position-area|position-try|position-try-fallbacks|position-visibility|scroll-timeline|scroll-timeline-axis|scroll-timeline-name|timeline-scope|transition-behavior|view-timeline|view-timeline-axis|view-timeline-inset|view-timeline-name|view-transition-class|view-transition-name|white-space-collapse)$/i;
const NEW_PSEUDOS = /:(?:modal|open|popover-open|state|user-invalid|user-valid)\b|::view-transition(?:-[\w-]+)?\b/i;
const NEW_AT_RULES = new Set(['container', 'scope', 'starting-style', 'view-transition']);

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ancestors(node) {
    const out = [];
    for (let current = node.parent; current; current = current.parent) out.push(current);
    return out;
}

function hasSupportsGuard(node, pattern) {
    return ancestors(node).some((parent) => (
        parent.type === 'atrule'
        && parent.name.toLowerCase() === 'supports'
        && pattern.test(parent.params)
    ));
}

function hasEarlierFallback(decl, feature) {
    for (let previous = decl.prev(); previous; previous = previous.prev()) {
        if (previous.type !== 'decl' || previous.prop !== decl.prop) continue;
        return !feature.value.test(previous.value);
    }
    return false;
}

function hasGeneratedColorMixFallback(decl) {
    const rule = decl.parent;
    const gate = rule?.next();
    if (!gate || gate.type !== 'atrule' || gate.name.toLowerCase() !== 'supports') return false;
    if (!/^not\s*\([^)]*color-mix\s*\(/i.test(gate.params)) return false;
    return gate.nodes?.some((node) => (
        node.type === 'rule'
        && node.selector === rule.selector
        && node.nodes.some((candidate) => (
            candidate.type === 'decl'
            && candidate.prop === decl.prop
            && !/color-mix\s*\(/i.test(candidate.value)
        ))
    ));
}

function addIssue(issues, node, feature) {
    issues.push({ feature, line: node.source?.start?.line ?? 1 });
}

/**
 * Find CSS features that need a fallback or a matching `@supports` guard for
 * the Chrome 102 WebView floor.
 *
 * @param {import('postcss').Root} root
 * @returns {{ feature: string, line: number }[]}
 */
export function findChrome102CssIssues(root) {
    const issues = [];

    root.walkDecls((decl) => {
        const features = [...VALUE_FEATURES];
        if (/^container-(?:type|name)$/i.test(decl.prop)) {
            features.push({ name: decl.prop, value: /[\s\S]/, supports: /container-(?:type|name)\s*:/i });
        }
        if (/^text-wrap$/i.test(decl.prop) && /^(?:balance|pretty)$/i.test(decl.value.trim())) {
            features.push({
                name: `text-wrap: ${decl.value.trim()}`,
                value: /^(?:balance|pretty)$/i,
                supports: /text-wrap\s*:\s*(?:balance|pretty)/i,
            });
        }
        if (NEW_PROPERTIES.test(decl.prop)) {
            features.push({
                name: decl.prop,
                value: /[\s\S]/,
                supports: new RegExp(`${escapeRegExp(decl.prop)}\\s*:`, 'i'),
            });
        }

        for (const feature of features) {
            if (!feature.value.test(decl.value)) continue;
            if (hasSupportsGuard(decl, feature.supports)) continue;
            if (hasEarlierFallback(decl, feature)) continue;
            if (feature.name === 'color-mix()' && hasGeneratedColorMixFallback(decl)) continue;
            addIssue(issues, decl, feature.name);
        }
    });

    root.walkRules((rule) => {
        if (/:has\s*\(/i.test(rule.selector) && !hasSupportsGuard(rule, /selector\s*\([^)]*:has\s*\(/i)) {
            addIssue(issues, rule, ':has()');
        }
        const modernPseudo = NEW_PSEUDOS.exec(rule.selector)?.[0];
        if (modernPseudo) {
            const supports = new RegExp(`selector\\s*\\([^)]*${escapeRegExp(modernPseudo)}`, 'i');
            if (!hasSupportsGuard(rule, supports)) addIssue(issues, rule, 'modern pseudo-selector');
        }
        if (ancestors(rule).some((parent) => parent.type === 'rule')
            && !hasSupportsGuard(rule, /selector\s*\(\s*&/i)) {
            addIssue(issues, rule, 'native CSS nesting');
        }
    });

    root.walkAtRules((atRule) => {
        const name = atRule.name.toLowerCase();
        if (ancestors(atRule).some((parent) => parent.type === 'rule')
            && !hasSupportsGuard(atRule, /selector\s*\(\s*&/i)) {
            addIssue(issues, atRule, 'native CSS nesting');
        }
        if (NEW_AT_RULES.has(name)) {
            const supports = name === 'container'
                ? /container-(?:type|name)\s*:/i
                : new RegExp(`(?:^|[^-])${name.replace('-', '\\-')}(?:[^-]|$)`, 'i');
            if (!hasSupportsGuard(atRule, supports)) addIssue(issues, atRule, `@${name}`);
        }
    });

    return issues;
}
