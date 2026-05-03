// src/pages/Goodbye.tsx
import React from 'react';
import { IonButton } from '@ionic/react';
import styles from './Goodbye.module.css';

const Goodbye: React.FC = () => {
  return (
    <div className={styles.container}>
      <h2 className={styles.title}>Your account has been deleted</h2>

      <p className={styles.body}>
        We’ve removed your account and personal data from our active systems.
        Routine backups purge on their next rotation (generally within 30–90 days).
      </p>

      <IonButton expand="block" routerLink="/login">
        Back to Login
      </IonButton>

      <IonButton
        expand="block"
        fill="outline"
        href="mailto:support@ourglp1.com"
        className={styles.contactBtn}
      >
        Contact Support
      </IonButton>
    </div>
  );
};

export default Goodbye;
