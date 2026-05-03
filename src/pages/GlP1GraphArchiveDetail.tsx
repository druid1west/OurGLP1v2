// src/pages/Glp1GraphArchiveDetail.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { IonPage, IonContent, IonButton } from '@ionic/react';
import { useParams, Link, Redirect } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Media } from '@capacitor-community/media';
import { Preferences } from '@capacitor/preferences';

import TopNav from '../context/TopNav';
import BottomNav from '../context/BottomNav';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import styles from './Glp1GraphArchiveDetail.module.css';

import { getGlp1GraphArchive, type Glp1GraphArchiveRow } from '../db/Glp1GraphRepository';
import { logger } from '../utils/logger';

const log = logger.child('glp1-archive-detail');

// ------- Android Gallery helpers -------
let ANDROID_ALBUM_ID: string | null = null;
const ANDROID_ALBUM_PREF_KEY = 'ourglp1_media_album_id_v1';
const ANDROID_ALBUM_NAME = 'OurGLP1';

async function getOrCreateAndroidAlbumIdentifier(): Promise<string> {
  if (ANDROID_ALBUM_ID) return ANDROID_ALBUM_ID;

  try {
    const saved = await Preferences.get({ key: ANDROID_ALBUM_PREF_KEY });
    if (saved.value) {
      ANDROID_ALBUM_ID = saved.value;
      return ANDROID_ALBUM_ID;
    }
  } catch {
    // ignore preference read errors
  }

  await Media.createAlbum({ name: ANDROID_ALBUM_NAME });
  const { albums } = await Media.getAlbums();
  const match = albums.find((a) => a.name === ANDROID_ALBUM_NAME);

  if (!match?.identifier) throw new Error('Album identifier not found');

  ANDROID_ALBUM_ID = match.identifier;
  await Preferences.set({ key: ANDROID_ALBUM_PREF_KEY, value: ANDROID_ALBUM_ID });
  return ANDROID_ALBUM_ID;
}

type CanShareResult = { value: boolean };
type ShareWithOptionalCanShare = {
  canShare?: () => Promise<CanShareResult>;
};

async function canShareNative(): Promise<boolean> {
  try {
    const s = Share as unknown as ShareWithOptionalCanShare;
    if (typeof s.canShare === 'function') {
      const res = await s.canShare();
      return !!res.value;
    }
    return true;
  } catch {
    return true;
  }
}

