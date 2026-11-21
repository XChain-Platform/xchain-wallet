// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

export function foldSurvivalFailures(before, after, { scrollTolerancePx = 2 } = {}) {
    const failures = Object.keys(before.fields)
        .sort()
        .filter((name) => !Object.hasOwn(after.fields, name) || after.fields[name] !== before.fields[name])
        .map((name) => `field:${name}`);

    if (Math.abs(after.scrollTop - before.scrollTop) > scrollTolerancePx) failures.push('scroll');
    if (before.confirmOpen && !after.confirmOpen) failures.push('confirm');
    if (before.detailKey !== after.detailKey) failures.push('detail');

    return failures;
}
