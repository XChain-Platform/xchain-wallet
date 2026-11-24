// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    parseProbeLog,
    summarizeRedirect,
    summarizeReturn,
} from './probe-log.mjs';
import { summarizeLaunches } from './probe-launch.mjs';
import { renderProbeResults } from './probe-results.mjs';

const USAGE = 'Usage: node tools/site-request-probe/probe-report.mjs <manifest.json> [--out <file>]';
const PROBES = new Set(['P1', 'P2', 'P10', 'P11']);

function manifestRun(entry, index) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`Manifest entry ${index} must be an object`);
    }
    if (!PROBES.has(entry.probe)) {
        throw new Error(`Manifest entry ${index} has unknown probe ${String(entry.probe)}`);
    }

    const {
        originLog: _originLog,
        landingLog: _landingLog,
        log: _log,
        destinationLog: _destinationLog,
        marker: _marker,
        launch: _launch,
        ...run
    } = entry;
    return run;
}

function requiredValue(entry, key, index, allowNull = false) {
    if (!Object.hasOwn(entry, key) || entry[key] === undefined
        || (!allowNull && entry[key] === null)) {
        throw new Error(`Manifest entry ${index} is missing ${key}`);
    }
    return entry[key];
}

function readProbeLog(entry, key, index, readLog, allowNull = false) {
    const logPath = requiredValue(entry, key, index, allowNull);
    if (allowNull && logPath === null) return null;
    if (typeof logPath !== 'string' || logPath.length === 0) {
        throw new Error(`Manifest entry ${index} has invalid ${key}: ${String(logPath)}`);
    }

    let text;
    try {
        text = readLog(logPath);
    } catch (error) {
        throw new Error(
            `Manifest entry ${index} could not read ${key} path ${logPath}: ${error.message}`,
        );
    }

    const entries = parseProbeLog(text);
    if (entries === null) {
        throw new Error(`Manifest entry ${index} has invalid probe log at ${logPath}`);
    }
    return entries;
}

function launchSummary(entry, index, readLog) {
    const entries = readProbeLog(entry, 'log', index, readLog);
    const launch = requiredValue(entry, 'launch', index);
    const summary = summarizeLaunches(entries).find((candidate) => candidate.launch === launch);
    if (!summary) {
        throw new Error(`Manifest entry ${index} has no summary matching launch ${String(launch)}`);
    }

    const { launch: _launch, ...result } = summary;
    return result;
}

export function buildRuns(manifest, readLog) {
    if (!Array.isArray(manifest)) {
        throw new TypeError('Manifest must be a JSON array');
    }
    if (typeof readLog !== 'function') {
        throw new TypeError('readLog must be a function');
    }

    return manifest.map((entry, index) => {
        const run = manifestRun(entry, index);
        let summary;

        if (entry.probe === 'P1') {
            summary = summarizeReturn({
                origin: readProbeLog(entry, 'originLog', index, readLog),
                landing: readProbeLog(entry, 'landingLog', index, readLog, true),
                marker: requiredValue(entry, 'marker', index),
            });
        } else if (entry.probe === 'P11') {
            summary = summarizeRedirect({
                destination: readProbeLog(entry, 'destinationLog', index, readLog),
                marker: requiredValue(entry, 'marker', index),
            });
        } else {
            summary = launchSummary(entry, index, readLog);
        }

        return { ...run, ...summary };
    });
}

function parseArguments(args) {
    if (args.length === 1) return { manifest: args[0], out: null };
    if (args.length === 3 && args[1] === '--out' && !args[2].startsWith('--')) {
        return { manifest: args[0], out: args[2] };
    }
    return null;
}

function runCli(args) {
    const options = parseArguments(args);
    if (!options || options.manifest.startsWith('--') || options.out === '') {
        process.stderr.write(`${USAGE}\n`);
        process.exitCode = 2;
        return;
    }

    const manifestPath = resolve(options.manifest);
    try {
        let manifest;
        try {
            manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        } catch (error) {
            throw new Error(`Could not read manifest ${manifestPath}: ${error.message}`);
        }
        if (!Array.isArray(manifest)) {
            throw new Error(`Manifest ${manifestPath} must be a JSON array`);
        }

        const manifestDirectory = dirname(manifestPath);
        const runs = buildRuns(
            manifest,
            (logPath) => readFileSync(resolve(manifestDirectory, logPath), 'utf8'),
        );
        const report = renderProbeResults(runs);

        if (options.out === null) process.stdout.write(report);
        else writeFileSync(resolve(options.out), report);
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}

if (process.argv[1]
    && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    runCli(process.argv.slice(2));
}
