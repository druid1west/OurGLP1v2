//  SceneDelegate.swift
//  OurGLP1
//

import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: windowScene)
    window.rootViewController = CAPBridgeViewController()
    self.window = window
    window.makeKeyAndVisible()
  }

  // Custom URL schemes (ourglp1://...)
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let url = URLContexts.first?.url else { return }
    print("🔗 [SceneDelegate] openURLContexts:", url.absoluteString)
    NotificationCenter.default.post(name: Notification.Name.capacitorOpenURL, object: url)
  }

  // Universal links
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    print("🔗 [SceneDelegate] continue userActivity:", userActivity.activityType,
          userActivity.webpageURL?.absoluteString ?? "(no url)")
    NotificationCenter.default.post(name: Notification.Name.capacitorContinueActivity, object: userActivity)
  }
}


