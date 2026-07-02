import React, { useEffect, useState } from 'react';
import { IonPage, IonContent } from '@ionic/react';
import { Link } from 'react-router-dom';

import TopNav from '@/context/TopNav';
import BottomNav from '@/context/BottomNav';

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Trash2 } from 'lucide-react';
import styles from './WeeklySummaryArchive.module.css';
import {
  deleteArchive,
  listArchive,
  type ArchiveRow,
  archiveFilename,
  archiveDisplayLabel,
} from '@/db/WeeklySummaryRepository';

/** ---------- date helpers ---------- */
function normalizeDateString(input: string): string {
  let s = String(input).trim();
  if (/^\d{13}$/.test(s)) return new Date(Number(s)).toISOString();
  if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000).toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T12:00:00Z`;
  if (s.includes(' ')) s = s.replace(' ', 'T');
  s = s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  if (/\+[0-9]{2}$/.test(s)) s += ':00';
  s = s.replace(/\+00:00$/, 'Z');
  return s;
}
function parseISO(input?: string | null): Date | null {
  if (!input) return null;
  const t = Date.parse(normalizeDateString(input));
  return Number.isNaN(t) ? null : new Date(t);
}

export default function WeeklySummaryArchive(): React.ReactElement {
  const [loading, setLoading] = useState<boolean>(true);
  const [rows, setRows] = useState<ArchiveRow[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await listArchive(50);
        if (mounted) setRows(res);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        alert(`Failed to load archive: ${msg}`);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const fmtDateTime = (iso?: string | null): string => {
    const d = parseISO(iso);
    return d
      ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : '—';
  };
  const fmtDateOnly = (iso?: string | null): string => {
    const d = parseISO(iso);
    return d ? d.toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';
  };

  const deleteRow = async (id: number): Promise<void> => {
    if (!id) return;
    const ok = window.confirm('Delete this archived summary?');
    if (!ok) return;

    setDeletingId(id);
    try {
      await deleteArchive(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
      alert('Deleted');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <IonPage>
      <TopNav showWhenAnon={false} />

      <IonContent fullscreen className={styles.contentPad}>
        <div className={styles.container}>
          <div className={styles.leftCol}>
            <Card className={styles.card} aria-busy={loading}>
              <CardHeader className={styles.cardHeader}>
                <CardTitle className={styles.cardTitle}>
                  Weekly summary archive
                  {!loading && rows.length > 0 && (
                    <span className={styles.countBadge} aria-label="Archived count">
                      {rows.length}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>

              <CardContent className={styles.cardContent}>
                {loading ? (
                  <div className={styles.loader} role="status" aria-live="polite">
                    <Loader2 className={styles.spinner} /> Loading…
                  </div>
                ) : rows.length === 0 ? (
                  <div className={styles.small}>No archived summaries yet.</div>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th className={styles.colFileCell}>Item</th>
                          <th className={styles.colWeek}>Week</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => {
                          const busy = deletingId === r.id;
                          const filename = archiveFilename(r.from_utc, r.to_utc);
                          const weekRange = archiveDisplayLabel(r.from_utc, r.to_utc);
                          const archivedOn = fmtDateTime(r.archived_at || r.sent_at || r.created_at);

                          return (
                            <tr key={r.id}>
                              <td className={styles.colFileCell}>
                                <div className={styles.fileCell}>
                                  <Link
                                    to={`/weekly-summary/archive/${r.id}`}
                                    className={styles.filenameLink}
                                    title={filename}
                                  >
                                    <span className={styles.filename}>{weekRange}</span>
                                  </Link>

                                  <span className={styles.fileMeta} title={archivedOn}>
                                    {archivedOn}
                                  </span>

                                  <Button
                                    variant="outline"
                                    onClick={() => void deleteRow(r.id)}
                                    disabled={busy}
                                    aria-busy={busy}
                                    title="Delete"
                                    className={styles.iconButton}
                                  >
                                    {busy ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4" />
                                    )}
                                  </Button>
                                </div>
                              </td>

                              <td className={styles.colWeek}>{filename}</td>
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

