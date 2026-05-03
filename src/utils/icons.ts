// src/utils/icons.ts
export type EntryType =
  | 'blood_sugar'
  | 'blood_pressure'
  | 'bowel'
  | 'protein'
  | 'hydration'
  | 'injection'
  | 'mood'
  | 'exercise';

export function iconFor(type: EntryType) {
  switch (type) {
    case 'hydration':      return '💧';
    case 'protein':        return '🥩';
    case 'blood_sugar':    return '🩸';
    case 'blood_pressure': return '🫀';
    case 'bowel':          return '🚽';
    case 'injection':      return '💉';
    case 'mood':           return '🙂';
    case 'exercise':       return '🏋️‍♂️';
    default:               return '📝';
  }
}