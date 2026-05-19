// src/pages/InfoDeepDive.tsx
import React from 'react';
import { IonPage, IonContent } from '@ionic/react';
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
                ✅ Early research shows anti-inflammatory effects — helpful in
                autoimmune and gut conditions.
                <br />
                ✅ Less inflammation = better recovery, energy, and joint comfort.
                <br />
                ⚠️ Still early evidence — not a substitute for medical treatment.
                <br />
                💪 Keep your basics strong: nutrition, protein, movement, hydration.
              </div>

              <div className={styles.dividerDashed} />

              <div className={styles.card}>
                💖 GLP-1s and Breast Cancer Support
                <br />
                🌿 Studies are exploring GLP-1s to help manage weight and insulin
                during or after treatment.
                <br />
                ✅ May support hormone balance and reduce recurrence risk via
                metabolic control.
                <br />
                ⚠️ Not a cancer therapy — always coordinate with your oncology team.
              </div>

              <div className={styles.dividerDashed} />

              <div className={styles.card}>
                ❤️️ GLP-1s After a Heart Attack
                <br />
                💪 Clinical trials show fewer heart attacks and strokes in high-risk
                patients on GLP-1s.
                <br />
                ✅ They improve cholesterol, reduce inflammation, and stabilise
                blood sugar.
                <br />
                ⚠️ Works best with cardiac rehab, medication, and strength training.
              </div>

              <div className={styles.dividerDashed} />

              <div className={styles.card}>
                🍷 GLP-1s and Alcohol Cravings
                <br />
                ✨ Early studies: GLP-1s reduce alcohol intake and craving.
                <br />
                ✅ Help reset reward pathways in the brain.
                <br />
                ⚠️ They make it easier to change — they don’t replace support,
                therapy, or accountability.
              </div>

              <div className={styles.dividerDashed} />

              <div className={styles.card}>
                🌟 What’s Next
                <br />
                🚀 New incretin drugs coming:
                <ul className={styles.bullets}>
                  <li>Amycretin (GLP-1 + amylin) — strong early results.</li>
                  <li>
                    Retatrutide (GLP-1 + GIP + glucagon) — even greater metabolic
                    effect in trials.
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
                    Start low and increase slowly — too high a dose causes rapid
                    weight loss and all the knock-on effects: fatigue, hair loss,
                    muscle loss, and that gaunt “Ozempic face.” (see next page)
                  </li>
                  <li>
                    Starving yourself will make you lose weight faster — but at the
                    cost of muscle, energy, hormones, and skin health. It’s not
                    worth the damage.
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
                    When the dose feels right, stay consistent; when it feels wrong,
                    don’t push through side effects.
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
                  <li>Short term: you’ll need bigger doses of GLP-1 medication to get the same effect.</li>
                  <li>Long term: you become dependent on the drug instead of changing habits.</li>
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
                💡 The medication isn’t failing — your approach is.
                <br />
                The goal is to take a dose that helps you implement the lifestyle
                changes that will allow your body to adapt and heal so you can reduce
                or come off the medication once you reach your target weight. This is
                possible and we are here to help you.
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
                    Pause the drop. Stay at your current dose or speak to your prescriber
                    before increasing.
                  </li>
                  <li>
                    Rehydrate. Take electrolytes daily — dehydration makes everything feel worse.
                  </li>
                  <li>
                    Start rebuilding muscle. Aim for 1g of protein per 1lb of your ideal body weight.
                  </li>
                  <li>
                    If you can’t face protein, your dose is too high — reduce your GLP-1 medication
                    until eating feels manageable.
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
                Fasting isn’t about eating less — it’s about giving your body space to reset insulin sensitivity and
                regain metabolic balance.
                <br />
                GLP-1 medication makes this easier by reducing hunger and stabilising blood sugar.
              </div>

              <div className={styles.card}>
                Here’s how to do it right:
                <ul className={styles.bullets}>
                  <li>Start with 14:10 or 16:8 — that’s enough to start improving insulin control and blood sugar stability.</li>
                  <li>Remember, most people taking GLP-1s were used to eating every few hours — your body needs time to adapt.</li>
                  <li>If fasting feels tough, shorten the window (4–6 hours) and build up slowly.</li>
                  <li>The goal is steady progress, not endurance.</li>
                  <li>When you eat, focus on protein, healthy fats, and complex carbs — proper fuel keeps your metabolism healthy.</li>
                  <li>Stay hydrated and take electrolytes during fasting hours.</li>
                  <li>If you feel light-headed or foggy, hydrate first and take electrolytes, then reassess before eating.</li>
                  <li>Deep cell repair (autophagy) only happens with much longer fasts — typically after 48–72 hours, and that’s not the goal here.</li>
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
                The evidence is stronger than ever — GLP-1 medications do far more than just help with weight loss.
              </div>

              <div className={styles.card}>
                Here’s what current research shows:
                <ul className={styles.bullets}>
                  <li>Improved insulin sensitivity — your body handles sugar better, reducing diabetes risk.</li>
                  <li>Lower inflammation — GLP-1s calm inflammatory markers linked to heart disease and fatigue.</li>
                  <li>Heart protection — studies show reduced risk of cardiovascular events, independent of weight loss.</li>
                  <li>Liver health — lower fat in the liver (NAFLD/NASH improvement).</li>
                  <li>Better energy regulation — steadier blood sugar = fewer crashes and cravings.</li>
                  <li>Possible brain protection — early data suggests lower risk of Alzheimer’s and cognitive decline.</li>
                  <li>Sustainable results — people who combine GLP-1s with protein, hydration, and strength training maintain up to 80% of their loss long term.</li>
                  <li>Psychological benefits — calmer appetite, better focus, improved relationship with food.</li>
                </ul>
              </div>

              <div className={styles.card}>
                💡 GLP-1s aren’t just for weight loss — they’re a metabolic reset tool.
                <br />
                When paired with the right habits, they help you stay healthy, strong, and clear-minded for life.
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
