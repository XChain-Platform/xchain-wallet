import Foundation

enum WidgetFrames {
    struct Age: Equatable {
        let key: String
        let n: Int
    }

    struct Frame: Equatable {
        let at: Int64
        let badge: ComplicationContent.Badge
        let headline: ComplicationContent.Headline
        let age: Age?
        let relevance: Float
    }

    static func frames(summary: WidgetSummaryContent, now: Int64, limit: Int = 60) -> [Frame] {
        let badge = ComplicationContent.badge(
            requestWaiting: summary.requestWaiting,
            unreadCount: summary.unreadCount
        )
        let headline = ComplicationContent.headline(
            totalText: summary.totalText,
            unreadCount: summary.unreadCount
        )
        let relevance = TimelinePlan.relevanceScore(requestWaiting: summary.requestWaiting)

        guard let balancesAt = summary.balancesAt else {
            return [Frame(at: now, badge: badge, headline: headline, age: nil, relevance: relevance)]
        }

        return TimelinePlan.entryDates(balancesAt: balancesAt, now: now, limit: limit).map { at in
            let age = RelativeTimeText.ageKey(balancesAt: balancesAt, now: at)
            return Frame(
                at: at,
                badge: badge,
                headline: headline,
                age: Age(key: age.key, n: age.n),
                relevance: relevance
            )
        }
    }
}
