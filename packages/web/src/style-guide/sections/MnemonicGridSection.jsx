// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MnemonicGrid } from '@xchain-wallet/core/shared/components/MnemonicGrid.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import { SharedComponentExampleProvider } from './sharedComponentExamples.jsx';

// The public all-zero test phrase: it protects nothing, so the guide may show it.
const DEMO_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

export function MnemonicGridSection() {
    return (
        <Section
            id="mnemonic-grid"
            title="Mnemonic grid"
            tag="CANONICAL · MnemonicGrid"
            kicker="The recovery phrase as numbered words, concealed until the user reveals it."
        >
            <Guidance
                what={<><code>MnemonicGrid</code> shows the words in a 2-column (<code>small</code>) or responsive 2/4-column (<code>full</code>) grid. It holds the screen guard while mounted and offers no copy button, because clipboard history can keep a phrase.</>}
                when={<>Showing or confirming a recovery phrase.</>}
                whenNot={<>Entering a phrase (the import form's inputs).</>}
                doRule={<>✓ Pair it with a danger Notice (<code>role="note"</code>) outside any card</>}
                dontRule={<>✗ Add a copy button · log or store the phrase</>}
                supersedes={<>Source: <code>MnemonicGrid.jsx</code> in <code>shared/components</code>. The example uses the public all-zero test phrase.</>}
            />
            <Markup>
{`<MnemonicGrid mnemonic={phrase} variant="small" />`}
            </Markup>
            <LiveExample label="Concealed, then revealed">
                <SharedComponentExampleProvider>
                    <MnemonicGrid mnemonic={DEMO_MNEMONIC} variant="small" />
                    <MnemonicGrid mnemonic={DEMO_MNEMONIC} variant="small" startRevealed />
                </SharedComponentExampleProvider>
            </LiveExample>
        </Section>
    );
}
