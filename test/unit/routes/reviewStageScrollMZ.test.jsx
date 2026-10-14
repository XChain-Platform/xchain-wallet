// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Screen } from '../../../packages/core/src/ui/Screen.jsx';

const routesDir = resolve(process.cwd(), 'packages/core/src/shared/routes');
const standardExpression = "!(stage === 'review' || stage === 'submitting')";
const cases = [
    ['MintForm.jsx', standardExpression, ['review']],
    ['ParallelComposer.jsx', "stage !== 'review'", ['review']],
    ['PollDetail.jsx', standardExpression, ['review']],
    [
        'ProjectRosterForm.jsx',
        "stage !== 'review-list' && stage !== 'review-link'",
        ['review-list', 'review-link'],
    ],
    ['PublishFileForm.jsx', standardExpression, ['review']],
    ['SellOwnershipForm.jsx', standardExpression, ['review']],
    ['Send.jsx', standardExpression, ['review']],
    ['SleepForm.jsx', standardExpression, ['review']],
    ['StakeForm.jsx', standardExpression, ['review']],
    ['StakingActionForm.jsx', standardExpression, ['review']],
    ['SwapForm.jsx', standardExpression, ['review']],
    ['TokenAdminForm.jsx', standardExpression, ['review']],
    ['TokenWizard.jsx', "stage !== 'preview'", ['preview']],
];

function restoreScrollExpression(fileName) {
    const source = readFileSync(resolve(routesDir, fileName), 'utf8');
    const match = source.match(/restoreScroll=\{([\s\S]*?)\}/);
    return match?.[1].replace(/\s+/g, ' ').trim();
}

afterEach(cleanup);

describe('M through Z review stage scroll restoration', () => {
    it.each(cases)('%s scrolls each review stage body to the top', (
        fileName,
        expectedExpression,
        reviewStages,
    ) => {
        expect(restoreScrollExpression(fileName)).toBe(expectedExpression);

        for (const reviewStage of reviewStages) {
            const view = render(
                <Screen restoreScroll>Editable form</Screen>,
            );
            const body = screen.getByRole('main');
            body.scrollTop = 420;

            view.rerender(
                <Screen restoreScroll={!reviewStages.includes(reviewStage)}>Review</Screen>,
            );

            expect(body.scrollTop).toBe(0);
            view.unmount();
        }
    });
});
