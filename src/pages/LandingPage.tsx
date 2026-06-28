import React from 'react';
import { IonPage, IonContent, IonButton } from '@ionic/react';
import { Link, useHistory } from 'react-router-dom';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Pagination } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/pagination';
import Lottie from 'lottie-react';
import phoneSwipe from './animations/phone-swipe.json';
import styles from './LandingPage.module.css';

// Shared nav + auth
import TopNav from '../context/TopNav';
import BottomNav from '../context/BottomNav';

const LandingPage: React.FC = () => {
  const history = useHistory();
  const hasNavigatedRef = React.useRef(false);
  const endTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearEndTimer = React.useCallback(() => {
    if (endTimerRef.current) {
      clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    return () => clearEndTimer(); // cleanup on unmount
  }, [clearEndTimer]);

  return (
    <IonPage>
      {/* fixed top nav; show even if anon on landing */}
      <TopNav showWhenAnon />

      {/* Pad the scroll area for fixed TopNav/BottomNav */}
      <IonContent fullscreen className={styles.contentPad}>
        <div className={styles.swiperViewport}>
          <Swiper
            modules={[Pagination]}
            pagination={{ clickable: true }}
            spaceBetween={24}
            slidesPerView={1}
            autoHeight
            className={styles.swiperFill}
            onSlideChange={(swiper) => {
              if (swiper.isEnd && !hasNavigatedRef.current) {
                clearEndTimer();
                endTimerRef.current = setTimeout(() => {
                  if (!hasNavigatedRef.current) {
                    hasNavigatedRef.current = true;
                    history.replace('/'); // go to Home after 10s
                  }
                }, 10000);
              } else {
                clearEndTimer();
              }
            }}
          >
            {/* Slide 1 */}
            <SwiperSlide>
              <div className={styles.container}>
                <div className={styles.logoWrap}>
                  <img
                    src="/assets/logo1.png"
                    alt="OurGLP1 Logo"
                    className={styles.logo}
                  />
                </div>

                <div className={styles.lottieWrap}>
                  <Lottie
                    animationData={phoneSwipe}
                    loop
                    className={styles.lottie}
                  />
                </div>

                <h2 className={styles.title}>Welcome</h2>
                <h2 className={styles.title}>
                  Start Your GLP-1 <br /> Health Plan
                </h2>

                <p className={styles.card}>
                  <strong>What to Expect</strong>
                  <br />
                  <br />
                  OurGLP1 helps you stay on top of weekly injections, fasting
                  windows, workouts, hydration, protein targets, and more. It’s a
                  lightweight companion that keeps your plan tidy and your
                  reminders predictable.
                </p>
              </div>
            </SwiperSlide>

            {/* Slide 2 */}
            <SwiperSlide>
              <div className={styles.container}>
                <h2 className={styles.title}>Key Features</h2>

                <div className={styles.card}>
                  <ul className={styles.featureList}>
                    <li className={styles.featureItem}>
                      <span className={styles.featureIcon}>💉</span>
                      <span>
                        Medication Reminders — weekly injection alerts (on-device
                        push)
                      </span>
                    </li>
                    <li className={styles.featureItem}>
                      <span className={styles.featureIcon}>⏱️</span>
                      <span>
                        Fasting Support — start/stop nudges for simple, effective
                        fasting
                      </span>
                    </li>
                    <li className={styles.featureItem}>
                      <span className={styles.featureIcon}>🏋️</span>
                      <span>
                        Exercise Planning — plan workouts and track consistency
                      </span>
                    </li>
                    <li className={styles.featureItem}>
                      <span className={styles.featureIcon}>♡</span>
                      <span>
                        Apple Health Sync — bring in steps, activity, sleep,
                        heart rate, and workouts with permission
                      </span>
                    </li>
                    <li className={styles.featureItem}>
                      <span className={styles.featureIcon}>💧</span>
                      <span>
                        Hydration &amp; Electrolytes — stay ahead of dryness &amp;
                        fatigue
                      </span>
                    </li>
                    <li className={styles.featureItem}>
                      <span className={styles.featureIcon}>🍳</span>
                      <span>Protein Targets — daily goals based on your weight</span>
                    </li>
                    <li className={styles.featureItem}>
                      <span className={styles.featureIcon}>🙂</span>
                      <span>Mood Tracking — one-tap logging to spot helpful patterns</span>
                    </li>
                    <li className={styles.featureItem}>
                      <span className={styles.featureIcon}>📆</span>
                      <span>
                        Weekly Overview — injections, fasting, workouts, hydration at
                        a glance
                      </span>
                    </li>
                  </ul>
                </div>

                <p className={styles.card}>
                  <strong>Why Weekly?</strong>
                  <br />
                  <br />
                  We anchor your routine to <em>your injection day &amp; time</em>.
                  That makes reminders and planning simple, consistent, and easy to
                  follow.
                </p>
              </div>
            </SwiperSlide>

            {/* Slide 3 */}
            <SwiperSlide>
              <div className={styles.container}>
                <h2 className={styles.title}>Quick Setup</h2>

                <p className={styles.card}>
                  <strong>3 Simple Steps</strong>
                  <br />
                  <br />
                  • Choose your injection day/time to anchor your week.
                  <br />
                  • Enable reminders so nothing slips.
                  <br />
                  • Connect Apple Health if you want steps, activity, sleep,
                  heart rate, and workouts included in your daily view.
                </p>

                <p className={styles.card}>
                  <strong>Apple Health Sync</strong>
                  <br />
                  <br />
                  With your permission, OurGLP1 can read supported Apple Health data.
                  That can include activity recorded by Apple Watch through Apple Health.
                </p>

                <div className={styles.card}>
                  <strong>Weekly Summary</strong>
                  <br />
                  <br />
                  Save a weekly summary image with key charts and highlights
                  straight to your device’s photo library — then optionally clear
                  last week’s routine logs for a fresh start.
                  <br />
                  <br />
                  <IonButton
                    routerLink="/coach"
                    expand="block"
                    className={styles.blockBtn}
                  >
                    Start setup
                  </IonButton>
                  <IonButton
                    routerLink="/coach"
                    expand="block"
                    fill="outline"
                    className={styles.blockBtn}
                  >
                    Open Coach
                  </IonButton>
                </div>

                <p className={styles.card}>
                  <strong>Smart Timezones</strong>
                  <br />
                  <br />
                  Travel or switch phones without losing your schedule. Reminders
                  follow your chosen timezone settings.
                </p>
              </div>
            </SwiperSlide>

            {/* Slide 4 */}
            <SwiperSlide>
              <div className={styles.container}>
                <h2 className={styles.title}>Get Started</h2>

                <div className={styles.card}>
                  <strong>Set Up Your Profile</strong>
                  <br />
                  <br />
                  Add your medication, dose, height/weight, reminder preferences, and
                  choose whether to connect Apple Health.
                  <br />
                  <br />
                  <IonButton
                    routerLink="/coach"
                    expand="block"
                    className={styles.blockBtn}
                  >
                    Start setup
                  </IonButton>
                </div>

                <div className={styles.card}>
                  <strong>Plan &amp; Reminders</strong>
                  <br />
                  <br />
                  Review your weekly plan, Apple Health activity, and notifications to stay consistent.
                  <br />
                  <br />
                  <IonButton
                    routerLink="/coach"
                    expand="block"
                    className={styles.blockBtn}
                  >
                    Open Coach
                  </IonButton>
                </div>

                <div className={styles.card}>
                  <strong>Subscribe</strong>
                  <br />
                  <br />
                  OurGLP1 Pro is available for $4.99/month or $39.99/year, with final
                  local App Store pricing shown before purchase.
                  <br />
                  <br />
                  <IonButton
                    onClick={() => history.replace('/coach')}
                    expand="block"
                    className={styles.blockBtn}
                  >
                    Start setup
                  </IonButton>
                </div>
              </div>
            </SwiperSlide>

            {/* Slide 5 */}
            <SwiperSlide>
              <div className={styles.container}>
                <h2 className={styles.title}>Helpful Links</h2>

                <div className={styles.card}>
                  <ul className={styles.linkList}>
                    <li>
                      <Link to="/information">More Information</Link>
                    </li>
                    <li>
                      <Link to="/privacy">Privacy Policy</Link>
                    </li>
                    <li>
                      <Link to="/support">Support</Link>
                    </li>
                    <li>
                      <Link to="/settings">Settings</Link>
                    </li>
                  </ul>
                </div>

                {/* Delete Account & Data (local-only) */}
                <div className={styles.card}>
                  <strong>Delete Account &amp; Data</strong>

                  <p className={styles.cardP}>
                    This app stores your data <b>locally on your device only</b>.
                    Deleting your account will permanently remove your data from
                    this device. There is currently no cloud backup or external
                    server.
                  </p>

                  <p className={styles.cardP}>
                    Apple Health sync is optional. You can change Health permissions
                    from the Health app at any time.
                  </p>

                  <p className={styles.cardP}>
                    To delete your account at any time, go to{' '}
                    <em>Settings → Delete Account</em> and confirm. This action
                    cannot be undone.
                  </p>

                  <div className={styles.mt12}>
                    <IonButton
                      routerLink="/settings"
                      expand="block"
                      fill="outline"
                      color="danger"
                    >
                      Open Settings to Delete Account
                    </IonButton>
                  </div>
                </div>

                <div className={styles.pt8}>
                  <IonButton
                    onClick={() => history.replace('/coach')}
                    expand="block"
                  >
                    Start setup
                  </IonButton>
                </div>

                <div aria-hidden className={styles.endSpacer} />
              </div>
            </SwiperSlide>
          </Swiper>
        </div>
      </IonContent>

      {/* fixed bottom nav */}
      <BottomNav />
    </IonPage>
  );
};

export default LandingPage;








