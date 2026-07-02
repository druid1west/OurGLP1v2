import React from 'react';
import { IonContent, IonPage } from '@ionic/react';

import TopNav from '../context/TopNav';
import BottomNav from '../context/BottomNav';
import styles from './PrivacyPolicy.module.css';

const link = (href: string, label: string): React.ReactElement => (
  <a className={styles.link} href={href} target="_blank" rel="noopener noreferrer">
    {label}
  </a>
);

const MedicalSources: React.FC = () => {
  return (
    <IonPage>
      <TopNav showWhenAnon />
      <IonContent fullscreen className={styles.contentPad}>
        <div className={styles.container}>
          <h2 className={styles.title}>Medical Sources</h2>
          <p className={styles.updated}>Last updated: July 2, 2026</p>

          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>Important Safety Note</h3>
            <p className={styles.body}>
              OurGLP1 is a private tracking and organization tool. It does not diagnose,
              prescribe, recommend dose changes, or replace professional medical advice. Always
              follow your prescription label and speak with your doctor, pharmacist, or qualified
              clinician before making medical decisions.
            </p>
          </section>

          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>Medication Information</h3>
            <ul className={styles.list}>
              <li>{link('https://medlineplus.gov/druginfo/meds/a618008.html', 'MedlinePlus: Semaglutide Injection')}</li>
              <li>{link('https://medlineplus.gov/druginfo/meds/a622044.html', 'MedlinePlus: Tirzepatide Injection')}</li>
              <li>{link('https://medlineplus.gov/druginfo/meds/a611003.html', 'MedlinePlus: Liraglutide Injection')}</li>
              <li>{link('https://www.fda.gov/Safety/MedWatch', 'FDA MedWatch: Report serious side effects')}</li>
              <li>{link('https://www.accessdata.fda.gov/scripts/cder/daf/', 'FDA: Drugs@FDA')}</li>
            </ul>
            <p className={styles.body}>
              These sources support general medication education and safety language. OurGLP1 does
              not calculate, suggest, or change medication doses.
            </p>
          </section>

          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>BMI, Activity, and Weight Management</h3>
            <ul className={styles.list}>
              <li>{link('https://www.cdc.gov/bmi/adult-calculator/bmi-categories.html', 'CDC: Adult BMI Categories')}</li>
              <li>{link('https://www.cdc.gov/physical-activity-basics/guidelines/adults.html', 'CDC: Adult Physical Activity Guidelines')}</li>
              <li>{link('https://www.niddk.nih.gov/health-information/weight-management/tips-get-active/tips-starting-physical-activity', 'NIDDK: Tips for Starting Physical Activity')}</li>
            </ul>
            <p className={styles.body}>
              The app uses these references for general BMI display, movement tracking, and activity
              education. These displays are informational and are not a diagnosis.
            </p>
          </section>

          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>Nutrition, Protein, and Macros</h3>
            <ul className={styles.list}>
              <li>{link('https://www.dietaryguidelines.gov/', 'Dietary Guidelines for Americans')}</li>
              <li>{link('https://www.myplate.gov/eat-healthy/protein-foods', 'USDA MyPlate: Protein Foods')}</li>
              <li>{link('https://www.myplate.gov/eat-healthy/food-group-gallery', 'USDA MyPlate: Food Group Gallery')}</li>
              <li>{link('https://fdc.nal.usda.gov/', 'USDA FoodData Central')}</li>
            </ul>
            <p className={styles.body}>
              Protein, carbohydrate, fat, and calorie values in the app are planning estimates.
              Food examples use rounded common serving sizes and should be treated as approximate,
              because brand, recipe, preparation method, and portion size can change actual values.
            </p>
          </section>

          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>Hydration</h3>
            <ul className={styles.list}>
              <li>{link('https://www.cdc.gov/healthy-weight-growth/water-healthy-drinks/index.html', 'CDC: Water and Healthier Drinks')}</li>
              <li>{link('https://www.nal.usda.gov/human-nutrition-and-food-safety/dri-calculator', 'USDA: Dietary Reference Intakes Calculator')}</li>
            </ul>
            <p className={styles.body}>
              Hydration tracking is a personal logging tool. Fluid needs vary by body size,
              activity, climate, health conditions, and clinician guidance.
            </p>
          </section>

          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>Sleep</h3>
            <ul className={styles.list}>
              <li>{link('https://www.cdc.gov/sleep/about/index.html', 'CDC: About Sleep')}</li>
              <li>{link('https://www.nhlbi.nih.gov/health/sleep-deprivation', 'NIH/NHLBI: Sleep Deprivation and Deficiency')}</li>
            </ul>
            <p className={styles.body}>
              Sleep views are for routine tracking only. They should not be used to diagnose sleep
              disorders or replace medical evaluation.
            </p>
          </section>

          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>Fasting and Meal Timing</h3>
            <ul className={styles.list}>
              <li>{link('https://www.nia.nih.gov/news/research-intermittent-fasting-shows-health-benefits', 'NIH/NIA: Research on Intermittent Fasting')}</li>
              <li>{link('https://www.niddk.nih.gov/health-information/weight-management/choosing-a-safe-successful-weight-loss-program', 'NIDDK: Choosing a Safe and Successful Weight-loss Program')}</li>
            </ul>
            <p className={styles.body}>
              Fasting windows in OurGLP1 are user-defined schedule reminders. The app does not
              prescribe fasting and does not tell users when they must eat or stop eating.
            </p>
          </section>

          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>Apple Health and Activity Data</h3>
            <ul className={styles.list}>
              <li>{link('https://developer.apple.com/documentation/healthkit', 'Apple Developer: HealthKit')}</li>
              <li>{link('https://support.apple.com/guide/iphone/view-health-and-fitness-information-iphe3d379c32/ios', 'Apple Support: View Health and Fitness Information')}</li>
            </ul>
            <p className={styles.body}>
              With permission, OurGLP1 can read supported Apple Health values such as steps, active
              calories, exercise minutes, sleep, heart rate, and workouts. The app displays the data
              supplied by Apple Health and does not independently validate sensor accuracy.
            </p>
          </section>

          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>How These Sources Are Used</h3>
            <p className={styles.body}>
              The app uses these references to support general education about medication tracking,
              symptom logging, BMI display, physical activity, nutrition planning, hydration, sleep,
              and Apple Health data display. Any estimates shown in the app are for personal
              organization only. Users should confirm medical, nutrition, and medication decisions
              with a qualified professional.
            </p>
          </section>
        </div>
      </IonContent>
      <BottomNav showWhenAnon />
    </IonPage>
  );
};

export default MedicalSources;
