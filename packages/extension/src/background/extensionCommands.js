// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export const EXTENSION_COMMANDS = /** @type {const} */ ({
    OPEN_WALLET: 'open-wallet',
    LOCK_WALLET: 'lock-wallet',
});

/**
 * Attach the manifest command dispatcher to the MV3 service worker.
 *
 * @param {object} deps
 * @param {{ onCommand?: { addListener: Function, removeListener?: Function } }} deps.commandsApi
 * @param {(tab?: { windowId?: number }) => Promise<unknown> | unknown} deps.openWallet
 * @param {() => Promise<unknown> | unknown} deps.lockWallet
 * @param {{ error: Function }} [deps.logger]
 * @returns {() => void}
 */
export function attachExtensionCommandListener({
    commandsApi,
    openWallet,
    lockWallet,
    logger = console,
}) {
    if (!commandsApi?.onCommand?.addListener) return () => {};

    const handlers = {
        [EXTENSION_COMMANDS.OPEN_WALLET]: openWallet,
        [EXTENSION_COMMANDS.LOCK_WALLET]: lockWallet,
    };
    const onCommand = (command, tab) => {
        const handler = handlers[command];
        if (!handler) return;
        try {
            Promise.resolve(handler(tab)).catch((err) => {
                logger.error(`[xchain] extension command ${command} failed:`, err);
            });
        } catch (err) {
            logger.error(`[xchain] extension command ${command} failed:`, err);
        }
    };

    commandsApi.onCommand.addListener(onCommand);
    return () => commandsApi.onCommand.removeListener?.(onCommand);
}
