// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// U63 on result screens: Done closes a finished transaction, so it is the
// screen's main action and draws as the green success button with its icon,
// in the shared ResultScreen and on every route's own result panel.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel) => readFileSync(resolve(process.cwd(), 'packages/core/src/shared', rel), 'utf8');

const DONE_LABEL = String.raw`(?:Done|\{t\('common\.done'\)\})`;

/** Attribute text of every <Button> whose children are only the Done label. */
function doneButtons(source) {
    const re = new RegExp(String.raw`<Button\b((?:(?!<Button\b|</Button>)[\s\S])*?)>\s*${DONE_LABEL}\s*</Button>`, 'g');
    return [...source.matchAll(re)].map((m) => m[1]);
}

const ROUTES = [
    'BroadcastForm', 'CoinpayForm', 'ComposeMessage', 'ContractFundsForm', 'CreateOrderForm',
    'CrossChainOrderForm', 'CrossChainSwapForm', 'DeployContractForm', 'DispenserForm',
    // The order and swap Cancel and Edit results moved with their form to
    // the shared Form Standard frame, TradeOwnerActionForm.
    'ExecuteContractForm', 'ListCreateForm', 'TradeOwnerActionForm', 'OracleForm',
    'PublishFileForm', 'StakingForm', 'SwapForm',
];

describe('result screen Done is the green main action (U63)', () => {
    it('ResultScreen draws Done as the success button with the check icon', () => {
        const src = read('components/ResultScreen.jsx');
        const row = src.slice(src.indexOf('function ActionRow'), src.indexOf('function SignedNotBroadcastScreen'));
        expect(row).toMatch(/<Button variant="success" icon=\{<Icon\.CheckIcon \/>\} onClick=\{onDone\}>\{doneLabel\}<\/Button>/);
        expect(row).not.toMatch(/variant="primary"/);
    });

    it.each(ROUTES)('%s draws each Done green with an icon', (name) => {
        const buttons = doneButtons(read(`routes/${name}.jsx`));
        expect(buttons.length, `${name}: no Done button found`).toBeGreaterThan(0);
        for (const attrs of buttons) {
            expect(attrs, name).toMatch(/variant="success"/);
            expect(attrs, name).toMatch(/icon=\{/);
        }
    });
});
