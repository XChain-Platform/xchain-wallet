import SwiftUI
import WidgetKit
import XCTest
@testable import WatchApp

@MainActor
final class ComplicationsTests: XCTestCase {
    func testRegistersEveryWatchComplicationFamilyAndRootURL() {
        XCTAssertEqual(
            Complications.families,
            [.accessoryCircular, .accessoryCorner, .accessoryInline, .accessoryRectangular]
        )
        XCTAssertEqual(Complications.rootURL?.absoluteString, "xchain://balances")
        XCTAssertEqual(Complications.kind, "XChainComplications")
    }

    func testCircularAndCornerRenderRequestOrUnreadBadges() throws {
        let request = view(badge: .request, headline: .alerts(4))
        let unread = view(badge: .unread(120), headline: .alerts(120))

        XCTAssertEqual(request.badgeText, "!")
        XCTAssertEqual(unread.badgeText, "99+")
        XCTAssertNotNil(render(request, family: .accessoryCircular, size: 80))
        XCTAssertNotNil(render(unread, family: .accessoryCorner, size: 80))
    }

    func testInlineUsesTotalWhenVisibleAndAlertCountOtherwise() throws {
        let total = view(badge: .none, headline: .total("$20.00"))
        let alerts = view(badge: .unread(3), headline: .alerts(3))

        XCTAssertEqual(total.headlineText, "$20.00")
        XCTAssertTrue(alerts.headlineText.hasPrefix("3 "))
        XCTAssertNotNil(render(total, family: .accessoryInline, width: 180, height: 30))
        XCTAssertNotNil(render(alerts, family: .accessoryInline, width: 180, height: 30))
    }

    func testRectangularAndSmartStackRenderHeadlineAndAge() throws {
        let total = view(
            badge: .none,
            headline: .total("$20.00"),
            age: WidgetFrames.Age(key: "state.ageMinutes", n: 12)
        )
        let unread = view(
            badge: .unread(2),
            headline: .alerts(2),
            age: WidgetFrames.Age(key: "state.ageHours", n: 3)
        )

        XCTAssertTrue(total.ageText?.contains("12") == true)
        XCTAssertTrue(unread.ageText?.contains("3") == true)
        XCTAssertNotNil(render(total, family: .accessoryRectangular, width: 180, height: 80))
        XCTAssertNotNil(render(unread, family: .accessoryRectangular, width: 180, height: 80))
    }

    func testNoBadgeOrAgeStaysAbsent() {
        let complication = view(badge: .none, headline: .alerts(0))

        XCTAssertNil(complication.badgeText)
        XCTAssertNil(complication.ageText)
    }

    private func view(
        badge: ComplicationContent.Badge,
        headline: ComplicationContent.Headline,
        age: WidgetFrames.Age? = nil
    ) -> ComplicationView {
        ComplicationView(entry: WidgetEntry(
            date: Date(), badge: badge, headline: headline, age: age, relevance: nil
        ))
    }

    private func render(
        _ view: ComplicationView,
        family: WidgetFamily,
        size: CGFloat
    ) -> CGImage? {
        render(view, family: family, width: size, height: size)
    }

    private func render(
        _ view: ComplicationView,
        family: WidgetFamily,
        width: CGFloat,
        height: CGFloat
    ) -> CGImage? {
        let renderer = ImageRenderer(
            content: view.content(for: family).frame(width: width, height: height)
        )
        renderer.scale = 2
        return renderer.cgImage
    }
}
