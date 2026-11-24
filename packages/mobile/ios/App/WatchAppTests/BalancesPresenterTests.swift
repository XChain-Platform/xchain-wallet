// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import XCTest
@testable import WatchApp

final class BalancesPresenterTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testEverySnapshotMatchesSharedExpectedModels() throws {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory(from: #filePath))
        let names = WatchFixtureFiles.names(prefix: "snapshot-", in: directory)
        let expected = try XCTUnwrap(
            try JSONSerialization.jsonObject(
                with: WatchFixtureFiles.data("expected/balances", in: directory)
            ) as? [String: Any]
        )

        XCTAssertFalse(names.isEmpty)
        for name in names {
            let snapshot = try decoder.decode(
                Snapshot.self,
                from: WatchFixtureFiles.data(name, in: directory)
            )
            let expectedModes = try XCTUnwrap(expected[name] as? [String: Any], name)

            for (modeName, mode) in [("fiat", WatchUnitsMode.fiat), ("units", .units)] {
                let display = BalancesPresenter.present(
                    snapshot: snapshot,
                    mode: mode,
                    now: snapshot.builtAt
                )
                let expectedModel = try XCTUnwrap(
                    expectedModes[modeName] as? NSDictionary,
                    "\(name) \(modeName)"
                )
                XCTAssertEqual(balanceObject(display), expectedModel, "\(name) \(modeName)")
            }
        }
    }

    func testEverySnapshotSetsAgeSeverityAcrossAmberBoundary() throws {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory(from: #filePath))
        let names = WatchFixtureFiles.names(prefix: "snapshot-", in: directory)

        XCTAssertFalse(names.isEmpty)
        for name in names {
            let snapshot = try decoder.decode(
                Snapshot.self,
                from: WatchFixtureFiles.data(name, in: directory)
            )
            let expectedNormal: BalancesAgeSeverity? = snapshot.settings.enabled ? .normal : nil
            let expectedAmber: BalancesAgeSeverity? = snapshot.settings.enabled ? .amber : nil

            XCTAssertEqual(
                BalancesPresenter.present(
                    snapshot: snapshot,
                    now: snapshot.balancesAt + 14 * 60_000
                ).ageSeverity,
                expectedNormal,
                "\(name) at 14 minutes"
            )
            XCTAssertEqual(
                BalancesPresenter.present(
                    snapshot: snapshot,
                    now: snapshot.balancesAt + 16 * 60_000
                ).ageSeverity,
                expectedAmber,
                "\(name) at 16 minutes"
            )
        }
    }

    func testLoadingAndReachabilityProduceStateBanners() throws {
        XCTAssertEqual(
            BalancesPresenter.present(snapshot: nil).banners,
            ["state.loading"]
        )

        let snapshot = try fixture("snapshot-empty")
        let display = BalancesPresenter.present(
            snapshot: snapshot,
            phoneReachable: false,
            now: snapshot.builtAt
        )
        XCTAssertEqual(display.banners, ["state.unreachable"])
    }

    func testUnavailableRowsOverrideAmounts() throws {
        let snapshot = try fixture("snapshot-unpriced")
        let row = snapshot.rows[0]
        let unavailable = SnapshotRow(
            id: row.id,
            chainId: row.chainId,
            tick: row.tick,
            displayName: row.displayName,
            amountText: row.amountText,
            fiatText: row.fiatText,
            noPrice: row.noPrice,
            pendingText: row.pendingText,
            unavailable: true,
            iconHash: row.iconHash,
            tickerColor: row.tickerColor,
            hasDetail: row.hasDetail
        )
        let changed = Snapshot(
            v: snapshot.v,
            builtAt: snapshot.builtAt,
            balancesAt: snapshot.balancesAt,
            pricesAt: snapshot.pricesAt,
            session: snapshot.session,
            network: snapshot.network,
            fiatCode: snapshot.fiatCode,
            hidden: snapshot.hidden,
            unitDefault: snapshot.unitDefault,
            walletName: snapshot.walletName,
            totals: snapshot.totals,
            rows: [unavailable],
            capped: snapshot.capped,
            receive: snapshot.receive,
            inbox: snapshot.inbox,
            request: snapshot.request,
            settings: snapshot.settings
        )

        let line = try XCTUnwrap(
            BalancesPresenter.present(snapshot: changed, mode: .fiat).lines.first
        )
        XCTAssertEqual(line.primary, BalanceText(key: "state.balanceUnavailable"))
        XCTAssertNil(line.secondary)
    }

    func testEnabledSnapshotsExposePinnedRequestAndTestNetworksStayInUnits() throws {
        let enabled = try fixture("snapshot-empty")
        let disabled = try fixture("snapshot-disabled")
        let testnet = try fixture("snapshot-testnet")

        XCTAssertEqual(
            BalancesPresenter.present(snapshot: enabled).requestKey,
            "w1.requestWaiting"
        )
        XCTAssertNil(BalancesPresenter.present(snapshot: disabled).requestKey)
        XCTAssertEqual(
            BalancesPresenter.present(snapshot: testnet, mode: .fiat),
            BalancesPresenter.present(snapshot: testnet, mode: .units)
        )
        XCTAssertFalse(WatchUnitsMode.canToggle(isTest: testnet.network.isTest))
    }

    private func fixture(_ name: String) throws -> Snapshot {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory(from: #filePath))
        return try decoder.decode(
            Snapshot.self,
            from: WatchFixtureFiles.data(name, in: directory)
        )
    }

    private func balanceObject(_ display: BalancesDisplay) -> NSDictionary {
        let header: Any = display.header.map(textObject) ?? NSNull()
        let ageLine: Any = display.ageLine ?? NSNull()
        return [
            "header": header,
            "lines": display.lines.map(lineObject),
            "banners": display.banners,
            "ageLine": ageLine,
        ] as NSDictionary
    }

    private func lineObject(_ line: BalanceLine) -> NSDictionary {
        if let name = line.name, let primary = line.primary {
            let secondary: Any = line.secondary.map(textObject) ?? NSNull()
            return [
                "name": name,
                "primary": textObject(primary),
                "secondary": secondary,
            ] as NSDictionary
        }
        return ["key": line.key ?? ""] as NSDictionary
    }

    private func textObject(_ text: BalanceText) -> NSDictionary {
        if let key = text.key {
            return ["key": key]
        }
        return ["text": text.text ?? ""]
    }
}
