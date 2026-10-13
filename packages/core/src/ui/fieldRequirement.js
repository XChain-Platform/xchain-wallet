// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const OPTIONAL_SUFFIX = /\s\(optional\)$/i;

/**
 * Keep the optional-field suffix and accessibility state in one contract.
 * Plain string labels without the suffix are required by the form convention.
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
    const resolvedLabel = optional && hasLabel && !hasOptionalSuffix
        ? `${label} (optional)`
        : label;

    return {
        label: resolvedLabel,
        ariaRequired: ariaRequired ?? (hasLabel || required
            ? (isOptional ? 'false' : 'true')
            : undefined),
    };
}
