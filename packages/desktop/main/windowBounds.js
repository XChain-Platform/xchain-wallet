// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { promises as fs, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DEFAULT_WINDOW_BOUNDS = Object.freeze({ width: 1024, height: 768 });
export const MIN_WINDOW_BOUNDS = Object.freeze({ width: 640, height: 600 });
const MIN_WIDTH = MIN_WINDOW_BOUNDS.width;
const MIN_HEIGHT = MIN_WINDOW_BOUNDS.height;
const MAX_DIMENSION = 16_384;
const MIN_VISIBLE_EDGE = 64;

const finiteInt = (value) => Number.isFinite(value) ? Math.round(value) : null;

/**
 * Fit the first window to the primary display without enlarging the desktop default.
 *
 * @param {unknown} workArea
 * @returns {{ width: number, height: number }}
 */
export function firstLaunchWindowBounds(workArea) {
    const area = normalizeDisplayArea(workArea);
    if (!area) return { ...DEFAULT_WINDOW_BOUNDS };
    return {
        width: Math.min(DEFAULT_WINDOW_BOUNDS.width, area.width),
        height: Math.min(DEFAULT_WINDOW_BOUNDS.height, area.height),
    };
}

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
 * Keep an origin that belongs to any current work area, fitting only the size
 * to that display. Recover other partially visible bounds onto one display.
 *
 * @param {unknown} value
 * @param {Array<{ workArea?: { x?: number, y?: number, width?: number, height?: number } }>} displays
 */
export function restoreWindowBounds(value, displays = []) {
    const bounds = normalizeWindowBounds(value);
    if (!bounds) return null;

    const areas = displays.map(({ workArea }) => normalizeDisplayArea(workArea)).filter(Boolean);
    if (areas.length === 0) return bounds.x === undefined || bounds.y === undefined
        ? bounds
        : { width: bounds.width, height: bounds.height };

    const containingArea = bounds.x === undefined || bounds.y === undefined
        ? null
        : areas.find((area) => containsPoint(bounds.x, bounds.y, area));
    if (containingArea) {
        return {
            ...bounds,
            width: Math.min(bounds.width, containingArea.width),
            height: Math.min(bounds.height, containingArea.height),
        };
    }

    const target = bounds.x === undefined || bounds.y === undefined
        ? largestDisplayArea(areas)
        : bestVisibleDisplay(bounds, areas);
    const width = Math.min(bounds.width, target.width);
    const height = Math.min(bounds.height, target.height);
    if (bounds.x === undefined || bounds.y === undefined || !hasUsefulOverlap(bounds, target)) {
        return { width, height };
    }
    return {
        x: clamp(bounds.x, target.x, target.x + target.width - width),
        y: clamp(bounds.y, target.y, target.y + target.height - height),
        width,
        height,
    };
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

function overlapSize(bounds, area) {
    return {
        width: Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width)
            - Math.max(bounds.x, area.x)),
        height: Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height)
            - Math.max(bounds.y, area.y)),
    };
}

function hasUsefulOverlap(bounds, area) {
    const overlap = overlapSize(bounds, area);
    return overlap.width >= MIN_VISIBLE_EDGE && overlap.height >= MIN_VISIBLE_EDGE;
}

function containsPoint(x, y, area) {
    return x >= area.x && x < area.x + area.width
        && y >= area.y && y < area.y + area.height;
}

function bestVisibleDisplay(bounds, areas) {
    return areas.reduce((best, area) => {
        const overlap = overlapSize(bounds, area);
        const bestOverlap = overlapSize(bounds, best);
        return overlap.width * overlap.height > bestOverlap.width * bestOverlap.height ? area : best;
    });
}

function largestDisplayArea(areas) {
    return areas.reduce((best, area) => (
        area.width * area.height > best.width * best.height ? area : best
    ));
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export class FileWindowBoundsStore {
    /** @param {string} filePath */
    constructor(filePath) {
        if (typeof filePath !== 'string' || !filePath) {
            throw new Error('FileWindowBoundsStore: filePath is required');
        }
        this._filePath = filePath;
        this._tmpPath = `${filePath}.tmp`;
        // The synchronous save writes its own temp file so it never shares
        // one with an async save that is still writing.
        this._syncTmpPath = `${filePath}.sync.tmp`;
        this._saveInFlight = Promise.resolve();
        // Bumped by every synchronous save; an async save queued before it
        // holds older bounds and must not rename over the newer file.
        this._generation = 0;
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
        const generation = this._generation;
        this._saveInFlight = this._saveInFlight
            .catch(() => {})
            .then(async () => {
                if (generation !== this._generation) return;
                await fs.mkdir(dirname(this._filePath), { recursive: true });
                await fs.writeFile(this._tmpPath, JSON.stringify(normalized), { mode: 0o600 });
                if (generation !== this._generation) return;
                await fs.rename(this._tmpPath, this._filePath);
            });
        return this._saveInFlight;
    }

    /**
     * Write the bounds before returning. Used on window close and app quit,
     * where the process can exit before an async write lands; the file is a
     * few dozen bytes, so blocking for it is cheap.
     *
     * @param {unknown} bounds
     */
    saveSync(bounds) {
        const normalized = normalizeWindowBounds(bounds);
        if (!normalized) return;
        this._generation += 1;
        mkdirSync(dirname(this._filePath), { recursive: true });
        writeFileSync(this._syncTmpPath, JSON.stringify(normalized), { mode: 0o600 });
        renameSync(this._syncTmpPath, this._filePath);
    }
}

/** @param {string} userDataDir */
export function windowBoundsPathFor(userDataDir) {
    if (typeof userDataDir !== 'string' || !userDataDir) {
        throw new Error('windowBoundsPathFor: userDataDir is required');
    }
    return join(userDataDir, 'window-bounds.json');
}
