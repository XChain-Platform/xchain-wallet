// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { QrScanner } from '@xchain-wallet/core/ui';
import { Guidance, LiveExample, Markup, Section } from '../StyleGuidePage.jsx';

export function QrScannerSection() {
    return (
        <Section
            id="qr-scanner"
            title="QR scanner"
            tag="PRIMITIVE"
            kicker="The camera scanner surface and its actionable fallback states for browser and native shells."
        >
            <Guidance
                what={<>A shell-aware QR scanner that emits each decoded string, closes camera resources on unmount, and explains unavailable or refused camera access in plain words.</>}
                when={<>Use wherever the wallet imports a QR address, URI, signing payload, or pairing code.</>}
                whenNot={<>Keep a text paste path beside it. Camera access must never be the only way to enter a payload.</>}
                sizing={<>The video defaults to 320px wide and contracts to the available frame width.</>}
                variants={<>Browser camera, native full-screen scanner, unsupported browser, and permission-denied states.</>}
                doRule={<>Handle every emitted frame because animated payload collectors deduplicate chunks themselves.</>}
                dontRule={<>Do not expose raw permission exceptions or open a native camera before a deliberate tap.</>}
            />
            <Markup>
{`import { QrScanner } from '@xchain-wallet/core/ui';

<QrScanner
    onFrame={(text) => collector.add(text)}
    alt="Scan signed transaction"
/>`}
            </Markup>
            <LiveExample label="Unsupported: explains the compatible browser and paste path.">
                <QrScanner
                    previewState="unsupported"
                    onFrame={() => {}}
                    alt="Signing payload scanner"
                />
            </LiveExample>
            <LiveExample label="Permission denied: points to device settings and keeps paste available.">
                <QrScanner
                    previewState="denied"
                    onFrame={() => {}}
                    alt="Signing payload scanner"
                />
            </LiveExample>
        </Section>
    );
}
