// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { measureRulings } from '../../e2e/layout/sweep.js';

describe('UI rulings meter', () => {
    it('keeps StatusMessage notices out of the U16 card checks', () => {
        document.body.innerHTML = `
            <main>
                <div data-variant="warning" class="StatusMessage_row StatusMessage_warning"
                    style="border: 2px solid rgb(180, 120, 0); border-radius: 6px; opacity: 1">
                    Static demo notice
                    <span style="border: 1px dashed rgb(180, 120, 0); opacity: 1">Notice detail</span>
                </div>
                <div role="status"
                    style="border: 2px solid rgb(0, 90, 180); border-radius: 6px; opacity: 1">Status notice</div>
                <div role="alert"
                    style="border: 2px solid rgb(180, 0, 0); border-radius: 6px; opacity: 1">Alert notice</div>
                <div id="off-token-card"
                    style="border: 2px solid rgb(0, 0, 0); border-radius: 9px; opacity: 1">Plain content</div>
            </main>
        `;
        const box = { left: 0, top: 0, width: 180, height: 60, right: 180, bottom: 60 };
        for (const element of document.querySelectorAll('body *')) {
            element.getBoundingClientRect = () => box;
        }

        const measured = measureRulings();

        expect(measured.offTokenCards).toEqual([
            expect.objectContaining({ el: 'div "Plain content"' }),
        ]);
        expect(measured.dashedBorders).toBeUndefined();
    });
});