function downloadOnWeb(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function Glp1GraphArchiveDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const archiveId = Number(id);
  const isValidId = Number.isFinite(archiveId) && archiveId > 0;

  const [loading, setLoading] = useState(true);
  const [rec, setRec] = useState<Glp1GraphArchiveRow | null>(null);
  const [saving, setSaving] = useState(false);

  // Important: compute chartSrc once when rec loads (prevents iOS weirdness)
  const [chartSrc, setChartSrc] = useState<string | null>(null);

  // Build chart src from record (uri preferred)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!rec) return;

      try {
        if (rec.chart_uri) {
          const src = Capacitor.isNativePlatform()
            ? Capacitor.convertFileSrc(rec.chart_uri)
            : rec.chart_uri;

          if (!cancelled) setChartSrc(src);
          return;
        }

        if (rec.chart_png) {
          if (!cancelled) setChartSrc(`data:image/png;base64,${rec.chart_png}`);
          return;
        }

        if (!cancelled) setChartSrc(null);
      } catch (e) {
        log.warn('Failed to compute chartSrc', e);
        if (!cancelled) setChartSrc(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rec]);

  const captureAndSave = useCallback(async (): Promise<void> => {
    if (saving || !rec) return;
    setSaving(true);

    try {
      const fname = `glp1-graph-${rec.id}.png`;

      // Prefer URI (new archives)
      const chartUri: string | null = rec.chart_uri;

      // Fallback: base64 legacy
      const chartPng: string | null = rec.chart_png;

      // -------------------------
      // ANDROID: Save to Photos album
      // -------------------------
      if (Capacitor.getPlatform() === 'android') {
        try {
          const albumIdentifier = await getOrCreateAndroidAlbumIdentifier();

          // If we have a real file uri already, save directly
          if (chartUri) {
            await Media.savePhoto({
              path: chartUri,
              albumIdentifier,
              fileName: fname,
            });

            alert('Saved to Photos ✅ (Album: OurGLP1)');
            return;
          }

          // Legacy fallback: write base64 then save
          if (chartPng) {
            const fileBase = `glp1-graph-${Date.now()}`;
            const relPath = `glp1-graph/${fileBase}.png`;

            // FIX #2: use Directory.Data (not Cache)
            await Filesystem.writeFile({
              path: relPath,
              data: chartPng,
              directory: Directory.Data,
              recursive: true,
            });

            const { uri } = await Filesystem.getUri({
              path: relPath,
              directory: Directory.Data,
            });

            if (!uri) throw new Error('No native URI after write');

            await Media.savePhoto({
              path: uri,
              albumIdentifier,
              fileName: `${fileBase}.png`,
            });

            // Optional cleanup (safe)
            try {
              await Filesystem.deleteFile({ path: relPath, directory: Directory.Data });
            } catch {
              /* ignore */
            }

            alert('Saved to Photos ✅ (Album: OurGLP1)');
            return;
          }
        } catch (err) {
          log.warn('Android savePhoto failed, falling back to Share', err);
        }
      }

      // -------------------------
      // NATIVE: Share sheet
      // -------------------------
      if (Capacitor.isNativePlatform() && (await canShareNative())) {
        // FIX #1: only compute shareUrl inside chartUri block (chartUri can be null)
        if (chartUri) {
          const shareUrl =
            Capacitor.getPlatform() === 'ios'
              ? Capacitor.convertFileSrc(chartUri)
              : chartUri;

          await Share.share({
            title: 'GLP-1 Graph',
            text: 'Your archived GLP-1 graph',
            url: shareUrl,
            dialogTitle: 'Save or share image',
          });
          return;
        }

        // Legacy base64: write to Data then share
        if (chartPng) {
          const relPath = `glp1-graph/${Date.now()}-${fname}`;

          // FIX #2: use Directory.Data (not Cache)
          await Filesystem.writeFile({
            path: relPath,
            data: chartPng,
            directory: Directory.Data,
            recursive: true,
          });

          const native = await Filesystem.getUri({
            path: relPath,
            directory: Directory.Data,
          });

          const url = native.uri || '';
          if (!url) throw new Error('Could not resolve native file URL after write');

          // iOS prefers converted file src
          const shareableUrl =
            Capacitor.getPlatform() === 'ios'
              ? Capacitor.convertFileSrc(url)
              : url;

          await Share.share({
            title: 'GLP-1 Graph',
            text: 'Your archived GLP-1 graph',
            url: shareableUrl,
            dialogTitle: 'Save or share image',
          });
          return;
        }

        throw new Error('No chart data to share');
      }

      // -------------------------
      // WEB: download
      // -------------------------
      if (chartUri) {
        alert('This image is stored as a native file and cannot be downloaded from web.');
        return;
      }

      if (chartPng) {
        const dataUrl = `data:image/png;base64,${chartPng}`;
        downloadOnWeb(dataUrl, fname);
        return;
      }

      throw new Error('No chart data available');
    } catch (e) {
      log.warn('Save failed', e);
      alert('Could not save the image. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [saving, rec]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!isValidId) {
        if (mounted) setLoading(false);
        return;
      }

      try {
        const row = await getGlp1GraphArchive(archiveId);
        if (mounted) setRec(row);
      } catch (err) {
        log.error('Failed to load archive record', err);
        alert('Failed to load archived graph');
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [archiveId, isValidId]);

  if (!isValidId) {
    return <Redirect to="/glp1-graph/archive" />;
  }

  if (loading || !rec) {
    return (
      <IonPage>
        <TopNav showWhenAnon />
        <IonContent fullscreen className={styles.contentPad}>
          <div className={styles.container}>
            <div className={styles.loader}>Loading archive…</div>
          </div>
        </IonContent>
        <BottomNav />
      </IonPage>
    );
  }

  const canSave = !!rec.chart_uri || !!rec.chart_png;

  return (
    <IonPage>
      <TopNav showWhenAnon />
      <IonContent fullscreen className={styles.contentPad}>
        <div className={styles.container}>
          <div className={styles.page}>
            <div className={styles.leftCol}>
              <Card className={styles.card}>
                <CardHeader className={styles.cardHeader}>
                  <CardTitle className={styles.cardTitle}>GLP-1 Graph Archive</CardTitle>
                </CardHeader>

                <CardContent className={styles.cardContent}>
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Week:</span>
                    <strong className={styles.metaValue}>
                      {new Date(rec.from_date).toLocaleDateString()} →{' '}
                      {new Date(rec.to_date).toLocaleDateString()}
                    </strong>
                  </div>

                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Injection Day:</span>
                    <strong className={styles.metaValue}>{rec.injection_day}</strong>
                  </div>

                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Archived:</span>
                    <strong className={styles.metaValue}>
                      {new Date(rec.archived_at).toLocaleString()}
                    </strong>
                  </div>

                  <div className={styles.backRow}>
                    <Link to="/glp1-graph/archive">
                      <IonButton fill="outline">← Back to archive</IonButton>
                    </Link>
                  </div>

                  <div className={styles.actionRow}>
                    <IonButton expand="block" onClick={captureAndSave} disabled={saving || !canSave}>
                      {saving ? 'Saving…' : 'Save as image to library'}
                    </IonButton>
                  </div>

                  {chartSrc && (
                    <div className={styles.imageWrap}>
                      <img
                        src={chartSrc}
                        alt="Archived GLP-1 Graph"
                        className={styles.image}
                        onError={() => {
                          log.error('Image failed to load', {
                            chartSrc,
                            chart_uri: rec.chart_uri,
                            has_png: !!rec.chart_png,
                          });
                        }}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </IonContent>
      <BottomNav />
    </IonPage>
  );
}

