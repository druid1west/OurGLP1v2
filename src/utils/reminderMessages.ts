export type ReminderNotificationText = Readonly<{
  title: string;
  body: string;
}>;

type ReminderTextInput = Readonly<{
  title: string;
  reminderType?: string | null;
}>;

function cleanTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ');
}

function fallbackLabel(title: string, fallback: string): string {
  const cleaned = cleanTitle(title);
  return cleaned || fallback;
}

export function buildReminderNotificationText(input: ReminderTextInput): ReminderNotificationText {
  const type = (input.reminderType ?? 'other').trim().toLowerCase();
  const label = fallbackLabel(input.title, 'your reminder');

  switch (type) {
    case 'injection': {
      const injectionLabel = label.toLowerCase().includes('injection')
        ? label.toLowerCase()
        : `${label.toLowerCase()} injection`;
      return {
        title: 'Injection reminder',
        body: `It is time for your ${injectionLabel}. Log it once you are done.`,
      };
    }
    case 'hydration':
      return {
        title: 'Hydration reminder',
        body: `${label}. A quick drink now keeps today on track.`,
      };
    case 'protein':
      return {
        title: 'Protein reminder',
        body: `${label}. Check in with your protein target for today.`,
      };
    case 'exercise':
      return {
        title: 'Activity reminder',
        body: `${label}. Add steps, exercise, or movement when you are ready.`,
      };
    case 'blood_sugar':
      return {
        title: 'Blood sugar reminder',
        body: `${label}. Record your reading in the tracker.`,
      };
    case 'blood_pressure':
      return {
        title: 'Blood pressure reminder',
        body: `${label}. Record your reading in the tracker.`,
      };
    case 'bowel_movement':
      return {
        title: 'Bowel tracking reminder',
        body: `${label}. Add a quick bowel health note if there is something to log.`,
      };
    case 'effectiveness':
      return {
        title: 'Hunger and nausea check',
        body: `${label}. Log hunger, nausea, and appetite while it is fresh.`,
      };
    case 'weekly_summary':
      return {
        title: 'Weekly summary reminder',
        body: `${label}. Review the week and archive your progress.`,
      };
    case 'protocol':
      return {
        title: 'Protocol reminder',
        body: `${label}. Check your protocol notes and log anything useful.`,
      };
    default:
      return {
        title: 'OurGLP1 reminder',
        body: label,
      };
  }
}
