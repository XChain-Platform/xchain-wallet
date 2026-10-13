// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AnimatedQrFrames, QrScanner } from '@xchain-wallet/core/ui';
import { Guidance, LiveExample, Markup, Section } from '../StyleGuidePage.jsx';

const SAMPLE_FRAMES = [
    'xcw:1/3:eyJ0eXBlIjoicHNidCIsImRhdGEiOiJleGFtcGxlLTEifQ',
    'xcw:2/3:eyJ0eXBlIjoicHNidCIsImRhdGEiOiJleGFtcGxlLTIifQ',
    'xcw:3/3:eyJ0eXBlIjoicHNidCIsImRhdGEiOiJleGFtcGxlLTMifQ',
];

export function AnimatedQrFramesSection() {
    return (
        <Section
            id="animated-qr-frames"
            title="Animated QR frames"
            tag="PRIMITIVE"
            kicker="A sequence of QR images for moving a chunked signing payload between offline devices."
        >
            <Guidance
                what={<>A QR renderer that advances through encoded string frames and exposes the current frame count.</>}
                when={<>Use for chunked PSBT, multisig signing, and partner-pairing payloads that do not fit one QR code.</>}
                whenNot={<>Use the route's normal static QR renderer for a single address or URI.</>}
                sizing={<>Choose a pixel size that fits the narrowest supported frame. The default is 240px.</>}
                variants={<>Frame rate, pixel size, and accessible label. Reduced motion replaces automatic animation with Prev and Next controls.</>}
                doRule={<>Pass already encoded frames in order and preserve the frame counter.</>}
                dontRule={<>Do not animate decorative QR placeholders or rebuild the timer in route code.</>}
            />
            <Markup>
{`import { AnimatedQrFrames } from '@xchain-wallet/core/ui';

<AnimatedQrFrames
    frames={encodedChunks}
    fps={3}
    size={240}
    alt="Unsigned transaction QR"
/>`}
            </Markup>
            <LiveExample label="Three sample transport frames at 3 fps.">
                <AnimatedQrFrames
                    frames={SAMPLE_FRAMES}
                    fps={3}
                    size={180}
                    alt="Sample signing payload"
                />
            </LiveExample>
        </Section>
    );
}

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
