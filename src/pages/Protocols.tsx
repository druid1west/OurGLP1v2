import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IonButton, IonContent, IonPage } from '@ionic/react';
import {
  Activity,
  Archive,
  CheckCircle2,
  ClipboardList,
  Pause,
  PlayCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';

import TopNav from '../context/TopNav';
import BottomNav from '../context/BottomNav';
import { useAuth } from '../context/useAuth';
import {
  createProtocol,
  deleteProtocol,
  initProtocolTables,
  listProtocolEventsForDay,
  listProtocols,
  logProtocolEvent,
  setProtocolActive,
  type Protocol,
  type ProtocolEvent,
} from '../db/ProtocolRepository';
import {
  getProtocolPreset,
  PROTOCOL_KIND_LABELS,
  PROTOCOL_PRESETS,
  type ProtocolCadenceType,
  type ProtocolEffectivenessModel,
  type ProtocolKind,
  type ProtocolRouteType,
} from '../lib/protocolCatalog';
import { logger } from '../utils/logger';
import styles from './Protocols.module.css';

type LoadState = 'loading' | 'ready' | 'error';

type ProtocolDraft = {
  presetId: string;
  kind: ProtocolKind;
  name: string;
  doseLabel: string;
  cadenceLabel: string;
  routeLabel: string;
  notes: string;
};

const ADD_PROTOCOL_PRESETS = PROTOCOL_PRESETS.filter((preset) => preset.id !== 'daily-glp1-pill');

function routeTypeFromLabel(label: string): ProtocolRouteType {
  const normalized = label.trim().toLowerCase();
  if (normalized.includes('inject')) return 'injection';
  if (normalized.includes('oral')) return 'oral';
  if (normalized.includes('topical')) return 'topical';
  if (normalized.includes('sublingual')) return 'sublingual';
  return 'other';
}

function cadenceTypeFromLabel(label: string): ProtocolCadenceType {
  const normalized = label.trim().toLowerCase();
  if (normalized.includes('twice')) return 'twice_weekly';
  if (normalized.includes('daily')) return 'daily';
  if (normalized.includes('weekly')) return 'weekly';
  if (normalized.includes('cycle') || normalized.includes('custom')) return 'custom';
  return 'as_directed';
}

function effectivenessModelForDraft(kind: ProtocolKind, cadenceType: ProtocolCadenceType): ProtocolEffectivenessModel {
  if (kind !== 'glp1') return 'none';
  if (cadenceType === 'daily') return 'daily_24h';
  if (cadenceType === 'weekly') return 'weekly_glp1';
  return 'none';
}

function localYmd(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function draftFromPreset(presetId: string): ProtocolDraft {
  const preset = getProtocolPreset(presetId);
  return {
    presetId,
    kind: preset.kind,
    name: preset.name,
    doseLabel: '',
    cadenceLabel: preset.defaultCadence,
    routeLabel: preset.routeLabel,
    notes: preset.note,
  };
}

function eventTime(eventAt: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(eventAt));
}

const Protocols: React.FC = () => {
  const { user } = useAuth();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [eventsToday, setEventsToday] = useState<ProtocolEvent[]>([]);
  const [draft, setDraft] = useState<ProtocolDraft>(() => draftFromPreset('semaglutide'));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const today = useMemo(() => localYmd(), []);
  const activeProtocols = useMemo(
    () => protocols.filter((protocol) => protocol.is_active),
    [protocols]
  );
  const pausedProtocols = useMemo(
    () => protocols.filter((protocol) => !protocol.is_active),
    [protocols]
  );

  const loadProtocols = useCallback(async () => {
    if (!user?.id) return;
    setLoadState('loading');
    try {
      await initProtocolTables();
      const [protocolRows, eventRows] = await Promise.all([
        listProtocols(user.id),
        listProtocolEventsForDay(user.id, today),
      ]);
      setProtocols(protocolRows);
      setEventsToday(eventRows);
      setLoadState('ready');
    } catch (error) {
      logger.warn('[Protocols] failed to load', {
        msg: error instanceof Error ? error.message : String(error),
      });
      setLoadState('error');
    }
  }, [today, user?.id]);

  useEffect(() => {
    void loadProtocols();
  }, [loadProtocols]);

  const handlePresetChange = (presetId: string): void => {
    setDraft(draftFromPreset(presetId));
  };

  const handleAddProtocol = async (): Promise<void> => {
    if (!user?.id || busy) return;
    const name = draft.name.trim();
    if (!name) {
      setMessage('Add a protocol name first.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const preset = getProtocolPreset(draft.presetId);
      const routeType = routeTypeFromLabel(draft.routeLabel);
      const cadenceType = cadenceTypeFromLabel(draft.cadenceLabel);
      const effectivenessModel = effectivenessModelForDraft(draft.kind, cadenceType);
      await createProtocol({
        userId: user.id,
        kind: draft.kind,
        name,
        doseLabel: draft.doseLabel,
        cadenceLabel: draft.cadenceLabel,
        routeLabel: draft.routeLabel,
        routeType,
        cadenceType,
        reviewAnchorDay: cadenceType === 'daily' ? 'Monday' : null,
        effectivenessModel,
        trackingFocus: preset.trackingFocus,
        notes: draft.notes,
        isPrimary: activeProtocols.length === 0,
      });
      setDraft(draftFromPreset(draft.presetId));
      setMessage('Protocol added.');
      window.dispatchEvent(new Event('protocols:changed'));
      await loadProtocols();
    } catch (error) {
      logger.warn('[Protocols] add failed', {
        msg: error instanceof Error ? error.message : String(error),
      });
      setMessage('Could not add that protocol yet.');
    } finally {
      setBusy(false);
    }
  };

  const handleLog = async (protocol: Protocol): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await logProtocolEvent(protocol);
      setMessage(`${protocol.name} logged for today.`);
      window.dispatchEvent(new Event('protocols:changed'));
      await loadProtocols();
    } catch (error) {
      logger.warn('[Protocols] log failed', {
        msg: error instanceof Error ? error.message : String(error),
      });
      setMessage('Could not log that protocol yet.');
    } finally {
      setBusy(false);
    }
  };

  const handlePause = async (protocol: Protocol): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await setProtocolActive(protocol.id, false);
      setMessage(`${protocol.name} paused.`);
      window.dispatchEvent(new Event('protocols:changed'));
      await loadProtocols();
    } catch (error) {
      logger.warn('[Protocols] pause failed', {
        msg: error instanceof Error ? error.message : String(error),
      });
      setMessage('Could not pause that protocol yet.');
    } finally {
      setBusy(false);
    }
  };

  const handleResume = async (protocol: Protocol): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await setProtocolActive(protocol.id, true);
      setMessage(`${protocol.name} resumed.`);
      window.dispatchEvent(new Event('protocols:changed'));
      await loadProtocols();
    } catch (error) {
      logger.warn('[Protocols] resume failed', {
        msg: error instanceof Error ? error.message : String(error),
      });
      setMessage('Could not resume that protocol yet.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (protocol: Protocol): Promise<void> => {
    if (busy) return;
    const ok = window.confirm(
      `Remove ${protocol.name}? This will also remove its protocol logs.`
    );
    if (!ok) return;

    setBusy(true);
    setMessage('');
    try {
      await deleteProtocol(protocol.id);
      setMessage(`${protocol.name} removed.`);
      window.dispatchEvent(new Event('protocols:changed'));
      await loadProtocols();
    } catch (error) {
      logger.warn('[Protocols] remove failed', {
        msg: error instanceof Error ? error.message : String(error),
      });
      setMessage('Could not remove that protocol yet.');
    } finally {
      setBusy(false);
    }
  };

  const loggedProtocolIds = useMemo(
    () => new Set(eventsToday.map((event) => event.protocol_id)),
    [eventsToday]
  );

  const renderProtocolCard = (protocol: Protocol): React.ReactNode => (
    <article
      className={`${styles.protocolCard} ${protocol.is_active ? '' : styles.pausedProtocolCard}`}
      key={protocol.id}
    >
      <div className={styles.protocolTop}>
        <span>{PROTOCOL_KIND_LABELS[protocol.kind] ?? 'Protocol'}</span>
        {protocol.is_active ? (
          loggedProtocolIds.has(protocol.id) && (
            <small>
              <CheckCircle2 size={14} />
              Logged today
            </small>
          )
        ) : (
          <small className={styles.pausedBadge}>
            <Pause size={14} />
            Paused
          </small>
        )}
      </div>
      <h3>{protocol.name}</h3>
      <div className={styles.metaGrid}>
        <div>
          <span>Dose</span>
          <strong>{protocol.dose_label || 'As directed'}</strong>
        </div>
        <div>
          <span>Cadence</span>
          <strong>{protocol.cadence_label || 'As directed'}</strong>
        </div>
        <div>
          <span>Route</span>
          <strong>{protocol.route_label || 'As directed'}</strong>
        </div>
      </div>

      {protocol.tracking_focus.length > 0 && (
        <div className={styles.focusList}>
          {protocol.tracking_focus.slice(0, 6).map((focus) => (
            <span key={focus}>{focus}</span>
          ))}
        </div>
      )}

      <div className={styles.cardActions}>
        {protocol.is_active ? (
          <>
            <button type="button" onClick={() => void handleLog(protocol)} disabled={busy}>
              <Activity size={16} />
              Log today
            </button>
            <button type="button" onClick={() => void handlePause(protocol)} disabled={busy}>
              <Pause size={16} />
              Pause
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.resumeAction}
            onClick={() => void handleResume(protocol)}
            disabled={busy}
          >
            <PlayCircle size={16} />
            Resume
          </button>
        )}
        <button
          type="button"
          className={styles.dangerAction}
          onClick={() => void handleRemove(protocol)}
          disabled={busy}
        >
          <Trash2 size={16} />
          Remove
        </button>
      </div>
    </article>
  );

  return (
    <IonPage>
      <TopNav showWhenAnon={false} />
      <IonContent fullscreen className={styles.content}>
        <main className={styles.page}>
          <section className={styles.hero}>
            <div>
              <div className={styles.kicker}>
                <ClipboardList size={17} />
                <span>Protocols</span>
              </div>
              <h1>Track GLP-1 and peptide routines in one place</h1>
              <p>
                Keep dose labels, cadence, and notes together with the outcomes you already track.
                This is a recording tool, not dosing advice.
              </p>
            </div>
            <div className={styles.heroBadge}>
              <ShieldCheck size={22} />
              <span>Track only</span>
            </div>
          </section>

          <section className={styles.formPanel}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Add protocol</h2>
                <p>Pick a preset, then record the exact label your routine uses.</p>
              </div>
            </div>

            <div className={styles.formGrid}>
              <label>
                <span>Preset</span>
                <select
                  value={draft.presetId}
                  onChange={(event) => handlePresetChange(event.target.value)}
                >
                  {ADD_PROTOCOL_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </label>

              {draft.kind === 'glp1' && (
                <div className={styles.protocolRhythmField}>
                  <span>How do you take it?</span>
                  <div className={styles.protocolRhythmGrid} role="radiogroup" aria-label="Protocol rhythm">
                    <button
                      type="button"
                      className={draft.cadenceLabel === 'Weekly' && draft.routeLabel === 'Injection' ? styles.protocolRhythmActive : ''}
                      onClick={() => setDraft({ ...draft, cadenceLabel: 'Weekly', routeLabel: 'Injection' })}
                      role="radio"
                      aria-checked={draft.cadenceLabel === 'Weekly' && draft.routeLabel === 'Injection'}
                    >
                      <strong>Weekly injection</strong>
                      <span>Weekly anchor and injection timing.</span>
                    </button>
                    <button
                      type="button"
                      className={draft.cadenceLabel === 'Daily' && draft.routeLabel === 'Oral' ? styles.protocolRhythmActive : ''}
                      onClick={() => setDraft({ ...draft, cadenceLabel: 'Daily', routeLabel: 'Oral' })}
                      role="radio"
                      aria-checked={draft.cadenceLabel === 'Daily' && draft.routeLabel === 'Oral'}
                    >
                      <strong>Daily pill</strong>
                      <span>Daily dose time and 24-hour effectiveness.</span>
                    </button>
                  </div>
                </div>
              )}

              <label>
                <span>Protocol name</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Copper peptide"
                />
              </label>

              <label>
                <span>Dose label</span>
                <input
                  value={draft.doseLabel}
                  onChange={(event) => setDraft({ ...draft, doseLabel: event.target.value })}
                  placeholder="As directed"
                />
              </label>

              <label>
                <span>Cadence</span>
                <select
                  value={draft.cadenceLabel}
                  onChange={(event) => setDraft({ ...draft, cadenceLabel: event.target.value })}
                >
                  {['Daily', 'Weekly', 'Twice weekly', 'Cycle based', 'As directed'].map((cadence) => (
                    <option key={cadence} value={cadence}>
                      {cadence}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Route label</span>
                <select
                  value={draft.routeLabel}
                  onChange={(event) => setDraft({ ...draft, routeLabel: event.target.value })}
                >
                  {['Injection', 'Topical', 'Oral', 'Sublingual', 'As directed'].map((route) => (
                    <option key={route} value={route}>
                      {route}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.fullField}>
                <span>Notes</span>
                <textarea
                  value={draft.notes}
                  onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                  rows={3}
                  placeholder="What you want to observe or discuss with your clinician."
                />
              </label>
            </div>

            <IonButton
              className={styles.primaryButton}
              onClick={() => void handleAddProtocol()}
              disabled={busy}
            >
              <Plus size={17} />
              Add protocol
            </IonButton>
          </section>

          <section className={styles.listPanel}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Active protocols</h2>
                <p>
                  {activeProtocols.length || pausedProtocols.length
                    ? `${activeProtocols.length} active · ${pausedProtocols.length} paused`
                    : 'No protocol yet'}
                </p>
              </div>
              {loadState === 'loading' && <RefreshCw className={styles.spin} size={18} />}
            </div>

            {loadState === 'error' && (
              <div className={styles.notice}>Could not load protocols yet.</div>
            )}

            {loadState !== 'error' && protocols.length === 0 && (
              <div className={styles.emptyState}>
                <Sparkles size={24} />
                <strong>Start with GLP-1 or add copper peptide as a second routine.</strong>
                <span>The same Today dashboard can then show movement, sleep, hydration, protein, and notes around it.</span>
              </div>
            )}

            {loadState !== 'error' && protocols.length > 0 && activeProtocols.length === 0 && (
              <div className={styles.notice}>No active protocols right now. Resume a paused protocol when it is back in use.</div>
            )}

            <div className={styles.protocolGrid}>
              {activeProtocols.map(renderProtocolCard)}
            </div>

            {pausedProtocols.length > 0 && (
              <>
                <div className={styles.subsectionHeader}>
                  <h3>Paused protocols</h3>
                  <p>Kept here until you resume or remove them.</p>
                </div>
                <div className={styles.protocolGrid}>
                  {pausedProtocols.map(renderProtocolCard)}
                </div>
              </>
            )}
          </section>

          <section className={styles.timelinePanel}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Today</h2>
                <p>{eventsToday.length ? `${eventsToday.length} protocol log${eventsToday.length === 1 ? '' : 's'}` : 'Nothing logged yet'}</p>
              </div>
              <Archive size={19} />
            </div>

            {eventsToday.length === 0 ? (
              <div className={styles.notice}>Log a protocol when it happens, then review outcomes around it.</div>
            ) : (
              <ul className={styles.eventList}>
                {eventsToday.map((event) => {
                  const protocol = protocols.find((item) => item.id === event.protocol_id);
                  return (
                    <li key={event.id}>
                      <strong>{protocol?.name ?? 'Protocol'}</strong>
                      <span>
                        {eventTime(event.event_at)}
                        {event.dose_label ? ` - ${event.dose_label}` : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {message && <p className={styles.message}>{message}</p>}
          </section>
        </main>
      </IonContent>
      <BottomNav showWhenAnon={false} />
    </IonPage>
  );
};

export default Protocols;
