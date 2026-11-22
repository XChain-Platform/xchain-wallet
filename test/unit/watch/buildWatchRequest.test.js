// @vitest-environment node
// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    newWatchRequestId,
    watchRequestFrom,
} from '../../../packages/core/src/watch/buildWatchRequest.js';
import { checkFixtureFile } from '../../helpers/watchFixtureFile.js';

const models = JSON.parse(readFileSync(
    'test/fixtures/watch/inputs/confirm-models.json',
    'utf8',
));

describe('build watch request fixtures', () => {
    it.each(Object.entries(models))('rebuilds %s byte-identically', (name, model) => {
        const request = watchRequestFrom(model, {
            newId: () => newWatchRequestId((bytes) => bytes.set(model.randomBytes)),
        });

        const { status } = checkFixtureFile(`test/fixtures/watch/${name}.json`, request);
        const allowed = process.env.WATCH_FIXTURES_WRITE === '1'
            ? ['same', 'created', 'reformatted']
            : ['same'];

        expect(allowed).toContain(status);
    });
});
