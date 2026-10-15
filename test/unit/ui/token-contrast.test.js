// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'packages/core/src/ui/tokens.css'), 'utf8');

function declarationsFor(pattern) {
    const body = pattern.exec(css)?.[1];
    if (!body) throw new Error(`Missing token block: ${pattern.source}`);
    return Object.fromEntries(
        [...body.matchAll(/(--xc-[\w-]+):\s*([^;]+);/g)]
            .map(([, name, value]) => [name, value.trim()]),
    );
}

const light = declarationsFor(/^:root\s*\{([\s\S]*?)^\}/m);
const dark = {
    ...light,
    ...declarationsFor(/^:root\[data-xc-theme="dark"\]\s*\{([\s\S]*?)^\}/m),
};

function resolveToken(tokens, name, seen = new Set()) {
    if (seen.has(name)) throw new Error(`Circular color token: ${name}`);
    const value = tokens[name];
    if (!value) throw new Error(`Missing color token: ${name}`);
    const reference = /^var\((--xc-[\w-]+)\)$/.exec(value);
    return reference ? resolveToken(tokens, reference[1], new Set([...seen, name])) : value;
}

function color(value) {
    const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
    if (hex) return [...hex.slice(1).map((part) => Number.parseInt(part, 16)), 1];

    const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(value);
    if (!rgba) throw new Error(`Unsupported CSS color: ${value}`);
    return [
        Number(rgba[1]),
        Number(rgba[2]),
        Number(rgba[3]),
        rgba[4] === undefined ? 1 : Number(rgba[4]),
    ];
}

function composite(foreground, background) {
    const fg = color(foreground);
    const bg = color(background);
    return fg.slice(0, 3).map((channel, index) => (
        channel * fg[3] + bg[index] * (1 - fg[3])
    ));
}

function luminance(value) {
    const channels = typeof value === 'string' ? color(value).slice(0, 3) : value;
    return channels
        .map((channel) => channel / 255)
        .map((channel) => (
            channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        ))
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(first, second) {
    const values = [luminance(first), luminance(second)];
    return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

const BODY_TEXT_MINIMUM = 4.5;
const LARGE_TEXT_AND_CONTROL_MINIMUM = 3;
const SURFACES = ['--xc-bg', '--xc-bg-muted', '--xc-surface', '--xc-surface-raised'];

function solidPair(role, foreground, background, minimum) {
    return { role, foreground, background, minimum };
}

function tintedPair(role, foreground, background, underlay, minimum) {
    return { role, foreground, background, underlay, minimum };
}

function usedPairs() {
    const pairs = [];
    for (const surface of SURFACES) {
        pairs.push(
            solidPair('body text', '--xc-text', surface, BODY_TEXT_MINIMUM),
            solidPair('muted body text', '--xc-text-muted', surface, BODY_TEXT_MINIMUM),
            solidPair('link text', '--xc-accent-text', surface, BODY_TEXT_MINIMUM),
            solidPair('danger text', '--xc-danger-fg', surface, BODY_TEXT_MINIMUM),
            solidPair('large text', '--xc-text', surface, LARGE_TEXT_AND_CONTROL_MINIMUM),
            solidPair('control border', '--xc-border', surface, LARGE_TEXT_AND_CONTROL_MINIMUM),
            solidPair('strong control border', '--xc-border-strong', surface, LARGE_TEXT_AND_CONTROL_MINIMUM),
        );
    }

    pairs.push(
        solidPair('primary button label', '--xc-on-accent', '--xc-accent-primary', BODY_TEXT_MINIMUM),
        solidPair('hovered primary button label', '--xc-on-accent', '--xc-accent-primary-hover', BODY_TEXT_MINIMUM),
        solidPair('neutral banner text', '--xc-text', '--xc-bg-muted', BODY_TEXT_MINIMUM),
        solidPair('error banner text', '--xc-on-danger', '--xc-danger', BODY_TEXT_MINIMUM),
    );

    const bannerTokens = [
        ['danger banner text', '--xc-danger-text', '--xc-danger-bg'],
        ['info banner text', '--xc-info-text', '--xc-info-bg'],
        ['warning banner text', '--xc-warning-text', '--xc-warning-bg'],
        ['success banner text', '--xc-success', '--xc-success-bg'],
    ];
    for (const [role, foreground, background] of bannerTokens) {
        for (const surface of SURFACES) {
            pairs.push(tintedPair(
                role,
                foreground,
                background,
                surface,
                BODY_TEXT_MINIMUM,
            ));
        }
    }
    return pairs;
}

function measurement(theme, tokens, pair) {
    const foreground = resolveToken(tokens, pair.foreground);
    const fill = resolveToken(tokens, pair.background);
    const background = pair.underlay
        ? composite(fill, resolveToken(tokens, pair.underlay))
        : fill;
    const placement = pair.underlay
        ? `${pair.foreground} on ${pair.background} over ${pair.underlay}`
        : `${pair.foreground} on ${pair.background}`;
    return {
        id: `${theme}: ${pair.role}: ${placement}`,
        minimum: pair.minimum,
        ratio: contrast(foreground, background),
    };
}

// Each baseline entry has a stable measurement id and a one-line reason. The
// list starts empty because every audited pairing currently clears WCAG AA.
const FAILURE_BASELINE = [];

describe('light and dark color-token contrast', () => {
    const measurements = Object.entries({ light, dark }).flatMap(([theme, tokens]) => (
        usedPairs().map((pair) => measurement(theme, tokens, pair))
    ));

    it('keeps baseline notes useful and tied to an audited pair', () => {
        const measurementIds = new Set(measurements.map(({ id }) => id));
        const baselineIds = FAILURE_BASELINE.map(({ id }) => id);

        expect(new Set(baselineIds).size).toBe(baselineIds.length);
        for (const { id, note } of FAILURE_BASELINE) {
            expect(measurementIds.has(id), id).toBe(true);
            expect(note.trim().length, id).toBeGreaterThan(0);
            expect(note, id).not.toMatch(/[\r\n]/);
        }
    });

    it('adds no failures beyond the shrinking baseline', () => {
        const baselineIds = new Set(FAILURE_BASELINE.map(({ id }) => id));
        const failures = measurements.filter(({ ratio, minimum }) => ratio < minimum);
        const unexpected = failures
            .filter(({ id }) => !baselineIds.has(id))
            .map(({ id, ratio, minimum }) => `${id} is ${ratio.toFixed(2)}:1, needs ${minimum}:1`);

        expect(unexpected).toEqual([]);
        expect(failures.length).toBeLessThanOrEqual(FAILURE_BASELINE.length);
    });
});
