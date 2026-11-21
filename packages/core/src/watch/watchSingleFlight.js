// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function createSingleFlight(run) {
    const flights = new Map();

    return {
        get(key) {
            if (typeof key !== 'string' || key.length === 0) {
                throw new TypeError('Single-flight key must be a non-empty string');
            }

            const pending = flights.get(key);
            if (pending) return pending;

            let flight;
            try {
                flight = Promise.resolve(run(key));
            } catch (error) {
                flight = Promise.reject(error);
            }

            flights.set(key, flight);
            const clear = () => {
                if (flights.get(key) === flight) flights.delete(key);
            };
            flight.then(clear, clear);
            return flight;
        },
        pending() {
            return flights.size;
        },
    };
}
