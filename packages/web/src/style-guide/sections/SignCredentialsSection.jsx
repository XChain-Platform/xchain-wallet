// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { SignCredentials } from '@xchain-wallet/core/shared/components/SignCredentials.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import { PartsExampleProvider, PART_ADDRESS, PART_CHAIN_ID } from './partsExamples.jsx';

const noop = () => {};

export function SignCredentialsSection() {
    const [password, setPassword] = useState('');
    return (
        <Section
            id="sign-credentials"
            title="Sign credentials"
            tag="CANONICAL · SignCredentials"
            kicker="The credentials half of a signing form: a note when the wallet is already unlocked, the password field when it is not, and the device block for a hardware wallet."
        >
            <Guidance
                what={<><code>&lt;SignCredentials fromAddress chainId password onPasswordChange unlocked /&gt;</code>. A software address with an unlocked session shows a short note; a locked one shows the password field; a Trezor or Ledger address shows the device status block.</>}
                when={<>Inside a form that signs without the shared review screen.</>}
                whenNot={<>Forms that already end on the action review screen; it renders this itself.</>}
                doRule={<>✓ Pass the whole address record so the hardware branch can read its signer</>}
                dontRule={<>✗ Draw a bare password input for signing</>}
                supersedes={<>Per-form password fields. Source: <code>packages/core/src/shared/components/SignCredentials.jsx</code>.</>}
            />
            <Markup>
{`<SignCredentials
    fromAddress={fromAddress}
    chainId={chainId}
    password={password}
    onPasswordChange={setPassword}
    unlocked={false}
/>`}
            </Markup>
            <LiveExample label="Locked software wallet: password field">
                <PartsExampleProvider>
                    <SignCredentials
                        fromAddress={{ address: PART_ADDRESS, source: 'software' }}
                        chainId={PART_CHAIN_ID}
                        password={password}
                        onPasswordChange={setPassword}
                        unlocked={false}
                    />
                </PartsExampleProvider>
            </LiveExample>
            <LiveExample label="Unlocked session: note only">
                <PartsExampleProvider>
                    <SignCredentials
                        fromAddress={{ address: PART_ADDRESS, source: 'software' }}
                        chainId={PART_CHAIN_ID}
                        password=""
                        onPasswordChange={noop}
                        unlocked
                    />
                </PartsExampleProvider>
            </LiveExample>
        </Section>
    );
}
