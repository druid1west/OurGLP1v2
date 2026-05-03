import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/useAuth';
import { IonButton, IonSelect, IonSelectOption, IonLabel, IonItem } from '@ionic/react';
import styles from './UnifiedMobileStyles.module.css';

const FastingSchedule: React.FC = () => {
  const { user, loading } = useAuth();
  const [fastingSchedule, setFastingSchedule] = useState<string>('');
  const [fastingStart, setFastingStart] = useState<string>('20:00');  // Default start time
  const [fastingEnd, setFastingEnd] = useState<string>('08:00');  // Default end time

  // Available fasting schedules
  const availableSchedules = [
    { name: '16:8', start: '20:00', end: '08:00' },
    { name: '18:6', start: '18:00', end: '12:00' },
    { name: '20:4', start: '20:00', end: '16:00' },
  ];

  useEffect(() => {
    if (user) {
      // Load current fasting schedule from user data
      setFastingSchedule(user.fasting_schedule || '');
      setFastingStart(user.fasting_start || '20:00');
      setFastingEnd(user.fasting_end || '08:00');
    }
  }, [user]);

  const handleSaveFastingSchedule = async () => {
    try {
      const res = await fetch('https://app.ourglp1.com/user/fasting-schedule', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fasting_schedule: fastingSchedule,
          fasting_start: fastingStart,
          fasting_end: fastingEnd,
        }),
      });

      if (!res.ok) throw new Error('Failed to save fasting schedule');

      alert('Fasting schedule updated successfully');
    } catch (err) {
      console.error('Error saving fasting schedule:', err);
      alert('Failed to save fasting schedule');
    }
  };

  if (loading) return <p>Loading...</p>;

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>Manage Fasting Schedule</h2>

      {/* Fasting Schedule Selector */}
      <IonItem>
        <IonLabel position="stacked">Fasting Schedule</IonLabel>
        <IonSelect
          value={fastingSchedule}
          onIonChange={e => setFastingSchedule(e.detail.value)}
        >
          {availableSchedules.map((schedule) => (
            <IonSelectOption key={schedule.name} value={schedule.name}>
              {schedule.name} ({schedule.start} - {schedule.end})
            </IonSelectOption>
          ))}
        </IonSelect>
      </IonItem>

      {/* Fasting Start Time */}
      <IonItem>
        <IonLabel position="stacked">Fasting Start Time</IonLabel>
        <IonSelect
          value={fastingStart}
          onIonChange={e => setFastingStart(e.detail.value)}
        >
          {/* Add more times if needed */}
          <IonSelectOption value="20:00">20:00</IonSelectOption>
          <IonSelectOption value="18:00">18:00</IonSelectOption>
          <IonSelectOption value="16:00">16:00</IonSelectOption>
          <IonSelectOption value="12:00">12:00</IonSelectOption>
        </IonSelect>
      </IonItem>

      {/* Fasting End Time */}
      <IonItem>
        <IonLabel position="stacked">Fasting End Time</IonLabel>
        <IonSelect
          value={fastingEnd}
          onIonChange={e => setFastingEnd(e.detail.value)}
        >
          {/* Add more times if needed */}
          <IonSelectOption value="08:00">08:00</IonSelectOption>
          <IonSelectOption value="12:00">12:00</IonSelectOption>
          <IonSelectOption value="16:00">16:00</IonSelectOption>
          <IonSelectOption value="18:00">18:00</IonSelectOption>
        </IonSelect>
      </IonItem>

      {/* Save Button */}
      <IonButton expand="full" onClick={handleSaveFastingSchedule}>Save Fasting Schedule</IonButton>
    </div>
  );
};

export default FastingSchedule;