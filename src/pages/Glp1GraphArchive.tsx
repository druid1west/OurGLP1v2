import React, { useState, useCallback, useEffect } from 'react';
import { IonPage, IonContent, IonButton, useIonViewWillEnter } from '@ionic/react';
import { Link } from 'react-router-dom';
import TopNav from '../context/TopNav';
import BottomNav from '../context/BottomNav';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Loader2, Trash2 } from 'lucide-react';
import styles from './Glp1GraphArchive.module.css';
import {
  listGlp1GraphArchive,
  deleteGlp1GraphArchive,
  glp1GraphArchiveFilename,
  type Glp1GraphArchiveRow,
} from '../db/Glp1GraphRepository';
import { useAuth } from '../context/useAuth';

function getUserIdString(u: unknown): string | null {
  if (!u || typeof u !== 'object') return null;
  const r = u as Record<string, unknown>;
  const raw = r.id;
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

export default function Glp1GraphArchive(): React.ReactElement {
  const { user } = useAuth();
  const userId = getUserIdString(user);

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Glp1GraphArchiveRow[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadArchive = useCallback(async (): Promise<void> => {
    if (!userId) {
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await listGlp1GraphArchive(userId, 50);
      setRows(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // 1. Standard Ionic lifecycle load (like Weekly Summary)
  useIonViewWillEnter(() => {
    void loadArchive();
  });

  // 2. Listen for the global custom event (triggered by Effectiveness.tsx)
  useEffect(() => {
    const handler = (): void => {
      void loadArchive();
    };
    window.addEventListener('glp1-archive:changed', handler);
    return () => window.removeEventListener('glp1-archive:changed', handler);
  }, [loadArchive]);

  const deleteRow = async (id: number): Promise<void> => {
    if (!window.confirm('Delete this archived graph?')) return;

    setDeletingId(id);
    try {
      await deleteGlp1GraphArchive(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error(err);
      alert('Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const fmtDate = (iso: string): string => {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
  };

  return (
    <IonPage>
      <TopNav showWhenAnon={false} />
      <IonContent fullscreen className={styles.contentPad}>
        <div className={styles.container}>
          <div className={styles.leftCol}>
            <Card className={styles.card}>
              <CardHeader className={styles.cardHeader}>
                <CardTitle className={styles.cardTitle}>
                  GLP-1 Graph Archive
                  {!loading && rows.length > 0 && (
                    <span className={styles.countBadge}>{rows.length}</span>
                  )}
                </CardTitle>
              </CardHeader>

              <CardContent className={styles.cardContent}>
                {loading ? (
                  <div className={styles.loader}>
                    <Loader2 className={styles.spinner} /> Loading…
                  </div>
                ) : rows.length === 0 ? (
                  <div className={styles.empty}>No archived graphs yet.</div>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Week</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => {
                          const busy = deletingId === r.id;
                          const filename = glp1GraphArchiveFilename(
                            r.from_date,
                            r.to_date
                          );
                          const weekRange = `${fmtDate(r.from_date)} → ${fmtDate(
                            r.to_date
                          )}`;

                          return (
                            <tr key={r.id}>
                              <td>
                                <div className={styles.fileCell}>
                                  <Link to={`/glp1-graph/archive/${r.id}`}>
                                    <code className={styles.filename}>
                                      {filename}
                                    </code>
                                  </Link>
                                  <IonButton
                                    fill="outline"
                                    size="small"
                                    onClick={() => void deleteRow(r.id)}
                                    disabled={busy}
                                    className={styles.deleteBtn}
                                  >
                                    {busy ? (
                                      <Loader2 className={styles.iconSpin} />
                                    ) : (
                                      <Trash2 className={styles.icon} />
                                    )}
                                  </IonButton>
                                </div>
                              </td>
                              <td>{weekRange}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </IonContent>
      <BottomNav />
    </IonPage>
  );
}