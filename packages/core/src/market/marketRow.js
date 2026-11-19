// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A price or change figure from the explorer, or null when it is not a finite
// number. Invalid figures are omitted instead of rendered as misleading text.
function finiteFigure(value, { percent = false } = {}) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value).trim();
    if (text === '') return null;
    const numeric = percent ? text.replace(/%$/, '') : text;
    return Number.isFinite(Number(numeric)) ? text : null;
}

/** Normalize the explorer's supported market-row shapes for display. */
export function normalizeMarket(row) {
    if (!row || typeof row !== 'object') return null;
    const tick1 = row.tick1 || row.tickA || row.give_tick || row.base || null;
    const tick2 = row.tick2 || row.tickB || row.get_tick || row.quote || null;
    if (typeof tick1 !== 'string' || typeof tick2 !== 'string') return null;
    if (tick1.trim().toUpperCase() === tick2.trim().toUpperCase()) return null;
    const lastPrice = finiteFigure(row.tick1_price ?? row.last_price ?? row.lastPrice ?? row.last);
    const change24h = finiteFigure(
        row.tick1_24hr_change ?? row.change_24h ?? row.change24h,
        { percent: true },
    );
    const depthRaw = row.depth ?? row.open_orders ?? row.orderCount;
    const depth = typeof depthRaw === 'number' ? depthRaw : Number(depthRaw);
    const name1 = row.name1 ?? row.tick1_name ?? row.tick1Name ?? row.base_name ?? row.baseName;
    const name2 = row.name2 ?? row.tick2_name ?? row.tick2Name ?? row.quote_name ?? row.quoteName;
    return {
        tick1: String(tick1),
        tick2: String(tick2),
        ...(name1 != null && String(name1).length > 0 ? { name1: String(name1) } : {}),
        ...(name2 != null && String(name2).length > 0 ? { name2: String(name2) } : {}),
        lastPrice: lastPrice ?? undefined,
        change24h: change24h ?? undefined,
        depth: Number.isFinite(depth) && depth >= 0 ? depth : undefined,
    };
}
