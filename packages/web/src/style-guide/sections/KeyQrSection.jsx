// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { KeyQR } from '@xchain-wallet/core/shared/components/KeyQR.jsx';
import { Guidance, LiveExample, Markup, Section } from '../StyleGuidePage.jsx';

// A public sample value only: never a real key, seed or address of anyone's.
const SAMPLE_QR_VALUE = 'bcrt1qexampleexampleexampleexampleexample0';

export function KeyQrSection() {
    return (
        <Section
            id="key-qr"
            title="Static QR code"
            tag="SHARED · KeyQR"
            kicker="One QR code for a single short value: an address, a public key or a sharing payload."
        >
            <Guidance
                what={<><code>KeyQR</code> encodes one string as a black-on-white QR image, framed by default or bare inside a card that already frames it.</>}
                when={<>Receive, Address detail, a co-signer's funding address and the multisig cosigner share: one value that fits one code.</>}
                whenNot={<>A payload too large for one code; use <code>AnimatedQrFrames</code>.</>}
                sizing={<>200px by default; pass a pixel size that fits the narrowest frame it shows in.</>}
                variants={<>Framed (default) and bare.</>}
                doRule={<>Give it an accessible label naming what the code holds.</>}
                dontRule={<>Do not encode a private key or recovery phrase outside the reveal screens that guard them.</>}
            />
            <Markup>
{`import { KeyQR } from '@xchain-wallet/core/shared/components/KeyQR.jsx';

<KeyQR value={address} size={200} alt="Receive address QR" />`}
            </Markup>
            <LiveExample label="Framed, then bare, for a sample address.">
                <KeyQR value={SAMPLE_QR_VALUE} size={160} alt="Sample address QR" />
                <KeyQR value={SAMPLE_QR_VALUE} size={160} alt="Sample address QR, bare" bare />
            </LiveExample>
        </Section>
    );
}
