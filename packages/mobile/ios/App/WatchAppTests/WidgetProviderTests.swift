import XCTest
import WidgetKit
@testable import WatchApp

final class WidgetProviderTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    func testTimelineReadsSummaryAndRaisesRelevanceForRequest() throws {
        let summary = WidgetSummaryContent(
            unreadCount: 2,
            requestWaiting: true,
            totalText: "$20.00",
            balancesAt: 1_700_000_000_000
        )
        let provider = WidgetProvider(read: { summary }, now: { self.now })

        let timeline = provider.timeline()
        let first = try XCTUnwrap(timeline.entries.first)

        XCTAssertEqual(timeline.entries.count, 60)
        XCTAssertEqual(first.date, now)
        XCTAssertEqual(first.badge, .request)
        XCTAssertEqual(first.headline, .total("$20.00"))
        XCTAssertEqual(first.age, WidgetFrames.Age(key: "state.ageJustNow", n: 0))
        XCTAssertEqual(first.relevance?.score, 100)
        guard case .atEnd = timeline.policy else {
            return XCTFail("Expected timeline to reload at end")
        }
    }

    func testTimelineUsesNeutralEntryWhenSummaryIsMissing() throws {
        let provider = WidgetProvider(directory: nil, now: { self.now })

        let timeline = provider.timeline()
        let entry = try XCTUnwrap(timeline.entries.first)

        XCTAssertEqual(timeline.entries.count, 1)
        XCTAssertEqual(entry.date, now)
        XCTAssertEqual(entry.badge, .none)
        XCTAssertEqual(entry.headline, .alerts(0))
        XCTAssertNil(entry.age)
        XCTAssertEqual(entry.relevance?.score, 1)
    }

    func testTimelineReadsSummaryFileFromInjectedDirectory() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let summary = WidgetSummaryContent(
            unreadCount: 3, requestWaiting: false, totalText: nil, balancesAt: nil
        )
        XCTAssertTrue(try WidgetSummaryFile(directory: directory).write(summary))

        let entry = try XCTUnwrap(
            WidgetProvider(directory: directory, now: { self.now }).timeline().entries.first
        )

        XCTAssertEqual(entry.badge, .unread(3))
        XCTAssertEqual(entry.headline, .alerts(3))
        XCTAssertEqual(entry.relevance?.score, 1)
    }
}
