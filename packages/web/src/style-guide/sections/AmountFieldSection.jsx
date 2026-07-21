// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useState } from 'react';
import { AmountField } from '@xchain-wallet/core/shared/components/AmountField.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

// Doc-page fiat stub: fixed BTC rate so the fiat line and the coin/fiat
// swap toggle render. In-app this comes from useFiatRate (priceLookup
// oracle + CoinGecko fallback); tokens without an oracle price pass
// `fiatRate={null}`, which hides the fiat affordances entirely.
const SAMPLE_FIAT_RATE = { fiatCurrency: 'USD', rate: 60000 };
const SAMPLE_BALANCE = '50';

export function AmountFieldSection() {
    // Seeded with a value so the fiat conversion + balance show real
    // figures at rest (an empty demo hides exactly the parts this section
    // documents). The fields are still fully interactive.
    const [amount, setAmount] = useState('0.5');
    const [fiatAmount, setFiatAmount] = useState('');
    const [amountInputMode, setAmountInputMode] = useState(/** @type {'coin' | 'fiat'} */ ('coin'));
    const [tokenAmount, setTokenAmount] = useState('1000');

    // Second demo, permanently in fiat-input mode, so the flipped state
    // (type USD, coin equivalent underneath) is visible without the
    // reviewer having to click the swap toggle.
    const [fiatModeCoin, setFiatModeCoin] = useState('0.5');
    const [fiatModeFiat, setFiatModeFiat] = useState('30000.00');
    const [fiatMode, setFiatMode] = useState(/** @type {'coin' | 'fiat'} */ ('fiat'));

    // Doc-page change handler: strip formatting commas, reject invalid
    // partial decimals, branch on the active input mode. Mirrors the
    // onAmountFieldChange handlers in Send / DispenserForm.
    const onCoinFieldChange = (rawValue) => {
        const stripped = String(rawValue).replace(/,/g, '');
        if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
        if (amountInputMode === 'fiat') {
            setFiatAmount(stripped);
            const n = parseFloat(stripped);
            setAmount(Number.isFinite(n) ? (n / SAMPLE_FIAT_RATE.rate).toFixed(8) : '');
        } else {
            setAmount(stripped);
        }
    };

    const toggleMode = () => {
        setAmountInputMode((prev) => {
            if (prev === 'coin') {
                const n = parseFloat(amount);
                setFiatAmount(Number.isFinite(n) ? (n * SAMPLE_FIAT_RATE.rate).toFixed(2) : '');
                return 'fiat';
            }
            setFiatAmount('');
            return 'coin';
        });
    };

    const onTokenFieldChange = (rawValue) => {
        const stripped = String(rawValue).replace(/,/g, '');
        if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
        setTokenAmount(stripped);
    };

    // Fiat-mode demo handlers: identical shape, its own state.
    const onFiatModeChange = (rawValue) => {
        const stripped = String(rawValue).replace(/,/g, '');
        if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
        if (fiatMode === 'fiat') {
            setFiatModeFiat(stripped);
            const n = parseFloat(stripped);
            setFiatModeCoin(Number.isFinite(n) ? (n / SAMPLE_FIAT_RATE.rate).toFixed(8) : '');
        } else {
            setFiatModeCoin(stripped);
        }
    };

    const toggleFiatMode = () => {
        setFiatMode((prev) => {
            if (prev === 'coin') {
                const n = parseFloat(fiatModeCoin);
                setFiatModeFiat(Number.isFinite(n) ? (n * SAMPLE_FIAT_RATE.rate).toFixed(2) : '');
                return 'fiat';
            }
            setFiatModeFiat('');
            return 'coin';
        });
    };

    return (
        <Section
            id="amount-field"
            title="Amount field"
            tag="CANONICAL amount entry"
            kicker="The amount-entry block from Send: input with inline Max button, coin/fiat swap toggle with the converted figure underneath, and an 'X available' balance line on the right. Used anywhere the user types a quantity of coin or tokens: Send, Receive, dispenser escrow, dispenser refill. Takes the shared size prop (md default, lg for hero screens)."
        >
            <Guidance
                what={<>A composed block around the shared <code>Input</code> primitive: an amount input at the given <code>size</code> (see Field sizes), an optional inline <b>Max</b> button on the right edge, and a footer row with the coin/fiat swap toggle + derived conversion (left) and caller-supplied balance text (right). The canonical <code>amount</code> is always coin-scale; in fiat mode the parent derives it via the price rate. Fiat affordances render only when a <code>fiatRate</code> is passed (native coins with an oracle price); token fields pass <code>null</code> and get a plain amount input.</>}
                when={<>Any field where the user enters an amount of coin or tokens they hold or expect: Send, Receive request amounts, dispenser escrow (Create dispenser), dispenser refill, and future amount-bearing forms. Always use this instead of a bare <code>Input</code> so Max, balance context, and fiat conversion behave identically everywhere.</>}
                whenNot={<>Rates and prices (fee rate, trigger price, fiat price) → default <code>Input</code>: they aren't balances, so Max and "available" are meaningless. Counts (number of fills) → default <code>Input</code>.</>}
                variants={<>
                    <code>size="md" | "lg"</code> (default md; Send/Receive pass lg). <code>label</code> (default "Amount"; the active unit is appended, e.g. "Escrow amount (PEPECREATURE)"). Omit <code>onMax</code> to hide the Max button. Omit <code>balanceText</code> when the balance is meaningless (Receive). <code>fiatRate={'{null}'}</code> hides the fiat toggle + conversion line. <code>maxDisabled</code> greys Max while the balance loads.
                </>}
                doRule={<>✓ Keep <code>amount</code> coin-scale and canonical · strip commas + validate partial decimals in the change handler (copy the Send handler) · pass balance text as "X.XX TICK available" · wire <code>onMax</code> to the real spendable balance</>}
                dontRule={<>✗ Build a bespoke amount input with its own Max button · show fiat for tokens with no oracle price · put units inside the typed value (the label + footer carry the units)</>}
                supersedes={<>Bare amount <code>Input</code>s in dispenser create/refill (replaced). Previously hard-locked to the big size; it now forwards the shared <code>size</code> prop and defaults to md. The component lives at <code>packages/core/src/shared/components/AmountField.jsx</code>.</>}
            />

            <Markup>
{`import { AmountField } from '@xchain-wallet/core/shared/components/AmountField.jsx';

<AmountField
    label="Amount"              // "Escrow amount", "Refill amount", ...
    amount={amount}             // canonical coin-scale string
    fiatAmount={fiatAmount}     // raw fiat text while in fiat mode
    tick="BTC"
    fiatRate={fiatRate}         // from useFiatRate; null hides fiat UI
    amountInputMode={mode}      // 'coin' | 'fiat'
    onAmountFieldChange={onAmountFieldChange}
    toggleAmountInputMode={toggleMode}
    onMax={() => setAmount(spendable)}   // omit to hide Max
    maxDisabled={!spendable}
    balanceText={\`\${spendable} BTC available\`}
/>`}
            </Markup>

            <LiveExample label="Send variant (coin input, lg): Max button, USD equivalent + swap toggle underneath, balance on the right. Click the ⇄ toggle to flip to USD entry; click Max to fill the balance.">
                <AmountField
                    size="lg"
                    amount={amount}
                    fiatAmount={fiatAmount}
                    tick="BTC"
                    fiatRate={SAMPLE_FIAT_RATE}
                    amountInputMode={amountInputMode}
                    onAmountFieldChange={onCoinFieldChange}
                    toggleAmountInputMode={toggleMode}
                    onMax={() => { setAmount(SAMPLE_BALANCE); setAmountInputMode('coin'); }}
                    balanceText={`${SAMPLE_BALANCE} BTC available`}
                />
            </LiveExample>

            <LiveExample label="Send variant (fiat input, flipped, lg): the same field with the toggle in USD mode. You type dollars; the coin equivalent shows underneath. The stored amount stays coin-scale.">
                <AmountField
                    size="lg"
                    amount={fiatModeCoin}
                    fiatAmount={fiatModeFiat}
                    tick="BTC"
                    fiatRate={SAMPLE_FIAT_RATE}
                    amountInputMode={fiatMode}
                    onAmountFieldChange={onFiatModeChange}
                    toggleAmountInputMode={toggleFiatMode}
                    onMax={() => { setFiatModeCoin(SAMPLE_BALANCE); setFiatMode('coin'); }}
                    balanceText={`${SAMPLE_BALANCE} BTC available`}
                />
            </LiveExample>

            <LiveExample label="Token variant (dispenser escrow / refill, md default): custom label, no fiat rate (no swap toggle, no USD line), Max + balance only. This is the compact size that matches a form's other inputs.">
                <AmountField
                    label="Escrow amount"
                    amount={tokenAmount}
                    tick="PEPECREATURE"
                    onAmountFieldChange={onTokenFieldChange}
                    onMax={() => setTokenAmount('1000')}
                    balanceText="1,000 PEPECREATURE available"
                />
            </LiveExample>
        </Section>
    );
}
