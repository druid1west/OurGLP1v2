// src/pages/UpdateRequired.tsx
import React from 'react';
import { IonPage, IonContent, IonButton } from '@ionic/react';
import TopNav from '@/context/TopNav';
import BottomNav from '@/context/BottomNav';
import styles from './Login.module.css';

interface UpdateRequiredProps {
  latestVersion?: string | null;
  storeUrl: string;
}

const UpdateRequired: React.FC<UpdateRequiredProps> = ({ latestVersion, storeUrl }) => {
  const subtitle = latestVersion
    ? `A newer version of this app (${latestVersion}) is available.`
    : 'A newer version of this app is available.';

  return (
    <IonPage>
      <TopNav showWhenAnon />
      <IonContent fullscreen className={styles.contentPad}>
        <div className={styles.pageBg}>
          <div className={styles.container}>
            <h2 className={styles.title}>Update required</h2>

           <p className={styles.updateText}>
              {subtitle} Please update in the store to continue using OurGLP1.
            </p>

            <IonButton
              expand="block"
              className={`custom-button ${styles.updateBtn}`}
              href={storeUrl}
            >
              Update in store
            </IonButton>
          </div>
        </div>
      </IonContent>
      <BottomNav showWhenAnon />
    </IonPage>
  );
};

export default UpdateRequired;
