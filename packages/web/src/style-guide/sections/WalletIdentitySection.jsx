// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { TileLookFields, TILE_COLOURS } from '@xchain-wallet/core/shared/components/TileLookFields.jsx';
import { WalletIdentity } from '@xchain-wallet/core/shared/components/WalletIdentity.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import { SharedComponentExampleProvider } from './sharedComponentExamples.jsx';

const EXAMPLE_WALLET = Object.freeze({ id: 'wallet-example', name: 'Everyday wallet' });
const SECOND_WALLET = Object.freeze({ id: 'wallet-savings', name: 'Savings' });

export function WalletIdentitySection() {
    const [colour, setColour] = useState(TILE_COLOURS[1]);
    const [shape, setShape] = useState('circle');
    const [image, setImage] = useState(null);
    return (
        <Section
            id="wallet-identity"
            title="Wallet identity"
            tag="CANONICAL · WalletIdentity / TileLookFields"
            kicker="A wallet's avatar and name, in the colour and shape the user chose, with initials so it never relies on colour alone."
        >
            <Guidance
                what={<><code>WalletIdentity</code> shows the tile (colour, shape, image or initials) beside the name, in a <code>header</code>, <code>list</code> or <code>hero</code> context. <code>ContactAvatar</code> is a contact's identity tile in the same header, list or hero context. <code>TileLookFields</code> is the colour, shape and image editor shared by Rename Wallet and Edit Account.</>}
                when={<>Wherever a wallet is named: the app header, the wallet list, a wallet detail hero.</>}
                whenNot={<>An account or address (use an AssetMark or the address text).</>}
                doRule={<>✓ Use it for every wallet name so a change of tile shows everywhere</>}
                dontRule={<>✗ Draw your own initials circle</>}
                supersedes={<>Source: <code>WalletIdentity.jsx</code>, <code>TileLookFields.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<WalletIdentity wallet={{ id, name }} context="list" />
<WalletIdentity wallet={wallet} namePrefix="Wallet: " />
<TileLookFields kind="wallet" colour={c} onColour={setC} shape={s} onShape={setS} image={img} onImage={setImg} />`}
            </Markup>
            <LiveExample label="Header, list and labelled identities">
                <div style={{ display: 'grid', gap: 'var(--xc-space-3)' }}>
                    <WalletIdentity wallet={EXAMPLE_WALLET} context="header" namePrefix="" />
                    <WalletIdentity wallet={SECOND_WALLET} context="list" />
                    <WalletIdentity wallet={EXAMPLE_WALLET} context="list" label="Active" />
                </div>
            </LiveExample>
            <LiveExample label="TileLookFields">
                <SharedComponentExampleProvider>
                    <TileLookFields
                        kind="wallet"
                        colour={colour}
                        onColour={setColour}
                        shape={shape}
                        onShape={setShape}
                        image={image}
                        onImage={setImage}
                    />
                </SharedComponentExampleProvider>
            </LiveExample>
        </Section>
    );
}
