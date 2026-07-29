import { useCallback, useEffect, useState } from 'preact/hooks';
import { ensureBooted } from '../data/boot';
import {
  getProfile,
  listExercises,
  listScheduled,
  listSessionTemplates,
} from '../data/repo';
import type { Exercise, Profile, ScheduledSession, SessionTemplate } from '../types';

export interface CalendarData {
  profile: Profile;
  scheduled: ScheduledSession[];
  templates: SessionTemplate[];
  exercises: Exercise[];
}

export interface CalendarState {
  loading: boolean;
  data: CalendarData | null;
  reload: () => Promise<void>;
}

/** Live schedule for every calendar view. Reloaded after each mutation. */
export function useCalendar(): CalendarState {
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const boot = await ensureBooted();
    if (!boot.ok) {
      setLoading(false);
      return;
    }
    const [profile, scheduled, templates, exercises] = await Promise.all([
      getProfile(),
      listScheduled(),
      listSessionTemplates(),
      listExercises(),
    ]);
    if (profile) setData({ profile, scheduled, templates, exercises });
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { loading, data, reload: load };
}
