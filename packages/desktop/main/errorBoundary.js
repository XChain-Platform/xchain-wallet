// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const reportedErrors = new WeakSet();
const PROCESS_HANDLERS = Symbol.for('xchain.desktop.processErrorHandlers');

/**
 * Emit a context-only failure record. Error messages and stacks can contain
 * wallet inputs, file paths, or deep-link query values, so they stay out of
 * main-process logs.
 *
 * @param {string} context
 * @param {unknown} error
 * @param {(message: string) => void} [log]
 * @returns {boolean} true when this call emitted the record
 */
export function reportMainFailure(context, error, log = console.error) {
    if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
        if (reportedErrors.has(error)) return false;
        reportedErrors.add(error);
    }
    log(`[xchain] ${context} failed`);
    return true;
}

/**
 * Run a synchronous Electron callback without letting an exception escape
 * its EventEmitter.
 *
 * @template T
 * @param {() => T} task
 * @param {string} context
 * @param {(message: string) => void} [log]
 * @returns {T | undefined}
 */
export function runMainCallback(task, context, log = console.error) {
    try {
        return task();
    } catch (error) {
        reportMainFailure(context, error, log);
        return undefined;
    }
}

/**
 * Run an event task through one terminal rejection boundary. Resolving after
 * a failure keeps Electron lifecycle callbacks and timers operational.
 *
 * @template T
 * @param {() => T | Promise<T>} task
 * @param {string} context
 * @param {{ log?: (message: string) => void, recover?: () => void }} [options]
 * @returns {Promise<T | undefined>}
 */
export function runMainTask(task, context, options = {}) {
    const handleFailure = (error) => {
        reportMainFailure(context, error, options.log);
        if (options.recover) {
            try {
                options.recover();
            } catch (recoveryError) {
                reportMainFailure(`${context} recovery`, recoveryError, options.log);
            }
        }
        return undefined;
    };

    try {
        return Promise.resolve(task()).catch(handleFailure);
    } catch (error) {
        return Promise.resolve(handleFailure(error));
    }
}

/**
 * Install the last-resort process boundaries once for a process object.
 * Call-site boundaries retain the recovery context; these handlers cover
 * defects and third-party callbacks that escape one.
 *
 * @param {NodeJS.Process} [proc]
 * @param {(message: string) => void} [log]
 * @returns {() => void}
 */
export function installProcessErrorHandlers(proc = process, log = console.error) {
    if (proc[PROCESS_HANDLERS]) return proc[PROCESS_HANDLERS].dispose;

    const onUnhandledRejection = (error) => {
        reportMainFailure('unhandled main-process rejection', error, log);
    };
    const onUncaughtException = (error) => {
        reportMainFailure('uncaught main-process exception', error, log);
    };
    const dispose = () => {
        proc.off('unhandledRejection', onUnhandledRejection);
        proc.off('uncaughtException', onUncaughtException);
        delete proc[PROCESS_HANDLERS];
    };

    proc.on('unhandledRejection', onUnhandledRejection);
    proc.on('uncaughtException', onUncaughtException);
    proc[PROCESS_HANDLERS] = { dispose };
    return dispose;
}
