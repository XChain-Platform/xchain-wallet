// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { linkHandoffModel } from './linkHandoffModel.js';

const ACTION_COPY = Object.freeze({
    send: 'This link fills in a payment for you to review.',
    receive: 'This link opens a receiving address.',
    execute: 'This link fills in a contract call for you to review.',
    request: 'This link asks you to review and approve a request from a site.',
    other: 'This link opens something in the wallet.',
});

export function LinkHandoff() {
    const model = linkHandoffModel(location.search);
    if (!model) return null;

    return (
        <main aria-labelledby="link-handoff-title">
            <section data-link-action={model.action}>
                <h1 id="link-handoff-title">Open in the wallet</h1>
                <p>
                    {ACTION_COPY[model.action]} It has not done anything yet, and it will not
                    until you open it and confirm.
                </p>
                <p aria-label="Wallet link"><code>{model.payload}</code></p>
                <nav aria-label="Choose where to open the wallet link">
                    <a href={model.appHref}>Open in the XChain Wallet app</a>
                    <a href={model.webHref}>Continue in the web wallet</a>
                    <a href={model.getHref}>Get the app</a>
                </nav>
                <p>
                    A link never unlocks, signs, sends or shares anything by itself; a request
                    link lands on the approval page, where the only ways forward are Approve,
                    with the password, and Reject, and the answer goes only to the site that
                    page names.
                </p>
            </section>
        </main>
    );
}
