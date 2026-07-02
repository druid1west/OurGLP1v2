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
          <h2 className={styles.title}>Medical Sources &amp; Citations</h2>
          <p className={styles.updated}>Last updated: July 2, 2026</p>

          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>Important Safety Note</h3>
            <p className={styles.body}>
              OurGLP1 is a private tracking and organization tool. It does not diagnose,
              prescribe, recommend dose changes, or replace professional medical advice. Always
              follow your prescription label and speak with your doctor, pharmacist, prescriber,
              or clinician before making medical decisions.
            </p>
          </section>

          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>Medication Information</h3>
            <ul className={styles.list}>
              <li>{link('https://medlineplus.gov/druginfo/meds/a618008.html', 'MedlinePlus: Semaglutide Injection')}</li>
              <li>{link('https://medlineplus.gov/druginfo/meds/a622044.html', 'MedlinePlus: Tirzepatide Injection')}</li>
              <li>{link('https://medlineplus.gov/druginfo/meds/a611003.html', 'MedlinePlus: Liraglutide Injection')}</li>
              <li>{link('https://www.fda.gov/Safety/MedWatch', 'FDA MedWatch: Report serious side effects')}</li>
            </ul>
          </section>

          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>BMI, Activity, and Weight Management</h3>
            <ul className={styles.list}>
              <li>{link('https://www.cdc.gov/bmi/adult-calculator/bmi-categories.html', 'CDC: Adult BMI Categories')}</li>
              <li>{link('https://www.cdc.gov/physical-activity-basics/guidelines/adults.html', 'CDC: Adult Physical Activity Guidelines')}</li>
              <li>{link('https://www.niddk.nih.gov/health-information/weight-management/tips-get-active/tips-starting-physical-activity', 'NIDDK: Tips for Starting Physical Activity')}</li>
            </ul>
          </section>

          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>How These Sources Are Used</h3>
            <p className={styles.body}>
              The app uses these references to support general education about GLP-1 medication
              tracking, common side-effect tracking, BMI display, physical activity, and when to
              contact a clinician. The app does not use these sources to calculate or recommend
              medication doses.
            </p>
          </section>
        </div>
      </IonContent>
      <BottomNav showWhenAnon />
    </IonPage>
  );
};

export default MedicalSources;
