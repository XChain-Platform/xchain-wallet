// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { OwnAddressPickerScreen } from '@xchain-wallet/core/shared/components/OwnAddressPickerScreen.jsx';
import { ListPickerScreen } from '@xchain-wallet/core/shared/components/ListPickerScreen.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import {
    PartsExampleProvider,
    PART_ACCOUNT_ID,
    PART_ADDRESS,
    PART_CHAIN_ID,
    PART_WALLET_ID,
} from './partsExamples.jsx';

const noop = () => {};

export function PickerScreensSection() {
    return (
        <Section
            id="picker-screens"
            title="Picker screens"
            tag="CANONICAL · OwnAddressPickerScreen / ListPickerScreen"
            kicker="The full-screen choosers a form opens to fill one field: one of the wallet's own addresses, or one of the token lists an address has published."
        >
            <Guidance
                what={<><code>OwnAddressPickerScreen</code> is the address list in picker mode, filtered to one chain; picking a row returns it and closes. <code>ListPickerScreen</code> loads the lists published from the chosen addresses, narrows them by type, and supports search.</>}
                when={<>A form field that needs one of the wallet's own addresses, or a list reference, and has no room for a dropdown.</>}
                whenNot={<>Choosing among a handful of fixed options (Select or SegmentedControl) · choosing a contact (the contacts picker).</>}
                doRule={<>✓ Return the choice through <code>onSelect</code> / <code>onPick</code> and restore the form's state on Back</>}
                dontRule={<>✗ Embed the chooser inside the form's own scroll area</>}
                supersedes={<>Source: <code>OwnAddressPickerScreen.jsx</code>, <code>ListPickerScreen.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<OwnAddressPickerScreen walletId={walletId} accountId={accountId} chainId={chainId} onChainChange={setChainId} onPick={pick} onBack={back} />
<ListPickerScreen variant="small" messaging={messaging} chainId={chainId} addresses={addresses} filterType={1} onSelect={pick} onBack={back} />`}
            </Markup>
            <LiveExample label="OwnAddressPickerScreen" minHeight={420} padded={false}>
                <PartsExampleProvider>
                    <OwnAddressPickerScreen
                        walletId={PART_WALLET_ID}
                        accountId={PART_ACCOUNT_ID}
                        chainId={PART_CHAIN_ID}
                        onChainChange={noop}
                        onPick={noop}
                        onBack={noop}
                    />
                </PartsExampleProvider>
            </LiveExample>
            <LiveExample label="ListPickerScreen: no lists published yet" minHeight={320} padded={false}>
                <PartsExampleProvider>
                    <ListPickerScreen
                        variant="small"
                        messaging={{ getListsForSource: async () => ({ lists: [] }) }}
                        chainId={PART_CHAIN_ID}
                        addresses={[{ address: PART_ADDRESS }]}
                        filterType={1}
                        onSelect={noop}
                        onBack={noop}
                    />
                </PartsExampleProvider>
            </LiveExample>
        </Section>
    );
}
