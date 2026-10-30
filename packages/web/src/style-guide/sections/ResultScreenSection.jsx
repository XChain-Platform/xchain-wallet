// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ResultScreen } from '@xchain-wallet/core/shared/components/ResultScreen.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const noop = () => {};

export function ResultScreenSection() {
    return (
        <Section
            id="result-screen"
            title="Result screen"
            tag="TEMPLATE PART · ResultScreen"
            kicker="The one screen a form shows after its submit finishes. A StatusMessage is always the first content, details sit under it, and one action row closes the screen. Every form uses it, so a queued action and a broadcast action read the same."
        >
            <Guidance
                what={<>Props: <code>state</code> (<code>success</code>, <code>failure</code>, <code>pending</code>, <code>signed-not-broadcast</code> or <code>unsigned</code>), <code>title</code> (bold lead-in of the notice), <code>message</code>, children for details, <code>onDone</code> and <code>doneLabel</code> for the primary button, <code>secondaryLabel</code> + <code>onSecondary</code> for the one secondary button. <code>signed-not-broadcast</code> also takes <code>what</code> and <code>unsaved</code>; <code>unsigned</code> takes <code>result</code> (the PSBT envelope) and <code>onBuildAnother</code>.</>}
                when={<>A form finished submitting: it went through, failed, is still under way, was signed but queued, or produced an unsigned transaction for another device.</>}
                whenNot={<>A problem the user can fix before submitting (FormErrorSummary or a field note) · a toast for something the user has already left behind.</>}
                sizing={<>The notice takes the full content width of the page template. The action row sits at the end of the line, wraps under it, and stacks full width at 360px.</>}
                variants={<>success is green, failure is red, pending and unsigned are blue, signed-not-broadcast is amber. The tone and the live-region role come from StatusMessage.</>}
                doRule={<>✓ Notice first, details second, actions last · one primary button, Done, at the end · say what happened in the notice, not in a heading of the screen</>}
                dontRule={<>✗ A bordered card of the screen's own · an emoji in place of the notice icon · a "do it again" button on signed-not-broadcast (re-signing while a signed copy is queued double-broadcasts)</>}
                supersedes={<><code>QueuedResultPanel</code> and <code>WatcherResultPanel</code> (two unrelated looks for the same moment).</>}
            />
            <Markup>
{`import { ResultScreen } from '../components/ResultScreen.jsx';

if (result?.psbtHex && !txid) {
    return <ResultScreen state="unsigned" result={result} onBuildAnother={again} onDone={onBack} />;
}
if (result?.queued) {
    return <ResultScreen state="signed-not-broadcast" what="mint" onDone={onBack} />;
}
return (
    <ResultScreen state="success" title="Minted" message="Transaction sent." onDone={onBack}>
        <code>{txid}</code>
    </ResultScreen>
);`}
            </Markup>
            <LiveExample label="success">
                <ResultScreen state="success" title="Minted" message="Your transaction was broadcast." onDone={noop}>
                    <code>9f2c4a7e1b0d8c3a5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d</code>
                </ResultScreen>
            </LiveExample>
            <LiveExample label="failure">
                <ResultScreen
                    state="failure"
                    title="Not sent"
                    message="The network refused the transaction."
                    onDone={noop}
                    secondaryLabel="Try again"
                    onSecondary={noop}
                />
            </LiveExample>
            <LiveExample label="pending">
                <ResultScreen state="pending" title="Waiting" message="Waiting for the first confirmation." onDone={noop} />
            </LiveExample>
            <LiveExample label="signed-not-broadcast">
                <ResultScreen state="signed-not-broadcast" what="mint" onDone={noop} unsaved={false} />
            </LiveExample>
            <LiveExample label="signed-not-broadcast, signed bytes not saved">
                <ResultScreen state="signed-not-broadcast" what="mint" onDone={noop} unsaved />
            </LiveExample>
            <LiveExample label="unsigned (watcher wallet)">
                <ResultScreen
                    state="unsigned"
                    result={{ psbtHex: '70736274ff01007102000000010000000000000000000000000000000000000000000000000000000000000000ffffffff', encoding: 'PSBT' }}
                    onBuildAnother={noop}
                    onDone={noop}
                />
            </LiveExample>
        </Section>
    );
}
