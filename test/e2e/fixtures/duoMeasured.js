// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { duoViewports } from './duoViewports.js';
import { checkMeasuredWidths } from '../../../packages/mobile/scripts/duo-fixture.js';

export const DUO_MEASURED_PATH = fileURLToPath(new URL(
    '../../fixtures/duo/measured-widths.json',
    import.meta.url,
));

export function loadDuoViewports(path = DUO_MEASURED_PATH) {
    let text;
    try {
        text = readFileSync(path, 'utf8');
    } catch (error) {
        throw new Error(`${path}: ${error.message}`, { cause: error });
    }

    let measured;
    try {
        measured = JSON.parse(text);
    } catch (error) {
        throw new Error(`${path}: ${error.message}`, { cause: error });
    }

    const problems = checkMeasuredWidths(measured);
    if (problems.length > 0) {
        throw new Error(`${path}: ${problems.join('; ')}`);
    }

    const viewports = duoViewports(measured);
    if (viewports.length === 0) {
        throw new Error(`${path}: no reachable Duo viewport states`);
    }
    return viewports;
}
