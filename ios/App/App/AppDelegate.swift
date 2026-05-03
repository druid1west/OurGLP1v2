//  AppDelegate.swift
//  OurGLP1
//very d

import UIKit
import Capacitor
import UserNotifications
import FirebaseCore
import os

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

  private let log = Logger(subsystem: "com.parisclinic.ourglp1", category: "AppDelegate")
  var window: UIWindow?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    FirebaseApp.configure()

    UNUserNotificationCenter.current().delegate = self

    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
      if let error = error {
        self.log.error("Notification permission error: \(error.localizedDescription, privacy: .public)")
      } else {
        self.log.info("Notification permission granted: \(granted, privacy: .public)")
      }
    }

    DispatchQueue.main.async {
      UIApplication.shared.registerForRemoteNotifications()
    }

    return true
  }

  // MARK: - APNs

  func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
    guard !token.isEmpty else {
      log.warning("Empty APNs token, skipping.")
      return
    }

    let maskedTail = String(token.suffix(6))
    log.info("APNs device token received (masked ..\(maskedTail, privacy: .private))")

    UserDefaults.standard.set(token, forKey: "apn_token")

    if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
       let root = windowScene.windows.first?.rootViewController as? CAPBridgeViewController {
      DispatchQueue.main.async {
        let js = "window.dispatchEvent(new CustomEvent('capacitorDidRegisterForRemoteNotifications', { detail: '\(token)' }));"
        root.bridge?.webView?.evaluateJavaScript(js) { _, error in
          if let error = error {
            self.log.warning("Failed to inject APNs token to JS: \(error.localizedDescription, privacy: .public)")
          } else {
            self.log.info("JS event dispatched with APNs token (not logging value)")
          }
        }
      }
    } else {
      log.info("WebView not ready; pushManager will use Preferences fallback")
    }
  }

  func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    log.error("APNs registration failed: \(error.localizedDescription, privacy: .public)")
  }

  // MARK: - URL handling (mask full URL)

  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey : Any] = [:]
  ) -> Bool {
    let scheme = url.scheme ?? "-"
    let host = url.host ?? "-"
    log.info("open url (masked): \(scheme, privacy: .public)://\(host, privacy: .public)")
    NotificationCenter.default.post(name: Notification.Name.capacitorOpenURL, object: url)
    return true
  }

  func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let type  = userActivity.activityType
    let host  = userActivity.webpageURL?.host ?? "-"
    log.info("continue userActivity: \(type, privacy: .public) host=\(host, privacy: .public)")
    NotificationCenter.default.post(name: Notification.Name.capacitorContinueActivity, object: userActivity)
    return true
  }
}

// MARK: - UNUserNotificationCenterDelegate

extension AppDelegate: UNUserNotificationCenterDelegate {
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    if #available(iOS 14.0, *) {
      completionHandler([.banner, .list, .sound, .badge])
    } else {
      completionHandler([.alert, .sound, .badge])
    }
  }
}




