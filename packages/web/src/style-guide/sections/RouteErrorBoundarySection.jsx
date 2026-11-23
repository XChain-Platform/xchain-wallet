// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Button, Icon } from '@xchain-wallet/core/ui';
import { RouteErrorBoundary } from '@xchain-wallet/core/shared/components/RouteErrorBoundary.jsx';
import { BodyParagraph } from '@xchain-wallet/core/shared/components/WarningCard.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import { SharedComponentExampleProvider } from './sharedComponentExamples.jsx';

function Failing({ fail }) {
    if (fail) throw new Error('Example route failure');
    return <BodyParagraph>This route rendered normally.</BodyParagraph>;
}

export function RouteErrorBoundarySection() {
    const [fail, setFail] = useState(false);
    return (
        <Section
            id="route-error-boundary"
            title="Route error boundary"
            tag="CANONICAL · RouteErrorBoundary"
            kicker="What a failed route shows instead of a blank screen: a plain message with Try again and Home, with the session left unlocked."
        >
            <Guidance
                what={<><code>RouteErrorBoundary</code> catches a render failure in the route below it. Home changes only shell navigation, so providers and the unlocked session stay mounted; without shell navigation it reloads the entry point. When the failing route is Home, only Try again is offered. A new <code>resetKey</code> clears the failure.</>}
                when={<>Around the routed content of every shell.</>}
                whenNot={<>Expected errors (a refused request, a missing file): those are a form notice or a StatusMessage.</>}
                doRule={<>✓ Pass <code>resetKey</code> so moving to another route clears it</>}
                dontRule={<>✗ Wrap a single field · show the error text to the user</>}
                supersedes={<>Source: <code>RouteErrorBoundary.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<RouteErrorBoundary resetKey={route} onHome={goHome} atHome={route === 'home'}>
    {routeElement}
</RouteErrorBoundary>`}
            </Markup>
            <LiveExample label="A route that renders, then one that fails" minHeight={260}>
                <SharedComponentExampleProvider>
                    <RouteErrorBoundary resetKey={fail ? 'failed' : 'ok'} onHome={() => setFail(false)} onReload={() => setFail(false)}>
                        <Failing fail={fail} />
                    </RouteErrorBoundary>
                    {fail ? null : (
                        <Button variant="secondary" icon={<Icon.InfoIcon />} onClick={() => setFail(true)}>
                            Show a Failed Route
                        </Button>
                    )}
                </SharedComponentExampleProvider>
            </LiveExample>
        </Section>
    );
}
