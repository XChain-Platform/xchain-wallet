// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Convert a vertical viewport fold into widths within Home's container.
 *
 * @param {{ vertical?: boolean, dividerX?: number } | null | undefined} fold
 * @param {{ left?: number, width?: number } | null | undefined} container
 * @param {{ minList: number, minDetail: number }} floors
 * @returns {{ listWidth: number, detailWidth: number, fitsMinimums: boolean } | null}
 */
export function homeFoldSplit(fold, container, { minList, minDetail }) {
    const dividerX = fold?.dividerX;
    const left = container?.left;
    const width = container?.width;
    if (fold?.vertical !== true
        || !Number.isFinite(dividerX)
        || !Number.isFinite(left)
        || !Number.isFinite(width)
        || width <= 0
        || dividerX <= left
        || dividerX >= left + width) {
        return null;
    }

    const listWidth = Math.round(dividerX - left);
    const detailWidth = width - listWidth;
    return {
        listWidth,
        detailWidth,
        fitsMinimums: listWidth >= minList && detailWidth >= minDetail,
    };
}
