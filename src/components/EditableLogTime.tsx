import React, { useEffect, useId, useState } from 'react';
import { IonButton, IonModal } from '@ionic/react';
import { Pencil } from 'lucide-react';

import {
  displayDateFromRecordedAt,
  displayTimeFromRecordedAt,
  maxTimeForRecordedAt,
  recordedAtWithTime,
  timeFromRecordedAt,
} from '../lib/healthLogTime';
import styles from './EditableLogTime.module.css';

type EditableLogTimeProps = {
  recordedAt: string;
  entryLabel: string;
  disabled?: boolean;
  onSave: (recordedAt: string) => Promise<void>;
};

const EditableLogTime: React.FC<EditableLogTimeProps> = ({
  recordedAt,
  entryLabel,
  disabled = false,
  onSave,
}) => {
  const id = useId().replace(/:/g, '');
  const titleId = `edit-log-time-title-${id}`;
  const inputId = `health-log-time-${id}`;
  const messageId = `edit-log-time-message-${id}`;
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(() => timeFromRecordedAt(recordedAt));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) setTime(timeFromRecordedAt(recordedAt));
  }, [open, recordedAt]);

  const dismiss = (): void => {
    if (saving) return;
    setOpen(false);
    setMessage('');
  };

  const save = async (): Promise<void> => {
    const result = recordedAtWithTime(recordedAt, time);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }

    setSaving(true);
    setMessage('');
    try {
      await onSave(result.value);
      setOpen(false);
    } catch {
      setMessage('Could not update that time yet. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={styles.timeButton}
        onClick={() => {
          setTime(timeFromRecordedAt(recordedAt));
          setMessage('');
          setOpen(true);
        }}
        disabled={disabled}
        aria-label={`Change time for ${entryLabel}`}
      >
        <span>{displayTimeFromRecordedAt(recordedAt)}</span>
        <Pencil size={13} aria-hidden />
      </button>

      <IonModal
        isOpen={open}
        onDidDismiss={dismiss}
        className={styles.modal}
        initialBreakpoint={0.42}
        breakpoints={[0, 0.42]}
      >
        <section className={styles.sheet} aria-labelledby={titleId}>
          <div className={styles.handle} aria-hidden />
          <p className={styles.eyebrow}>Date stays fixed · {displayDateFromRecordedAt(recordedAt)}</p>
          <h2 id={titleId}>Change time</h2>
          <p>Set when you actually {entryLabel.toLowerCase().startsWith('water') ? 'drank this' : 'ate this'}.</p>

          <label htmlFor={inputId}>
            {entryLabel.toLowerCase().startsWith('water') ? 'Time drank' : 'Time eaten'}
          </label>
          <input
            id={inputId}
            type="time"
            value={time}
            max={maxTimeForRecordedAt(recordedAt)}
            onChange={(event) => {
              setTime(event.target.value);
              setMessage('');
            }}
            aria-describedby={message ? messageId : undefined}
          />

          {message && <p id={messageId} className={styles.error}>{message}</p>}

          <div className={styles.actions}>
            <IonButton fill="outline" onClick={dismiss} disabled={saving}>Cancel</IonButton>
            <IonButton onClick={() => void save()} disabled={saving || !time}>
              {saving ? 'Saving…' : 'Save time'}
            </IonButton>
          </div>
        </section>
      </IonModal>
    </>
  );
};

export default EditableLogTime;
