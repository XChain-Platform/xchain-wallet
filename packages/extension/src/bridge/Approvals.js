// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Approvals interface — §43.4 request-approval flow.
//
// Bridge handlers consult `ConnectedSite.permissions` first; anything
// that isn't already permitted (`canSignAction[KIND] === 'always'`,
// `canSignMessage === true`) must route through the user's approval
// popup before proceeding. The background doesn't open popups itself
// — shells inject an `Approvals` implementation that knows how to
// prompt the user (open chrome.action popup, window.open for desktop,
// etc.).
//
// The default `rejectAll` implementation refuses everything with
// `USER_APPROVAL_REQUIRED` — callers who haven't wired the popup get
// a structured error they can bubble up to the dApp.
//
// The shell's real implementation should:
//   1. Open an approval popup pre-populated with origin + request
//   2. Await the user's decision
//   3. Return `{ approved: true, … }` with any "save permission" flag
//   4. On reject, return `{ approved: false }` — the bridge surfaces
//      this to the dApp as `USER_REJECTED`.

/**
 * @typedef {Object} ConnectApprovalRequest
 * @property {string} origin
 * @property {string} appName
 * @property {string} [appIcon]
 * @property {string[]} [requestedChains]
 * @property {string[]} [requestedAccounts]
 */

/**
 * @typedef {Object} ConnectApprovalResult
 * @property {boolean} approved
 * @property {string[]} [chains]
 * @property {string[]} [accounts]
 * @property {Record<string, 'always' | 'ask' | 'never'>} [canSignAction]
 * @property {boolean} [canSignMessage]
 */

/**
 * @typedef {Object} SignApprovalRequest
 * @property {string} origin
 * @property {'signAction' | 'signMessage' | 'signPsbt' | 'signIn'} kind
 * @property {string} [chainId]
 * @property {string} [action]
 * @property {unknown} [payload]
 */

/**
 * @typedef {Object} SignApprovalResult
 * @property {boolean} approved
 * @property {boolean} [savePermanent]        for signAction: check "always allow"
 * @property {string} [address]               for signIn: user-chosen address
 * @property {string} [walletId]              for flows that need to pick a wallet
 * @property {string} [password]              popup captures password entry
 * @property {string} [bip39Passphrase]
 */

/**
 * @typedef {Object} Approvals
 * @property {(req: ConnectApprovalRequest) => Promise<ConnectApprovalResult>} connect
 * @property {(req: SignApprovalRequest) => Promise<SignApprovalResult>} signAction
 * @property {(req: SignApprovalRequest) => Promise<SignApprovalResult>} signMessage
 * @property {(req: SignApprovalRequest) => Promise<SignApprovalResult>} signPsbt
 * @property {(req: SignApprovalRequest) => Promise<SignApprovalResult>} signIn
 */

/**
 * Default Approvals implementation: rejects everything with
 * `USER_APPROVAL_REQUIRED`. Shells without an approval popup wired
 * yet get a structured error at the bridge boundary that the dApp
 * can surface to its user.
 *
 * @type {Approvals}
 */
export const rejectAllApprovals = {
    async connect() { throw new ApprovalRequiredError('connect'); },
    async signAction() { throw new ApprovalRequiredError('signAction'); },
    async signMessage() { throw new ApprovalRequiredError('signMessage'); },
    async signPsbt() { throw new ApprovalRequiredError('signPsbt'); },
    async signIn() { throw new ApprovalRequiredError('signIn'); },
};

export class ApprovalRequiredError extends Error {
    /** @param {string} operation */
    constructor(operation) {
        super(`bridge: user approval required for "${operation}" — wire Approvals in the shell`);
        this.name = 'ApprovalRequiredError';
        this.operation = operation;
        this.code = 'USER_APPROVAL_REQUIRED';
    }
}

export class UserRejectedError extends Error {
    constructor(operation) {
        super(`bridge: user rejected "${operation}"`);
        this.name = 'UserRejectedError';
        this.operation = operation;
        this.code = 'USER_REJECTED';
    }
}
