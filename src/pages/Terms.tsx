// src/pages/Terms.tsx
import React from 'react';
import { IonPage, IonContent } from '@ionic/react';
import styles from './PrivacyPolicy.module.css';
import { Browser } from '@capacitor/browser';

// Shared nav
import TopNav from '@/context/TopNav';
import BottomNav from '@/context/BottomNav';

const link = (href: string, text: string) => (
  <a
    className={styles.link}
    href={href}
    onClick={async (e) => {
      e.preventDefault();
      await Browser.open({ url: href });
    }}
  >
    {text}
  </a>
);

const Terms: React.FC = () => {
  return (
    <IonPage>
      <TopNav showWhenAnon />
      <IonContent fullscreen className={styles.contentPad}>
        <div className={styles.container}>
          <h2 className={styles.title}>Terms of Use (EULA) — OurGLP1</h2>
          <p className={styles.updated}>Last updated: {new Date().toLocaleDateString()}</p>

          {/* Apple-required subscription summary (binary) */}
          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>Subscription Summary (Apple-required)</h3>
            <ul className={styles.list}>
              <li><strong>Title:</strong> Pro</li>
              <li><strong>Length:</strong> 1 month (auto-renewable)</li>
              <li><strong>Price:</strong> £9.99 GBP / month (or local equivalent)</li>
              <li>
                <strong>Links:</strong> {link('/privacy', 'Privacy Policy')} ·{' '}
                {link('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/', 'Apple Standard EULA')}
              </li>
            </ul>
          </section>

          {/* Agreement */}
          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>1) Agreement</h3>
            <p className={styles.body}>
              These Terms of Service (“Terms”) govern your use of the OurGLP1 app (the “App”)
              provided by OurGLP1 (“we,” “us,” or “our”). By using the App, you agree to these Terms
              and to our {link('/privacy', 'Privacy Policy')}. If you do not agree, do not use the App.
            </p>
          </section>

          {/* Eligibility & Account */}
          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>2) Eligibility & Account</h3>
            <ul className={styles.list}>
              <li>You must be at least 13 years old (or the minimum age required in your region).</li>
              <li>You are responsible for your account credentials and device security.</li>
              <li>You agree that information you provide is accurate and kept up to date.</li>
            </ul>
          </section>

          {/* Subscription terms (Apple-required wording) */}
          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>3) Subscriptions & Billing</h3>
            <ul className={styles.list}>
              <li>
                OurGLP1 offers an auto-renewing subscription (“Pro”) available for purchase in the App.
                See the Subscription Summary above for the title, length, and price.
              </li>
              <li>
                Payment is charged to your Apple ID account upon confirmation of purchase. Your
                subscription automatically renews unless auto-renew is turned off at least 24 hours
                before the end of the current period.
              </li>
              <li>
                Your account will be charged for renewal within 24 hours prior to the end of the current
                period. After purchase, you can manage or cancel your subscription in iOS Settings:
                {` `}
                {link('itms-apps://apps.apple.com/account/subscriptions', 'Manage Subscriptions')}.
              </li>
              <li>
                If offered, free trial or introductory offers convert to a paid subscription at the
                end of the trial unless cancelled at least 24 hours before trial ends.
              </li>
              <li>
                Partial period refunds are not provided. Where required by law, you may be entitled to a
                refund via Apple—see the Apple Media Services terms in your region.
              </li>
            </ul>
          </section>

          {/* Restore purchases */}
          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>4) Restore Purchases</h3>
            <p className={styles.body}>
              If you reinstall the App or change devices, you can restore your active subscriptions
              from the paywall using <strong>Restore Purchases</strong>. This uses Apple’s purchase records
              to re-enable Pro access on your device.
            </p>
          </section>

          {/* App content & acceptable use */}
          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>5) Acceptable Use</h3>
            <ul className={styles.list}>
              <li>Use the App only for lawful purposes and in accordance with these Terms.</li>
              <li>Do not attempt to reverse engineer, disrupt, or misuse the App or its services.</li>
              <li>Do not upload harmful or illegal content.</li>
            </ul>
          </section>

          {/* Health / medical disclaimer */}
          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>6) Health Disclaimer</h3>
            <p className={styles.body}>
              OurGLP1 provides planning and tracking tools only and does not provide medical advice,
              diagnosis, or treatment. The App is <strong>not</strong> a medical device. Always consult
              a qualified healthcare professional for questions about your health, medications, or
              treatment options. Do not disregard professional medical advice because of something you
              read in the App.
            </p>
          </section>

          {/* Privacy */}
          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>7) Privacy</h3>
            <p className={styles.body}>
              Your use of the App is also governed by our {link('/privacy', 'Privacy Policy')}, which
              explains what data we collect, how we use it, and your choices.
            </p>
          </section>

          {/* Intellectual property */}
          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>8) Intellectual Property</h3>
            <p className={styles.body}>
              The App, including its content, features, and design, is owned by OurGLP1 or its
              licensors and is protected by applicable intellectual property laws. You are granted a
              personal, non-exclusive, non-transferable license to use the App in accordance with these Terms.
            </p>
          </section>

          {/* Third-party services */}
          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>9) Third-Party Services</h3>
            <p className={styles.body}>
              The App may integrate with third-party services (e.g., Apple Push Notification service).
              Your use of such services may be subject to their terms and policies.
            </p>
          </section>

          {/* Apple EULA pointer */}
          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>10) App Store Terms</h3>
            <p className={styles.body}>
              If you obtained the App from Apple’s App Store, your use of the App is also governed by
              Apple’s Licensed Application End User License Agreement (EULA) and Apple Media Services
              Terms and Conditions. See{' '}
              {link('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/', 'Apple Standard EULA')}
              {' '}and {link('https://www.apple.com/legal/internet-services/itunes/', 'Apple Terms')}.
            </p>
          </section>

          {/* Changes */}
          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>11) Changes to the App or Terms</h3>
            <p className={styles.body}>
              We may update the App and these Terms from time to time. Material changes will be posted
              in the App or on our website. Your continued use after changes become effective
              constitutes acceptance of the updated Terms.
            </p>
          </section>

          {/* Termination */}
          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>12) Termination</h3>
            <p className={styles.body}>
              We may suspend or terminate access to the App if you materially breach these Terms or
              engage in unlawful activity. You may stop using the App at any time and can cancel your
              subscription in iOS Settings.
            </p>
          </section>

          {/* Disclaimers & liability */}
          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>13) Disclaimers & Limitation of Liability</h3>
            <p className={styles.body}>
              To the fullest extent permitted by law, the App is provided “as is” without warranties of
              any kind, and OurGLP1 shall not be liable for indirect, incidental, special, or
              consequential damages arising out of or related to your use of the App.
            </p>
          </section>

          {/* Contact */}
          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>14) Contact</h3>
            <p className={styles.body}>
              General: {link('mailto:info@ourglp1.com', 'info@ourglp1.com')} · Support:{' '}
              {link('mailto:support@ourglp1.com', 'support@ourglp1.com')} · Privacy:{' '}
              {link('mailto:privacy@ourglp1.com', 'privacy@ourglp1.com')}
            </p>
          </section>

          <footer className={styles.footerNote}>
            <small className={styles.muted}>
              Manage or cancel your subscription any time here:{' '}
              {link('itms-apps://apps.apple.com/account/subscriptions', 'Apple Subscriptions')}
            </small>
          </footer>
        </div>
      </IonContent>
      <BottomNav showWhenAnon />
    </IonPage>
  );
};

export default Terms;

