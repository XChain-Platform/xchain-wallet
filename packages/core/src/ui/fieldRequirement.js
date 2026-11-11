// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const OPTIONAL_SUFFIX = /\s+\(optional\)\s*$/i;

/**
 * The text a field's label help tip is named after ("About Ticker"). A label
 * passed as markup (a name beside a tag) would stringify as "[object Object]",
 * so it is named from the field's own aria-label when it has one, else from
 * the label's text content.
 *
 * @param {import('react').ReactNode} label
 * @param {unknown} [ariaLabel]
 * @returns {string}
 */
export function fieldHelpName(label, ariaLabel) {
    if (typeof label === 'string') return label;
    if (typeof ariaLabel === 'string' && ariaLabel.trim()) return ariaLabel.trim();
    return nodeText(label).replace(/\s+/g, ' ').trim();
}

function nodeText(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(nodeText).join('');
    if (typeof node === 'object' && 'props' in node) return nodeText(node.props?.children);
    return '';
}

/**
 * Keep the optional-field label and accessibility state in one contract.
 */
export function resolveFieldRequirement({
    label,
    optional = false,
    required = false,
    ariaRequired,
}) {
    const hasLabel = typeof label === 'string' && label.trim().length > 0;
    const hasOptionalSuffix = hasLabel && OPTIONAL_SUFFIX.test(label.trim());
    const isOptional = !required && (optional || hasOptionalSuffix);
    const resolvedLabel = hasOptionalSuffix ? label.replace(OPTIONAL_SUFFIX, '') : label;

    return {
        label: resolvedLabel,
        isOptional,
        ariaRequired: ariaRequired ?? (hasLabel || required
            ? (isOptional ? 'false' : 'true')
            : undefined),
    };
}
