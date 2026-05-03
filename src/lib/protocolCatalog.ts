export type ProtocolKind =
  | 'glp1'
  | 'copper_peptide'
  | 'recovery_peptide'
  | 'cellular_support'
  | 'custom';

export type ProtocolPreset = {
  id: string;
  name: string;
  kind: ProtocolKind;
  defaultCadence: string;
  routeLabel: string;
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
    trackingFocus: ['Weight trend', 'Protein', 'Hydration', 'Appetite', 'Nausea', 'Bowel changes'],
    note: 'Use this for semaglutide routines prescribed under any brand name.',
  },
  {
    id: 'tirzepatide',
    name: 'Tirzepatide / Mounjaro / Zepbound',
    kind: 'glp1',
    defaultCadence: 'Weekly',
    routeLabel: 'Injection',
    trackingFocus: ['Weight trend', 'Protein', 'Hydration', 'Appetite', 'Nausea', 'Blood sugar if relevant'],
    note: 'Use this for tirzepatide routines prescribed under any brand name.',
  },
  {
    id: 'liraglutide',
    name: 'Liraglutide / Saxenda',
    kind: 'glp1',
    defaultCadence: 'Daily',
    routeLabel: 'Injection',
    trackingFocus: ['Weight trend', 'Protein', 'Hydration', 'Appetite', 'Nausea', 'Bowel changes'],
    note: 'Use this for daily liraglutide routines.',
  },
  {
    id: 'copper-peptide',
    name: 'Copper peptide',
    kind: 'copper_peptide',
    defaultCadence: 'As directed',
    routeLabel: 'As directed',
    trackingFocus: ['Skin notes', 'Sleep', 'Energy', 'Training load', 'Side effects', 'Photos or notes'],
    note: 'Track usage and observations only. The app does not suggest dose or frequency.',
  },
  {
    id: 'bpc-157',
    name: 'BPC-157',
    kind: 'recovery_peptide',
    defaultCadence: 'As directed',
    routeLabel: 'As directed',
    trackingFocus: ['Pain score', 'Mobility', 'Sleep', 'Training load', 'Side effects', 'Notes'],
    note: 'Track usage and recovery observations only.',
  },
  {
    id: 'tb-500',
    name: 'TB-500',
    kind: 'recovery_peptide',
    defaultCadence: 'As directed',
    routeLabel: 'As directed',
    trackingFocus: ['Pain score', 'Mobility', 'Training load', 'Sleep', 'Side effects', 'Notes'],
    note: 'Track usage and recovery observations only.',
  },
  {
    id: 'nad-plus',
    name: 'NAD+',
    kind: 'cellular_support',
    defaultCadence: 'As directed',
    routeLabel: 'As directed',
    trackingFocus: ['Energy', 'Sleep', 'Resting heart rate', 'Training load', 'Side effects', 'Notes'],
    note: 'Track usage and observations only.',
  },
  {
    id: 'custom',
    name: 'Custom protocol',
    kind: 'custom',
    defaultCadence: 'As directed',
    routeLabel: 'As directed',
    trackingFocus: ['Symptoms', 'Sleep', 'Energy', 'Activity', 'Side effects', 'Notes'],
    note: 'Use this for anything not listed. Keep dose and timing based on your own instructions.',
  },
];

export function getProtocolPreset(id: string): ProtocolPreset {
  return PROTOCOL_PRESETS.find((preset) => preset.id === id) ?? PROTOCOL_PRESETS[PROTOCOL_PRESETS.length - 1];
}
