import XCTest
@testable import WatchApp

final class WidgetSummaryTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testWritesProtectedSummaryAndReloadsTimelines() throws {
        var written: WidgetSummaryContent?
        var options: Data.WritingOptions?
        var reloads = 0
        let summary = WidgetSummary(directory: nil, writer: { content, receivedOptions in
            written = content
            options = receivedOptions
            return true
        }, reload: { reloads += 1 })

        summary.save(
            showTotal: true, session: "unlocked", hidden: false,
            totalText: "$20.00", unreadCount: 2, requestWaiting: true,
            balancesAt: 1_700_000_000_000
        )

        XCTAssertEqual(
            written,
            WidgetSummaryContent(
                unreadCount: 2, requestWaiting: true, totalText: "$20.00",
                balancesAt: 1_700_000_000_000
            )
        )
        XCTAssertEqual(options, .completeFileProtectionUntilFirstUserAuthentication)
        XCTAssertEqual(reloads, 1)
    }

    func testReloadsOnlyWhenFileContentChanges() throws {
        var reloads = 0
        let summary = WidgetSummary(directory: directory, reload: { reloads += 1 })

        for _ in 0..<2 {
            summary.save(
                showTotal: true, session: "unlocked", hidden: false,
                totalText: "$20.00", unreadCount: 0, requestWaiting: false,
                balancesAt: 1_700_000_000_000
            )
        }

        XCTAssertEqual(reloads, 1)
        XCTAssertEqual(
            WidgetSummaryFile(directory: directory).read()?.totalText,
            "$20.00"
        )
    }

    func testOmitsTotalWhenSettingIsOffLockedOrHidden() throws {
        var totals: [String?] = []
        let summary = WidgetSummary(directory: nil, writer: { content, _ in
            totals.append(content.totalText)
            return true
        }, reload: {})

        summary.save(
            showTotal: false, session: "unlocked", hidden: false,
            totalText: "$20.00", unreadCount: 0, requestWaiting: false, balancesAt: 1
        )
        summary.save(
            showTotal: true, session: "locked", hidden: false,
            totalText: "$20.00", unreadCount: 0, requestWaiting: false, balancesAt: 1
        )
        summary.save(
            showTotal: true, session: "unlocked", hidden: true,
            totalText: "$20.00", unreadCount: 0, requestWaiting: false, balancesAt: 1
        )

        XCTAssertEqual(totals.count, 3)
        XCTAssertTrue(totals.allSatisfy { $0 == nil })
    }

    func testSnapshotStoreWritesSummaryOnEverySave() throws {
        var written: [WidgetSummaryContent] = []
        let summary = WidgetSummary(directory: nil, writer: { content, _ in
            written.append(content)
            return true
        }, reload: {})
        let store = SnapshotStore(directory: directory, widgetSummary: summary)
        let fixtures = try XCTUnwrap(WatchFixtureFiles.directory(from: #filePath))
        let snapshot = try WatchFixtureFiles.data("snapshot-empty", in: fixtures)

        XCTAssertTrue(store.save(snapshot))
        XCTAssertTrue(store.save(snapshot))
        XCTAssertEqual(written.count, 2)
        XCTAssertEqual(written.last?.unreadCount, 0)
        XCTAssertEqual(written.last?.requestWaiting, true)
        XCTAssertEqual(written.last?.totalText, "$0.00")
        XCTAssertEqual(written.last?.balancesAt, 1_700_000_000_000)
    }
}
