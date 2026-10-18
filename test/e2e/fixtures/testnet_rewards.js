// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const MINIMUM_PARTIAL_REWARD = 0.00000001;

async function explorerRows(path, { explorerUrl, coin, fetch }) {
    const response = await fetch(`${explorerUrl}/${coin}/api/${path}`, {
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
        throw new Error(`explorer reward request returned HTTP ${response.status}`);
    }
    const body = await response.json();
    if (Array.isArray(body)) return body;
    if (Array.isArray(body?.data)) return body.data;
    if (Array.isArray(body?.rows)) return body.rows;
    return [];
}

export function rewardTotal(rewards, claims) {
    const accrued = rewards.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const claimed = claims
        .filter((row) => String(row.status).toLowerCase() === 'valid')
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return accrued - claimed;
}

export function claimAmount(total, requested) {
    if (requested === undefined) return partialAmount(total);
    const amount = String(requested);
    if (!/^\d+(\.\d{1,8})?$/.test(amount) || !(Number(amount) > 0) || !(Number(amount) < total)) {
        throw new Error('claimant.amount must be a positive decimal below the unclaimed reward');
    }
    return amount;
}

export function partialAmount(total) {
    const units = BigInt(Math.floor(total * 100_000_000));
    const partial = units > 1n ? units / 2n : 1n;
    const whole = partial / 100_000_000n;
    const fraction = (partial % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : String(whole);
}

export async function unclaimedReward(address, {
    explorerUrl,
    coin,
    fetch = globalThis.fetch,
}) {
    const request = { explorerUrl, coin, fetch };
    const [rewards, claims] = await Promise.all([
        explorerRows(`rewards/${address}/address`, request),
        explorerRows(`collects/${address}/address`, request),
    ]);
    return rewardTotal(rewards, claims);
}

export async function preflightClaimantReward(input, options) {
    const reward = await unclaimedReward(input.claimant.address, options);
    if (reward <= MINIMUM_PARTIAL_REWARD) {
        throw new Error(
            `Claimant reward preflight refused: reward seen ${reward} is not above ${MINIMUM_PARTIAL_REWARD}`,
        );
    }
    if (input.claimant.amount !== undefined) {
        try {
            claimAmount(reward, input.claimant.amount);
        } catch (error) {
            throw new Error(
                `Claimant reward preflight refused: reward seen ${reward}; ${error.message}`,
            );
        }
    }
    return reward;
}
