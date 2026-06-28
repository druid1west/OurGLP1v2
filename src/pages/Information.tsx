// src/pages/Info.tsx
import React from 'react';
import { IonPage, IonContent, IonButton } from '@ionic/react';
import { Link, useHistory } from 'react-router-dom';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Pagination } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/pagination';

import TopNav from '../context/TopNav';
import BottomNav from '../context/BottomNav';
import styles from './Information.module.css';

const Info: React.FC = () => {
  const history = useHistory();

  return (
    <IonPage>
      <TopNav showWhenAnon />

      <IonContent fullscreen className="viewportBetweenNavs" scrollY={false}>
<Swiper
modules={[Pagination]}
pagination={{ clickable: true }}
spaceBetween={24}
slidesPerView={1}
className={styles.swiper}
        >
          {/* Slide 1: How GLP-1 works */}
          <SwiperSlide>
            <div className={styles.slideScroll}>
            <div className={styles.container}>
              <div className={styles.center}>
                <img
                  src="/assets/info/glp1-hormone.png"
                  alt="Illustration of GLP-1 hormone signaling between gut and pancreas"
                  className={styles.heroImg}
                />
              </div>

              <div className={styles.eyebrow}>Basics</div>
              <h2 className={styles.h2}>How GLP-1 Medicines Work</h2>

              <div className={styles.card}>
                GLP-1 (glucagon-like peptide-1) is a natural gut hormone released
                after you eat. GLP-1 medicines amplify this signal to:
                <ul className={styles.bullets}>
                  <li>help your pancreas release insulin when glucose is high,</li>
                  <li>quiet excess glucagon (reduces liver sugar release), and</li>
                  <li>slow stomach emptying (you feel full sooner, for longer).</li>
                </ul>
                That combo lowers appetite, improves post-meal blood sugar spikes,
                and supports steady weight loss.
              </div>

              <div className={styles.card}>
                <strong>Good to know:</strong> fullness and slower digestion are
                intended effects, but they’re also why some people feel “sloshy,”
                burpy, or a bit nauseated at first.
              </div>
            </div>
            </div>
          </SwiperSlide>

          {/* Slide 2: Start low, go slow */}
          <SwiperSlide>
            <div className={styles.slideScroll}>
            <div className={styles.container}>
              <div className={styles.center}>
                <img
                  src="/assets/info/start-low-go-slow.png"
                  alt="Chart showing gradual dose increases over time"
                  className={styles.heroImg}
                />
              </div>

              <div className={styles.eyebrow}>Titration</div>
              <h2 className={styles.h2}>Why Too Much Too Soon Feels Rough</h2>

              <div className={styles.card}>
                Your GI tract needs time to adapt. Jumping straight to a higher
                dose can cause:
                <ul className={styles.bullets}>
                  <li>nausea or vomiting,</li>
                  <li>bloating, heartburn, or constipation,</li>
                  <li>low energy from under-eating.</li>
                </ul>
                <strong>Best practice:</strong> start low, go slow, and wait at
                least 4 weeks between dose increases. If side effects spike,
                pause at the current dose (or step down) and stabilize.
              </div>

              <div className={styles.card}>
                <strong>Small meal rules of thumb:</strong> eat slowly, stop at
                “satisfied not stuffed,” and avoid heavy, greasy meals on
                injection day.
              </div>
            </div>
            </div>
          </SwiperSlide>

          {/* Slide 3: Intermittent fasting */}
          <SwiperSlide>
            <div className={styles.slideScroll}>
            <div className={styles.container}>
              <div className={styles.center}>
                <img
                  src="/assets/info/fasting-window.png"
                  alt="Clock graphic showing a simple fasting window"
                  className={styles.heroImg}
                />
              </div>

              <div className={styles.eyebrow}>Timing</div>
              <h2 className={styles.h2}>How Intermittent Fasting Helps</h2>

              <div className={styles.card}>
                Fasting isn’t about eating as little as possible—it’s about{' '}
                <em>when</em> you eat. A consistent 12–16 h fasting window can:
                <ul className={styles.bullets}>
                  <li>smooth appetite (pairs well with GLP-1 fullness),</li>
                  <li>improve insulin sensitivity,</li>
                  <li>simplify your routine (fewer decisions).</li>
                </ul>
                Choose a window you can repeat most days (e.g., 8 pm → 12 pm). On
                tough days, a shorter fast still counts.
              </div>

              <div className={styles.card}>
                <strong>Gentle start:</strong> begin with 12 h for a week, then
                move toward 14–16 h as you feel ready.
              </div>
            </div>
            </div>
          </SwiperSlide>

          {/* Slide 4: Hydration & electrolytes */}
          <SwiperSlide>
            <div className={styles.slideScroll}>
            <div className={styles.container}>
              <div className={styles.center}>
                <img
                  src="/assets/info/hydration.png"
                  alt="Glass of water with electrolyte powder"
                  className={styles.heroImg}
                />
              </div>

              <div className={styles.eyebrow}>Fluids</div>
              <h2 className={styles.h2}>Hydration &amp; Electrolytes</h2>

              <div className={styles.card}>
                GLP-1s and fasting can blunt thirst cues. Aim for steady fluids
                through the day. If you notice headaches, fatigue, dizziness, or
                muscle cramps, add electrolytes (sodium, potassium, magnesium).
              </div>

              <div className={styles.card}>
                <strong>Targets:</strong> a simple goal is ~30–35 ml/kg/day water,
                and a light electrolyte mix during long fasts, hot days, or
                workouts.
              </div>
            </div>
            </div>
          </SwiperSlide>

          {/* Slide 5: Protein & muscle */}
          <SwiperSlide>
            <div className={styles.slideScroll}>
            <div className={styles.container}>
              <div className={styles.center}>
                <img
                  src="/assets/info/protein-plate.png"
                  alt="High-protein plate with eggs, yogurt, legumes, and greens"
                  className={styles.heroImg}
                />
              </div>

              <div className={styles.eyebrow}>Nutrition</div>
              <h2 className={styles.h2}>Protein Protects Your Lean Mass</h2>

              <div className={styles.card}>
                Weight loss can include muscle loss unless you protect it. A
                practical daily protein target is
                <strong> ~1.6–2.2 g per kg body weight</strong> (or discuss a
                personalized goal with your clinician). Distribute protein across
                meals to stay full and recover better from workouts.
              </div>

              <div className={styles.card}>
                <strong>Easy wins:</strong> eggs, Greek yogurt, cottage cheese,
                fish, lean meats, tofu/tempeh, beans + grains.
              </div>
            </div>
            </div>
          </SwiperSlide>

          {/* Slide 6: Strength training */}
          <SwiperSlide>
            <div className={styles.slideScroll}>
            <div className={styles.container}>
              <div className={styles.center}>
                <img
                  src="/assets/info/strength.png"
                  alt="Dumbbells beside a workout notebook"
                  className={styles.heroImg}
                />
              </div>

              <div className={styles.eyebrow}>Training</div>
              <h2 className={styles.h2}>Lift (A Little) to Keep (A Lot)</h2>

              <div className={styles.card}>
                2–3 short sessions per week (20–30 min) of full-body strength
                training helps maintain muscle, bones, and metabolism. Use RPE
                (perceived effort): last 2 reps should feel challenging but
                doable.
              </div>

              <div className={styles.card}>
                <strong>Starter plan:</strong> squats or sit-to-stands, push-ups
                (wall/knee), rows/bands, hip hinges, carries. Add a walk or gentle
                cardio for recovery and mood.
              </div>
            </div>
            </div>
          </SwiperSlide>

          {/* Slide 7: Bowel regularity */}
          <SwiperSlide>
            <div className={styles.slideScroll}>
            <div className={styles.container}>
              <div className={styles.center}>
                <img
                  src="/assets/info/digestion.png"
                  alt="Simple gut graphic emphasizing slow gastric emptying"
                  className={styles.heroImg}
                />
              </div>

              <div className={styles.eyebrow}>Digestion</div>
              <h2 className={styles.h2}>Keep Things Moving</h2>

              <div className={styles.card}>
                GLP-1s slow gastric emptying, which can slow the “whole line.” To
                help:
                <ul className={styles.bullets}>
                  <li>drink regularly and walk daily,</li>
                  <li>prioritize fiber from plants (and/or a gentle supplement),</li>
                  <li>limit big, greasy meals and large late-night snacks.</li>
                </ul>
                If constipation or reflux persists, pause dose escalation and
                talk to your clinician about options.
              </div>
            </div>
            </div>
          </SwiperSlide>

          {/* Slide 8: Blood sugar checks */}
          <SwiperSlide>
            <div className={styles.slideScroll}>
            <div className={styles.container}>
              <div className={styles.center}>
                <img
                  src="/assets/info/glucose-check.png"
                  alt="Fingerstick glucose meter on a table"
                  className={styles.heroImg}
                />
              </div>

              <div className={styles.eyebrow}>Glucose</div>
              <h2 className={styles.h2}>Why Blood Sugar Checks Still Matter</h2>

              <div className={styles.card}>
                GLP-1s improve glucose after meals, but checks help you:
                <ul className={styles.bullets}>
                  <li>spot low blood sugar if combined with insulin or sulfonylureas,</li>
                  <li>see which meals spike you most,</li>
                  <li>confirm progress as appetite and weight change.</li>
                </ul>
                If you do get lows (shaky, sweaty, foggy), follow the 15-15 rule:
                take ~15 g fast carbs, recheck in 15 min.
              </div>

              <div className={styles.card}>
                <strong>When to check:</strong> before breakfast, 2 hours after
                meals, or any time you feel “off.”
              </div>
            </div>
            </div>
          </SwiperSlide>

          {/* Slide 9: Quick actions / links */}
          <SwiperSlide>
            <div className={styles.slideScroll}>
            <div className={styles.container}>
              <div className={styles.eyebrow}>Sync</div>
              <h2 className={styles.h2}>Apple Health &amp; Apple Watch Activity</h2>

              <div className={styles.card}>
                OurGLP1 can optionally read supported Apple Health data with your permission,
                including steps, active calories, exercise minutes, sleep, heart rate, and
                workouts. If you use Apple Watch, activity recorded there can appear in
                OurGLP1 through Apple Health.
              </div>

              <div className={styles.card}>
                Health sync is for tracking and review only. OurGLP1 does not diagnose,
                prescribe, recommend dosing, or replace professional medical advice.
              </div>
            </div>
            </div>
          </SwiperSlide>

          {/* Slide 10: Quick actions / links */}
          <SwiperSlide>
            <div className={styles.slideScroll}>
            <div className={styles.container}>
              <div className={styles.center}>
                <img
                  src="/assets/info/overview.png"
                  alt="Calendar overview of injections, fasting, workouts, and reminders"
                  className={styles.heroImg}
                />
              </div>

              <h2 className={styles.h2}>Make It Yours</h2>

              <div className={styles.card}>
                <strong>Set Up Your Profile</strong>
                <br />
                Add your medication, dose, height/weight, and reminder preferences.
                <div className={styles.mt12}>
                  <IonButton routerLink="/coach" expand="block">
                    Start setup
                  </IonButton>
                </div>
              </div>

              <div className={styles.card}>
                <strong>Delete Account &amp; Data</strong>
                <p className={styles.p6}>
                  This app stores your data <b>locally on your device only</b>.
                  Deleting your account will permanently remove your data from
                  this device. There is currently no cloud backup or external
                  server.
                </p>
                <p className={styles.p6}>
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

              <div className={styles.card}>
                <strong>Plan &amp; Reminders</strong>
                <br />
                Review your weekly plan and enable notifications to stay consistent.
                <div className={styles.mt12}>
                  <IonButton routerLink="/coach" expand="block">
                    Start setup
                  </IonButton>
                </div>
              </div>

              <div className={styles.card}>
                <strong>Helpful Links</strong>
                <ul className={styles.bullets}>
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

              <div className={styles.mt12}>
                <IonButton onClick={() => history.replace('/coach')} expand="block">
                  Start setup
                </IonButton>
              </div>

              <div aria-hidden className={styles.endSpacer} />
            </div>
            </div>
          </SwiperSlide>
        </Swiper>
      </IonContent>

      <BottomNav showWhenAnon />
    </IonPage>
  );
};

export default Info;
