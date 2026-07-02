export type ProtocolKind =
  | 'glp1'
  | 'copper_peptide'
  | 'recovery_peptide'
  | 'cellular_support'
  | 'custom';

export type ProtocolRouteType = 'injection' | 'oral' | 'topical' | 'sublingual' | 'other';
export type ProtocolCadenceType = 'daily' | 'weekly' | 'twice_weekly' | 'custom' | 'as_directed';
export type ProtocolEffectivenessModel = 'weekly_glp1' | 'daily_24h' | 'none';

export type ProtocolPreset = {
  id: string;
  name: string;
  kind: ProtocolKind;
  defaultCadence: string;
  routeLabel: string;
  routeType: ProtocolRouteType;
  cadenceType: ProtocolCadenceType;
  effectivenessModel: ProtocolEffectivenessModel;
  doseOptions?: string[];
  trackingFocus: string[];
  note: string;
};

export const PROTOCOL_KIND_LABELS: Record<ProtocolKind, string> = {
  glp1: 'GLP-1',
  copper_peptide: 'Copper peptide',
  recovery_peptide: 'Recovery peptide',
  cellular_support: 'Cellular support',
  custom: 'Custom',
};

export const PROTOCOL_PRESETS: ProtocolPreset[] = [
  {
    id: 'semaglutide',
    name: 'Semaglutide / Ozempic / Wegovy',
    kind: 'glp1',
    defaultCadence: 'Weekly',
    routeLabel: 'Injection',
    routeType: 'injection',
    cadenceType: 'weekly',
    effectivenessModel: 'weekly_glp1',
    doseOptions: ['0.25 mg', '0.5 mg', '1 mg', '1.7 mg', '2 mg', '2.4 mg', 'Other'],
    trackingFocus: ['Weight trend', 'Protein', 'Hydration', 'Appetite', 'Nausea', 'Bowel changes'],
    note: 'Use this for semaglutide routines prescribed under any brand name.',
  },
  {
    id: 'tirzepatide',
    name: 'Tirzepatide / Mounjaro / Zepbound',
    kind: 'glp1',
    defaultCadence: 'Weekly',
    routeLabel: 'Injection',
    routeType: 'injection',
    cadenceType: 'weekly',
    effectivenessModel: 'weekly_glp1',
    doseOptions: ['2.5 mg', '5 mg', '7.5 mg', '10 mg', '12.5 mg', '15 mg', 'Other'],
    trackingFocus: ['Weight trend', 'Protein', 'Hydration', 'Appetite', 'Nausea', 'Blood sugar if relevant'],
    note: 'Use this for tirzepatide routines prescribed under any brand name.',
  },
  {
    id: 'liraglutide',
    name: 'Liraglutide / Saxenda',
    kind: 'glp1',
    defaultCadence: 'Daily',
    routeLabel: 'Injection',
    routeType: 'injection',
    cadenceType: 'daily',
    effectivenessModel: 'daily_24h',
    doseOptions: ['0.6 mg', '1.2 mg', '1.8 mg', '2.4 mg', '3 mg', 'Other'],
    trackingFocus: ['Weight trend', 'Protein', 'Hydration', 'Appetite', 'Nausea', 'Bowel changes'],
    note: 'Use this for daily liraglutide routines.',
  },
  {
    id: 'daily-glp1-pill',
    name: 'Daily GLP-1 pill',
    kind: 'glp1',
    defaultCadence: 'Daily',
    routeLabel: 'Oral',
    routeType: 'oral',
    cadenceType: 'daily',
    effectivenessModel: 'daily_24h',
    doseOptions: ['1 mg', '1.5 mg', '3 mg', '4 mg', '7 mg', '9 mg', '14 mg', '25 mg', 'Other'],
    trackingFocus: ['Dose adherence', 'Appetite', 'Nausea', 'Hydration', 'Protein', 'Bowel changes'],
    note: 'Use this for a daily oral GLP-1 routine exactly as prescribed.',
  },
  {
    id: 'other-medication',
    name: 'Other Medication',
    kind: 'glp1',
    defaultCadence: 'As directed',
    routeLabel: 'As directed',
    routeType: 'other',
    cadenceType: 'as_directed',
    effectivenessModel: 'none',
    doseOptions: ['Other'],
    trackingFocus: ['Dose adherence', 'Appetite', 'Hydration', 'Protein', 'Side effects', 'Notes'],
    note: 'Use this when your medication is not listed. Keep dose and timing based on your prescriber or medication label.',
  },
  {
    id: 'copper-peptide',
    name: 'Copper peptide',
    kind: 'copper_peptide',
    defaultCadence: 'As directed',
    routeLabel: 'As directed',
    routeType: 'other',
    cadenceType: 'as_directed',
    effectivenessModel: 'none',
    trackingFocus: ['Skin notes', 'Sleep', 'Energy', 'Training load', 'Side effects', 'Photos or notes'],
    note: 'Track usage and observations only. The app does not suggest dose or frequency.',
  },
  {
    id: 'bpc-157',
    name: 'BPC-157',
    kind: 'recovery_peptide',
    defaultCadence: 'As directed',
    routeLabel: 'As directed',
    routeType: 'other',
    cadenceType: 'as_directed',
    effectivenessModel: 'none',
    trackingFocus: ['Pain score', 'Mobility', 'Sleep', 'Training load', 'Side effects', 'Notes'],
    note: 'Track usage and recovery observations only.',
  },
  {
    id: 'tb-500',
    name: 'TB-500',
    kind: 'recovery_peptide',
    defaultCadence: 'As directed',
    routeLabel: 'As directed',
    routeType: 'other',
    cadenceType: 'as_directed',
    effectivenessModel: 'none',
    trackingFocus: ['Pain score', 'Mobility', 'Training load', 'Sleep', 'Side effects', 'Notes'],
    note: 'Track usage and recovery observations only.',
  },
  {
    id: 'nad-plus',
    name: 'NAD+',
    kind: 'cellular_support',
    defaultCadence: 'As directed',
    routeLabel: 'As directed',
    routeType: 'other',
    cadenceType: 'as_directed',
    effectivenessModel: 'none',
    trackingFocus: ['Energy', 'Sleep', 'Resting heart rate', 'Training load', 'Side effects', 'Notes'],
    note: 'Track usage and observations only.',
  },
  {
    id: 'custom',
    name: 'Custom protocol',
    kind: 'custom',
    defaultCadence: 'As directed',
    routeLabel: 'As directed',
    routeType: 'other',
    cadenceType: 'as_directed',
    effectivenessModel: 'none',
    doseOptions: ['Other'],
    trackingFocus: ['Symptoms', 'Sleep', 'Energy', 'Activity', 'Side effects', 'Notes'],
    note: 'Use this for anything not listed. Keep dose and timing based on your own instructions.',
  },
];

export const PUBLIC_PROTOCOL_PRESET_IDS = [
  'semaglutide',
  'tirzepatide',
  'liraglutide',
  'other-medication',
] as const;

const PUBLIC_PROTOCOL_PRESET_ID_SET = new Set<string>(PUBLIC_PROTOCOL_PRESET_IDS);

export function isPublicProtocolPreset(id: string): boolean {
  return PUBLIC_PROTOCOL_PRESET_ID_SET.has(id);
}

export function getPublicProtocolPresets(): ProtocolPreset[] {
  return PROTOCOL_PRESETS.filter((preset) => isPublicProtocolPreset(preset.id));
}

export function getProtocolPreset(id: string): ProtocolPreset {
  return PROTOCOL_PRESETS.find((preset) => preset.id === id) ?? PROTOCOL_PRESETS[PROTOCOL_PRESETS.length - 1];
}
