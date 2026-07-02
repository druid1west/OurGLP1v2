// src/pages/InfoDeepDive.tsx
import React from 'react';
import { IonPage, IonContent } from '@ionic/react';
import { Link } from 'react-router-dom';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Pagination } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/pagination';

import TopNav from '../context/TopNav';
import BottomNav from '../context/BottomNav';
import styles from './Information.module.css';

const InfoDeepDive: React.FC = () => {
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
          {/* Slide 1: Inflammation / Breast cancer / Cardiac / Alcohol / What's next / Coaching Code */}
          <SwiperSlide>
            <div className={styles.slideScroll}>
            <div className={styles.container}>
              <div className={styles.eyebrow}>Overview</div>
              <h2 className={styles.h2}>GLP-1s: Beyond Weight Loss</h2>

              <div className={styles.card}>
                ⭐ GLP-1s and Inflammation
                <br />
                Research is exploring anti-inflammatory and metabolic effects of
                GLP-1 medicines.
                <br />
                Evidence varies by condition and medication, so this is general
                education only.
                <br />
                ⚠️ Not a substitute for medical treatment.
                <br />
                💪 Keep your basics strong: nutrition, protein, movement, hydration.
              </div>

              <div className={styles.dividerDashed} />

              <div className={styles.card}>
                💖 GLP-1s and Breast Cancer Support
                <br />
                Studies are exploring weight, insulin, and metabolic health during
                or after treatment.
                <br />
                ⚠️ Not a cancer therapy — always coordinate with your oncology team.
              </div>

              <div className={styles.dividerDashed} />

              <div className={styles.card}>
                ❤️️ GLP-1s After a Heart Attack
                <br />
                Some GLP-1 medicines have cardiovascular indications or trial data
                in specific high-risk groups.
                <br />
                ⚠️ Works best with cardiac rehab, medication, and strength training.
              </div>

              <div className={styles.dividerDashed} />

              <div className={styles.card}>
                🍷 GLP-1s and Alcohol Cravings
                <br />
                Early research is exploring whether GLP-1 medicines affect craving
                and reward pathways.
                <br />
                ⚠️ They make it easier to change — they don’t replace support,
                therapy, or accountability.
              </div>

              <div className={styles.dividerDashed} />

              <div className={styles.card}>
                🌟 What’s Next
                <br />
                New incretin drugs are being studied:
                <ul className={styles.bullets}>
                  <li>Amycretin (GLP-1 + amylin) — under clinical study.</li>
                  <li>
                    Retatrutide (GLP-1 + GIP + glucagon) — under clinical study.
                  </li>
                </ul>
                💡 These next-gen versions are powerful — but the foundation remains
                the same: protein, strength, hydration, and self-awareness.
              </div>

              <div className={styles.card}>The GLP-1 Coaching Code</div>

              <div className={styles.card}>
                Firstly:
                <ul className={styles.bullets}>
                  <li>How They Work</li>
                  <li>Mimic a natural gut hormone that tells your brain you’re full.</li>
                  <li>Slow stomach emptying so you stay satisfied longer.</li>
                  <li>Improve insulin sensitivity and blood sugar control.</li>
                  <li>Originally for diabetes — weight loss was the bonus.</li>
                  <li>Help your body reset how it manages energy and appetite.</li>
                </ul>
              </div>

              <div className={styles.card}>
                💡 They’re a tool, not magic.
                <br />
                For steady, healthy results you still need:
                <ul className={styles.bullets}>
                  <li>Balanced nutrition and adequate protein</li>
                  <li>Weight-bearing exercise</li>
                  <li>Enough fluids and electrolytes</li>
                  <li>Sufficient calories to lose weight safely, not suddenly</li>
                </ul>
              </div>

              <div className={styles.card}>
                OurGLP1 can also use optional Apple Health sync to bring in steps,
                activity, sleep, heart rate, and workouts. If you use Apple Watch,
                that activity can appear in the app through Apple Health.
              </div>
            </div>
            </div>
          </SwiperSlide>

          {/* Slide 2: Page 2 — Using GLP-1s Safely (first version) */}
          <SwiperSlide>
            <div className={styles.slideScroll}>
            <div className={styles.container}>
              <div className={styles.eyebrow}>Page 2</div>
              <h2 className={styles.h2}>Using GLP-1s Safely</h2>

              <div className={styles.card}>
                Using GLP-1s Safely
                <ul className={styles.bullets}>
                  <li>
                    Follow your prescription instructions and ask your prescriber
                    before changing dose timing or amount.
                  </li>
                  <li>
                    Very low intake can make nutrition, hydration, and energy harder
                    to maintain. Ask your clinician if eating feels difficult.
                  </li>
                  <li>
                    Prioritise protein, but don’t live on it — your body also needs
                    healthy fats, complex carbs, fibre, and micronutrients.
                  </li>
                  <li>
                    Do resistance or weight-bearing exercise to maintain muscle and
                    skin tone.
                  </li>
                  <li>
                    Stay hydrated and replace electrolytes, especially if your
                    appetite is low.
                  </li>
                  <li>Track energy, mood, and strength — not just the number on the scale.</li>
                  <li>
                    If side effects feel hard to manage, do not push through alone:
                    contact your prescriber or clinician.
                  </li>
                </ul>
              </div>

              <div className={styles.card}>
                💡 GLP-1 medications work best when you fuel, move, maintain muscle,
                hydrate, and listen to your body.
              </div>
            </div>
            </div>
          </SwiperSlide>

          

          {/* Slide : Page 3 — Rapid weight loss */}
          <SwiperSlide>
            <div className={styles.slideScroll}>
            <div className={styles.container}>
              <div className={styles.eyebrow}>Page 3</div>
              <h2 className={styles.h2}>What Happens With Rapid Weight Loss</h2>

              <div className={styles.card}>
                You may not think about this right now but this medication is so
                effective at reducing appetite it’s easy to lose too quickly or too
                much. What Happens With Rapid Weight Loss
              </div>

              <div className={styles.card}>
                Losing weight too fast feels like progress — but it causes
                dehydration, muscle loss, and metabolic slowdown.
              </div>

              <div className={styles.card}>
                Here’s what happens:
                <ul className={styles.bullets}>
                  <li>You lose muscle and water, not just fat.</li>
                  <li>
                    When you dehydrate, you feel awful — nauseous, dizzy,
                    fuzzy-headed, low energy.
                  </li>
                  <li>💧 Take electrolytes every day — especially when eating less.</li>
                  <li>Your metabolism slows, so your body burns fewer calories.</li>
                  <li>Your prescriber can help review whether your current routine is still appropriate.</li>
                  <li>Habits around food, hydration, movement, and sleep still matter for long-term maintenance.</li>
                  <li>
                    You start relying on appetite suppression rather than learning to
                    make the changes needed to fix your insulin resistance and learn
                    how to eat differently.
                  </li>
                  <li>
                    Without the understanding, mindset and habit change, you’ll
                    struggle to reduce or maintain once you come off it.
                  </li>
                </ul>
              </div>

              <div className={styles.card}>
                💡 Medication is only one part of the picture.
                <br />
                Your prescriber can help you use your medication safely while you
                build habits that support nutrition, movement, hydration, and sleep.
              </div>
            </div>
            </div>
          </SwiperSlide>

          {/* Slide 4: Page 4 — Horror stories + Getting back to healthy */}
          <SwiperSlide>
            <div className={styles.slideScroll}>
            <div className={styles.container}>
              <div className={styles.eyebrow}>Page 4</div>
              <h2 className={styles.h2}>The horror stories!</h2>

              <div className={styles.card}>
                The horror stories!
                <br />
                Ozempic Face, Ozempic Bum &amp; Hair Loss
              </div>

              <div className={styles.card}>
                These side effects aren’t caused by GLP-1 medication.
                <br />
                They’re caused by rapid weight loss — by any method.
              </div>

              <div className={styles.card}>
                They’re linked in the press to GLP-1s because these meds often lead to
                rapid weight loss. If you don’t put in the protective measures it’s
                possible that it could happen to you.
                <br />
                If you look at other means of effective rapid and weight loss you will
                find exactly the same issues. Go into any surgical weight loss forum
                and it’s the same things being discussed. Hair loss, muscle loss,
                looking gaunt, weakness exactly the same problems being identified.
                They haven’t been taking GLP1 medication but they have lost weight
                rapidly.
              </div>

              <div className={styles.card}>
                But the good news and the truth is — they’re completely avoidable.
              </div>

              <div className={styles.card}>
                Here’s what’s really happening:
                <ul className={styles.bullets}>
                  <li>You’re losing muscle, water, and collagen along with fat.</li>
                  <li>Skin loses structure → face and bum look deflated.</li>
                  <li>Hair growth slows → shedding increases.</li>
                  <li>It’s not the drug — it’s the speed and imbalance of the weight loss.</li>
                </ul>
              </div>

              <div className={styles.card}>
                💡 If this has already happened — you can fix it.
                <br />
                But you’ll need to stop digging before you can climb out of the hole.
                <br />
                That means slowing the loss, fuelling your body properly, and rebuilding
                what you’ve stripped away. (see next page)
              </div>

              <div className={styles.card}>
                Getting Back to Healthy (Without Rebounding)
              </div>

              <div className={styles.card}>
                If you’ve gone too far — don’t panic.
                <br />
                You can steady things and rebuild your strength without losing your progress.
              </div>

              <div className={styles.card}>
                Here’s how to reset safely:
                <ul className={styles.bullets}>
                  <li>
                    Speak to your prescriber if weight loss feels too fast or side
                    effects are hard to manage.
                  </li>
                  <li>
                    Rehydrate. Take electrolytes daily — dehydration makes everything feel worse.
                  </li>
                  <li>
                    Rebuild muscle with protein and strength work. Ask your clinician
                    or dietitian for a personal protein target.
                  </li>
                  <li>
                    If you cannot tolerate protein or fluids, contact your clinician
                    before changing medication.
                  </li>
                  <li>
                    Prioritise muscle-building over cardio. Strength training protects your metabolism,
                    shape, and longevity.
                  </li>
                  <li>Use protein shakes smartly — as an extra boost, not a meal replacement.</li>
                  <li>Rest and recover. Repair time is when your body rebuilds and balances hormones.</li>
                </ul>
              </div>

              <div className={styles.card}>
                💡 This isn’t “undoing” your progress — it’s making it last.
                <br />
                Healthy weight loss keeps your body strong, hydrated, and capable.
              </div>
            </div>
            </div>
          </SwiperSlide>

          {/* Slide 5: Fasting + GLP-1 */}
          <SwiperSlide>
            <div className={styles.slideScroll}>
            <div className={styles.container}>
              <div className={styles.eyebrow}>Fasting</div>
              <h2 className={styles.h2}>Fasting + GLP-1 = Smarter Metabolism</h2>

              <div className={styles.card}>
                Fasting is a timing tool some people use, but it is not required and
                is not right for everyone.
                <br />
                If you use insulin, sulfonylureas, have diabetes, are pregnant, have
                a history of eating disorder, or have another medical condition, ask
                your clinician before fasting.
              </div>

              <div className={styles.card}>
                Here’s how to do it right:
                <ul className={styles.bullets}>
                  <li>If you choose to try fasting, start gently and use a schedule you can repeat safely.</li>
                  <li>Remember, most people taking GLP-1s were used to eating every few hours — your body needs time to adapt.</li>
                  <li>If fasting feels tough, shorten the window (4–6 hours) and build up slowly.</li>
                  <li>The goal is steady progress, not endurance.</li>
                  <li>When you eat, focus on protein, healthy fats, and complex carbs — proper fuel keeps your metabolism healthy.</li>
                  <li>Stay hydrated and take electrolytes during fasting hours.</li>
                  <li>If you feel light-headed or foggy, hydrate first and take electrolytes, then reassess before eating.</li>
                  <li>Avoid prolonged fasts unless specifically guided by a qualified clinician.</li>
                  <li>Combine fasting with strength or resistance training to protect muscle and stabilise metabolism.</li>
                </ul>
              </div>

              <div className={styles.card}>
                💡 Fasting + GLP-1 helps your metabolism work smarter, not harder.
                <br />
                You’re training your body to run efficiently — not starve it.
              </div>
            </div>
            </div>
          </SwiperSlide>

          {/* Slide 6: Latest research & proven benefits */}
          <SwiperSlide>
            <div className={styles.slideScroll}>
            <div className={styles.container}>
              <div className={styles.eyebrow}>Evidence</div>
              <h2 className={styles.h2}>Latest Research &amp; Proven Benefits of GLP-1s</h2>

              <div className={styles.card}>
                GLP-1 medications have different approved uses and evidence depending
                on the specific medicine and person.
              </div>

              <div className={styles.card}>
                Useful points to track and discuss with your care team:
                <ul className={styles.bullets}>
                  <li>Some medicines are approved for type 2 diabetes, chronic weight management, or cardiovascular risk reduction in specific groups.</li>
                  <li>Commonly tracked effects include appetite changes, nausea, vomiting, diarrhea, constipation, and hydration challenges.</li>
                  <li>Medication guides and clinician advice should lead decisions about missed doses, side effects, and safety concerns.</li>
                  <li>Protein, hydration, movement, and sleep tracking can help users prepare better care-team conversations.</li>
                </ul>
              </div>

              <div className={styles.card}>
                OurGLP1 helps you organize observations. It does not diagnose,
                prescribe, or recommend medication changes.
              </div>

              <div className={styles.card}>
                <strong>Sources:</strong>{' '}
                <Link to="/medical-sources">Medical Sources &amp; Citations</Link>
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

export default InfoDeepDive;
