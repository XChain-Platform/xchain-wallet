import Foundation

enum ActivityCheckSession {
    static let taskIdentifier = "io.xchain.wallet.ios.activity-check"
    static let repeatInterval: TimeInterval = 21_600

    static func earliestBeginDate(after now: Date) -> Date {
        now.addingTimeInterval(repeatInterval)
    }

    static func configuration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = TimeInterval(ActivityCheckRules.requestTimeoutSeconds)
        configuration.timeoutIntervalForResource = TimeInterval(ActivityCheckRules.requestTimeoutSeconds)
        return configuration
    }

    static func makeSession() -> URLSession {
        URLSession(configuration: configuration())
    }

    static func request(url: String) -> URLRequest? {
        guard
            let url = URL(string: url),
            let scheme = url.scheme?.lowercased(),
            scheme == "http" || scheme == "https",
            let host = url.host,
            !host.isEmpty
        else {
            return nil
        }

        var request = URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: TimeInterval(ActivityCheckRules.requestTimeoutSeconds)
        )
        request.httpMethod = "GET"
        return request
    }

    static func body(data: Data?, response: URLResponse?, error: Error?) -> Data? {
        guard
            error == nil,
            let response = response as? HTTPURLResponse,
            response.statusCode == 200,
            let data
        else {
            return nil
        }

        return data
    }
}
