import Foundation

enum NotifyCategoryRules {
    static let requestCategoryId = "request"
    static let paydueCategoryId = "paydue"
    static let alertCategoryId = "alert"
    static let openOnPhoneActionId = "openOnPhone"

    struct Category: Equatable {
        let id: String
        let openOnPhoneTitle: String?
    }

    static func categories(storedTitle: String?) -> [Category] {
        let title = storedTitle?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nilIfEmpty

        return [
            Category(id: requestCategoryId, openOnPhoneTitle: title),
            Category(id: paydueCategoryId, openOnPhoneTitle: title),
            Category(id: alertCategoryId, openOnPhoneTitle: nil),
        ]
    }

    static func isOpenOnPhone(actionId: String, categoryId: String) -> Bool {
        actionId == openOnPhoneActionId
            && (categoryId == requestCategoryId || categoryId == paydueCategoryId)
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
