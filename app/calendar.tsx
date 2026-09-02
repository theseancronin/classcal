/**
 * Calendar — a month grid and an agenda list, plus filters and search.
 *
 * The month grid is deliberately not the primary interface (spec 31): it is a
 * way to jump to a date, with the agenda underneath doing the real work.
 */
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useApp, useEvents } from '@/state/AppProvider';
import { WEEKDAY_INITIALS, daysInMonth, formatMonthTitle, mondayIndex, parseDateKey } from '@/domain/dates';
import { EVENT_TYPE_LABELS, type EventType } from '@/domain/types';
import { occursOn, relativeDateLabel } from '@/relevance/grouping';
import { affectedLabel, filterRelevant, selectedClassesOf } from '@/relevance/relevance';
import { EmptyState, EventCard, SectionHeader } from '@/ui/components';
import { MIN_TOUCH_TARGET, colors, radius, spacing, typography } from '@/ui/theme';

type ViewMode = 'agenda' | 'month';

/** Filter chips, chosen to match how a parent actually thinks about the term. */
const TYPE_FILTERS: { label: string; types: EventType[] }[] = [
  { label: 'Closures & half days', types: ['school_closure', 'school_holiday', 'early_finish', 'late_start', 'changed_hours'] },
  { label: 'Meetings', types: ['parent_teacher_meeting', 'parent_information_meeting', 'parent_association'] },
  { label: 'Activities', types: ['sports', 'swimming', 'choir', 'class_activity', 'trip'] },
  { label: 'Shows', types: ['performance', 'school_event', 'non_uniform_day'] },
];

export default function CalendarScreen() {
  const app = useApp();
  const router = useRouter();

  const [mode, setMode] = useState<ViewMode>('agenda');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<number | null>(null);
  const [monthAnchor, setMonthAnchor] = useState(app.today);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showAllClasses, setShowAllClasses] = useState(false);

  const selectedClasses = useMemo(() => selectedClassesOf(app.family), [app.family]);

  const { events } = useEvents({
    ...(search.trim() ? { search: search.trim() } : { from: app.today }),
    ...(activeFilter !== null ? { eventTypes: TYPE_FILTERS[activeFilter]!.types } : {}),
  });

  const visible = useMemo(() => {
    if (showAllClasses) return events;
    return filterRelevant(events, selectedClasses, {
      includeParentAssociation: app.display.showParentAssociation,
    });
  }, [events, selectedClasses, showAllClasses, app.display.showParentAssociation]);

  const dayEvents = useMemo(
    () => (selectedDay ? visible.filter((event) => occursOn(event, selectedDay)) : visible),
    [visible, selectedDay],
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.controls}>
        <TextInput
          accessibilityLabel="Search the school calendar"
          placeholder="Search events"
          placeholderTextColor={colors.inkFaint}
          value={search}
          onChangeText={setSearch}
          style={styles.search}
        />

        <View style={styles.toggleRow}>
          <ModeToggle mode={mode} onChange={setMode} />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip
            label={showAllClasses ? 'All classes' : 'My children'}
            active={!showAllClasses}
            onPress={() => setShowAllClasses((current) => !current)}
          />
          {TYPE_FILTERS.map((filter, index) => (
            <Chip
              key={filter.label}
              label={filter.label}
              active={activeFilter === index}
              onPress={() => setActiveFilter((current) => (current === index ? null : index))}
            />
          ))}
        </ScrollView>
      </View>

      {mode === 'month' ? (
        <MonthGrid
          anchor={monthAnchor}
          today={app.today}
          selectedDay={selectedDay}
          eventDays={visible}
          onChangeMonth={setMonthAnchor}
          onSelectDay={(day) => setSelectedDay((current) => (current === day ? null : day))}
        />
      ) : null}

      <SectionHeader
        title={selectedDay ? relativeDateLabel(selectedDay, app.today) : 'Agenda'}
        count={dayEvents.length}
      />

      {dayEvents.length === 0 ? (
        <EmptyState
          title={search.trim() ? `No events match “${search.trim()}”.` : 'No events to show.'}
          body={
            showAllClasses
              ? undefined
              : 'Only events for your selected classes are shown. Tap “My children” to see everything.'
          }
        />
      ) : (
        dayEvents.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            today={app.today}
            use24HourTime={app.display.use24HourTime}
            affectedLabel={affectedLabel(event, app.family)}
            onPress={() => router.push(`/event/${encodeURIComponent(event.id)}`)}
          />
        ))
      )}
    </ScrollView>
  );
}

function ModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <View style={styles.segmented}>
      {(['agenda', 'month'] as const).map((option) => (
        <Pressable
          key={option}
          accessibilityRole="tab"
          accessibilityState={{ selected: mode === option }}
          accessibilityLabel={option === 'agenda' ? 'Agenda view' : 'Month view'}
          onPress={() => onChange(option)}
          style={[styles.segment, mode === option && styles.segmentActive]}
        >
          <Text style={[styles.segmentText, mode === option && styles.segmentTextActive]}>
            {option === 'agenda' ? 'Agenda' : 'Month'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function MonthGrid({
  anchor,
  today,
  selectedDay,
  eventDays,
  onChangeMonth,
  onSelectDay,
}: {
  anchor: string;
  today: string;
  selectedDay: string | null;
  eventDays: { date: string; endDate: string; importance: string }[];
  onChangeMonth: (anchor: string) => void;
  onSelectDay: (day: string) => void;
}) {
  const parts = parseDateKey(anchor);
  if (!parts) return null;

  const total = daysInMonth(parts.year, parts.month);
  const firstKey = `${parts.year}-${String(parts.month).padStart(2, '0')}-01`;
  const leadingBlanks = mondayIndex(firstKey);

  const shiftMonth = (delta: number) => {
    const shifted = new Date(Date.UTC(parts.year, parts.month - 1 + delta, 1));
    onChangeMonth(shifted.toISOString().slice(0, 10));
  };

  const cells: (string | null)[] = [
    ...Array<null>(leadingBlanks).fill(null),
    ...Array.from({ length: total }, (_, i) =>
      `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`,
    ),
  ];

  return (
    <View style={styles.month}>
      <View style={styles.monthHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          onPress={() => shiftMonth(-1)}
          style={styles.monthNav}
        >
          <Text style={styles.monthNavText}>‹</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.monthTitle}>
          {formatMonthTitle(anchor)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          onPress={() => shiftMonth(1)}
          style={styles.monthNav}
        >
          <Text style={styles.monthNavText}>›</Text>
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAY_INITIALS.map((initial, index) => (
          <Text key={index} style={styles.weekdayInitial}>
            {initial}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((day, index) => {
          if (!day) return <View key={`blank-${index}`} style={styles.dayCell} />;

          const matching = eventDays.filter((e) => e.date <= day && e.endDate >= day);
          const hasCritical = matching.some((e) => e.importance === 'critical');
          const isToday = day === today;
          const isSelected = day === selectedDay;

          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${day}, ${matching.length} event${matching.length === 1 ? '' : 's'}`}
              onPress={() => onSelectDay(day)}
              style={[styles.dayCell, isSelected && styles.dayCellSelected]}
            >
              <Text
                style={[
                  styles.dayNumber,
                  isToday && styles.dayNumberToday,
                  isSelected && styles.dayNumberSelected,
                ]}
              >
                {Number(day.slice(8))}
              </Text>
              {/* Shape, not just colour: a filled square for critical days and a
                  hollow dot for ordinary ones. */}
              {matching.length > 0 ? (
                <View
                  style={[
                    styles.dayMarker,
                    hasCritical ? styles.dayMarkerCritical : styles.dayMarkerNormal,
                  ]}
                />
              ) : (
                <View style={styles.dayMarkerPlaceholder} />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  controls: {
    gap: spacing.md,
  },
  search: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    ...typography.body,
    fontSize: 16,
    color: colors.ink,
  },
  toggleRow: {
    flexDirection: 'row',
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.md,
    padding: 3,
  },
  segment: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  segmentActive: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  segmentText: {
    ...typography.bodyStrong,
    color: colors.inkMuted,
  },
  segmentTextActive: {
    color: colors.ink,
  },
  chipRow: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    borderColor: colors.accent,
    borderWidth: 2,
    backgroundColor: colors.accentSurface,
  },
  chipText: {
    ...typography.badge,
    fontSize: 13,
    color: colors.inkMuted,
  },
  chipTextActive: {
    color: colors.accent,
  },
  month: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthNav: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthNavText: {
    fontSize: 26,
    color: colors.accent,
  },
  monthTitle: {
    ...typography.bodyStrong,
    fontSize: 17,
    color: colors.ink,
  },
  weekRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  weekdayInitial: {
    flex: 1,
    textAlign: 'center',
    ...typography.caption,
    color: colors.inkFaint,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.xs,
  },
  dayCell: {
    width: `${100 / 7}%`,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: radius.sm,
  },
  dayCellSelected: {
    backgroundColor: colors.accentSurface,
  },
  dayNumber: {
    ...typography.body,
    color: colors.ink,
  },
  dayNumberToday: {
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  dayNumberSelected: {
    color: colors.accent,
    fontWeight: '700',
  },
  dayMarker: {
    width: 6,
    height: 6,
  },
  dayMarkerCritical: {
    backgroundColor: colors.critical,
  },
  dayMarkerNormal: {
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: colors.inkFaint,
  },
  dayMarkerPlaceholder: {
    width: 6,
    height: 6,
  },
});
