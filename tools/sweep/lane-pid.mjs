#!/usr/bin/env node
// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function delay(ms) {
    return new Promise((done) => setTimeout(done, ms));
}

function validateName(name) {
    if (!NAME_RE.test(name || '')) throw new Error('name must contain only letters, digits, dots, underscores, and hyphens');
}

function pathsFor(name, dir) {
    validateName(name);
    if (!dir) throw new Error('--dir is required');
    const absoluteDir = resolve(dir);
    return {
        dir: absoluteDir,
        logPath: join(absoluteDir, `${name}.log`),
        pidPath: join(absoluteDir, `${name}.pid`),
    };
}

export function readPidRecord(name, dir) {
    const { pidPath } = pathsFor(name, dir);
    if (!existsSync(pidPath)) return null;
    let record;
    try {
        record = JSON.parse(readFileSync(pidPath, 'utf8'));
    } catch {
        throw new Error(`invalid pid file: ${pidPath}`);
    }
    if (!Number.isInteger(record.pid) || record.pid <= 0
        || !Number.isInteger(record.pgid) || record.pgid <= 0) {
        throw new Error(`invalid pid file: ${pidPath}`);
    }
    return { ...record, pidPath };
}

export function isProcessGroupRunning(pgid) {
    try {
        process.kill(-pgid, 0);
        return true;
    } catch (error) {
        if (error.code === 'ESRCH') return false;
        if (error.code === 'EPERM') return true;
        throw error;
    }
}

function signalProcessGroup(pgid, signal) {
    try {
        process.kill(-pgid, signal);
        return true;
    } catch (error) {
        if (error.code === 'ESRCH') return false;
        throw error;
    }
}

export function statusRecordedProcess(name, dir) {
    const record = readPidRecord(name, dir);
    if (!record) return { state: 'missing', running: false };
    const running = isProcessGroupRunning(record.pgid);
    return { ...record, state: running ? 'running' : 'stopped', running };
}

export function startRecordedProcess(name, {
    dir, command, args = [], cwd = process.cwd(), env = process.env, unref = false,
} = {}) {
    if (!command) throw new Error('a command is required after --');
    const paths = pathsFor(name, dir);
    const previous = readPidRecord(name, dir);
    if (previous && isProcessGroupRunning(previous.pgid)) {
        throw new Error(`${name} is already running as process group ${previous.pgid}`);
    }

    mkdirSync(paths.dir, { recursive: true });
    const logFd = openSync(paths.logPath, 'w');
    let child;
    try {
        child = spawn(command, args, {
            cwd,
            env,
            detached: true,
            stdio: ['ignore', logFd, logFd],
        });
    } finally {
        closeSync(logFd);
    }
    child.once('error', () => {});
    if (!child.pid) throw new Error(`failed to start command: ${command}`);

    const record = {
        pid: child.pid,
        pgid: child.pid,
        startedAt: new Date().toISOString(),
    };
    writeFileSync(paths.pidPath, `${JSON.stringify(record, null, 2)}\n`);
    if (unref) child.unref();
    return { ...record, ...paths, child };
}

async function waitForStopped(pgid, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (isProcessGroupRunning(pgid)) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        await delay(Math.min(50, remaining));
    }
    return true;
}

export async function stopRecordedProcess(name, { dir, graceMs = 3000 } = {}) {
    const record = readPidRecord(name, dir);
    if (!record) throw new Error(`refusing to stop ${name}: pid file is missing`);
    if (isProcessGroupRunning(record.pgid)) {
        signalProcessGroup(record.pgid, 'SIGTERM');
        if (!await waitForStopped(record.pgid, graceMs)) {
            signalProcessGroup(record.pgid, 'SIGKILL');
            if (!await waitForStopped(record.pgid, 1000)) {
                throw new Error(`process group ${record.pgid} did not stop`);
            }
        }
    }
    const stopped = { pid: record.pid, pgid: record.pgid, stoppedAt: new Date().toISOString() };
    writeFileSync(record.pidPath, `${JSON.stringify(stopped, null, 2)}\n`);
    return stopped;
}

function parseCli(argv) {
    const [action, name, ...rest] = argv;
    if (!['start', 'stop', 'status'].includes(action) || !name) {
        throw new Error('usage: lane-pid.mjs <start|stop|status> <name> --dir <scratch> [-- <cmd...>]');
    }
    const separator = rest.indexOf('--');
    const optionArgs = separator === -1 ? rest : rest.slice(0, separator);
    const commandArgs = separator === -1 ? [] : rest.slice(separator + 1);
    let dir;
    for (let i = 0; i < optionArgs.length; i += 1) {
        if (optionArgs[i] !== '--dir' || !optionArgs[i + 1]) {
            throw new Error('usage: lane-pid.mjs <start|stop|status> <name> --dir <scratch> [-- <cmd...>]');
        }
        dir = optionArgs[i + 1];
        i += 1;
    }
    if (!dir) throw new Error('--dir is required');
    if (action === 'start' && commandArgs.length === 0) throw new Error('start requires a command after --');
    if (action !== 'start' && commandArgs.length > 0) throw new Error(`${action} does not accept a command`);
    return { action, name, dir, commandArgs };
}

async function main() {
    try {
        const { action, name, dir, commandArgs } = parseCli(process.argv.slice(2));
        if (action === 'start') {
            const started = startRecordedProcess(name, {
                dir,
                command: commandArgs[0],
                args: commandArgs.slice(1),
                unref: true,
            });
            console.log(`${name} started pid ${started.pid} pgid ${started.pgid}`);
            return;
        }
        if (action === 'stop') {
            const stopped = await stopRecordedProcess(name, { dir });
            console.log(`${name} stopped pgid ${stopped.pgid}`);
            return;
        }
        const status = statusRecordedProcess(name, dir);
        if (status.state === 'missing') {
            console.log(`${name} missing`);
            process.exitCode = 1;
        } else {
            console.log(`${name} ${status.state} pid ${status.pid} pgid ${status.pgid}`);
            if (!status.running) process.exitCode = 1;
        }
    } catch (error) {
        console.error(error.message || error);
        process.exitCode = 2;
    }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
    await main();
}
