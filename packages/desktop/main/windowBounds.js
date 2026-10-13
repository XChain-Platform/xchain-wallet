// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

export const DEFAULT_WINDOW_BOUNDS = Object.freeze({ width: 420, height: 720 });
const MIN_WIDTH = 360;
const MIN_HEIGHT = 600;
const MAX_DIMENSION = 16_384;
const MIN_VISIBLE_EDGE = 64;

const finiteInt = (value) => Number.isFinite(value) ? Math.round(value) : null;

/**
 * Return a safe normal-window rectangle, or null for malformed persisted data.
 * Position is optional so Electron can place a window when only its size is safe.
 *
 * @param {unknown} value
 * @returns {{ width: number, height: number, x?: number, y?: number } | null}
 */
export function normalizeWindowBounds(value) {
    if (!value || typeof value !== 'object') return null;
    const width = finiteInt(value.width);
    const height = finiteInt(value.height);
    if (width === null || height === null
        || width < MIN_WIDTH || height < MIN_HEIGHT
        || width > MAX_DIMENSION || height > MAX_DIMENSION) return null;

    const x = finiteInt(value.x);
    const y = finiteInt(value.y);
    if (x === null || y === null) return { width, height };
    return { x, y, width, height };
}

/**
 * Keep a remembered position only when a useful part of the window remains on
 * a current display. Monitor removal otherwise leaves the restored window lost.
 *
 * @param {unknown} value
 * @param {Array<{ workArea?: { x?: number, y?: number, width?: number, height?: number } }>} displays
 */
export function restoreWindowBounds(value, displays = []) {
    const bounds = normalizeWindowBounds(value);
    if (!bounds || bounds.x === undefined || bounds.y === undefined) return bounds;

    const visible = displays.some(({ workArea }) => {
        const area = normalizeDisplayArea(workArea);
        if (!area) return false;
        const overlapWidth = Math.min(bounds.x + bounds.width, area.x + area.width)
            - Math.max(bounds.x, area.x);
        const overlapHeight = Math.min(bounds.y + bounds.height, area.y + area.height)
            - Math.max(bounds.y, area.y);
        return overlapWidth >= MIN_VISIBLE_EDGE && overlapHeight >= MIN_VISIBLE_EDGE;
    });
    return visible ? bounds : { width: bounds.width, height: bounds.height };
}

/**
 * Offset an additional window so it does not exactly cover an existing one.
 * The display check drops the shifted position when the offset crosses the
 * usable monitor set, allowing Electron to choose a visible location.
 *
 * @param {unknown} value
 * @param {Array<{ workArea?: { x?: number, y?: number, width?: number, height?: number } }>} displays
 * @param {number} [offset]
 */
export function cascadeWindowBounds(value, displays = [], offset = 24) {
    const bounds = restoreWindowBounds(value, displays);
    if (!bounds || bounds.x === undefined || bounds.y === undefined) return bounds;
    return restoreWindowBounds({
        ...bounds,
        x: bounds.x + offset,
        y: bounds.y + offset,
    }, displays);
}

function normalizeDisplayArea(value) {
    if (!value || typeof value !== 'object') return null;
    const x = finiteInt(value.x);
    const y = finiteInt(value.y);
    const width = finiteInt(value.width);
    const height = finiteInt(value.height);
    if ([x, y, width, height].some((part) => part === null) || width <= 0 || height <= 0) return null;
    return { x, y, width, height };
}

export class FileWindowBoundsStore {
    /** @param {string} filePath */
    constructor(filePath) {
        if (typeof filePath !== 'string' || !filePath) {
            throw new Error('FileWindowBoundsStore: filePath is required');
        }
        this._filePath = filePath;
        this._tmpPath = `${filePath}.tmp`;
        this._saveInFlight = Promise.resolve();
    }

    async load() {
        try {
            return normalizeWindowBounds(JSON.parse(await fs.readFile(this._filePath, 'utf8')));
        } catch {
            return null;
        }
    }

    /** @param {unknown} bounds */
    async save(bounds) {
        const normalized = normalizeWindowBounds(bounds);
        if (!normalized) return;
        this._saveInFlight = this._saveInFlight
            .catch(() => {})
            .then(async () => {
                await fs.mkdir(dirname(this._filePath), { recursive: true });
                await fs.writeFile(this._tmpPath, JSON.stringify(normalized), { mode: 0o600 });
                await fs.rename(this._tmpPath, this._filePath);
            });
        return this._saveInFlight;
    }
}

/** @param {string} userDataDir */
export function windowBoundsPathFor(userDataDir) {
    if (typeof userDataDir !== 'string' || !userDataDir) {
        throw new Error('windowBoundsPathFor: userDataDir is required');
    }
    return join(userDataDir, 'window-bounds.json');
}
