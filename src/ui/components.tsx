/**
 * Shared presentational components.
 *
 * All calendar text is rendered through React Native `<Text>`, which escapes
 * content by construction -- there is no HTML renderer anywhere in the app, so
 * markup in a calendar entry is displayed as literal characters and can never
 * execute.
 */
import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { formatTimeRange } from '@/domain/dates';
import { EVENT_TYPE_LABELS, type Importance, type NormalizedSchoolEvent } from '@/domain/types';
import { relativeDateLabel } from '@/relevance/grouping';
import { MIN_TOUCH_TARGET, colors, importanceStyles, radius, spacing, typography } from './theme';

// ---------------------------------------------------------------------------

export function ScreenTitle({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.screenTitle}>
      {children}
    </Text>
  );
}

export function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <View style={styles.sectionHeader}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </Text>
      {count !== undefined && count > 0 ? (
        <Text style={styles.sectionCount}>{count}</Text>
      ) : null}
      <View style={styles.sectionRule} />
    </View>
  );
}

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'accent' | 'changed';
}) {
  const toneStyle =
    tone === 'accent'
      ? { backgroundColor: colors.accentSurface, color: colors.accent }
      : tone === 'changed'
        ? { backgroundColor: colors.changedSurface, color: colors.changed }
        : { backgroundColor: colors.surfaceSunken, color: colors.inkMuted };

  return (
    <View style={[styles.badge, { backgroundColor: toneStyle.backgroundColor }]}>
      <Text style={[styles.badgeText, { color: toneStyle.color }]}>{label}</Text>
    </View>
  );
}

/**
 * Importance is shown with a symbol *and* a word, never colour alone.
 */
export function ImportancePill({ importance }: { importance: Importance }) {
  const style = importanceStyles[importance];
  if (importance === 'normal' || importance === 'low') return null;

  return (
    <View style={[styles.importancePill, { backgroundColor: style.surface }]}>
      <Text style={[styles.importanceIcon, { color: style.color }]}>{style.icon}</Text>
      <Text style={[styles.importanceLabel, { color: style.color }]}>{style.label}</Text>
    </View>
  );
}

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  accessibilityHint?: string;
}) {
  const variantStyle =
    variant === 'primary'
      ? { backgroundColor: disabled ? colors.borderStrong : colors.accent, color: colors.onAccent }
      : variant === 'danger'
        ? { backgroundColor: colors.criticalSurface, color: colors.critical }
        : { backgroundColor: colors.surfaceSunken, color: colors.ink };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: variantStyle.backgroundColor, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, { color: variantStyle.color }]}>{label}</Text>
    </Pressable>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------

export type EventCardProps = {
  event: NormalizedSchoolEvent;
  /** "Aoife · Junior Infants". Comes from the relevance engine. */
  affectedLabel: string;
  /** Today's date key, for "Today"/"Tomorrow" wording. */
  today: string;
  /** Set when this event changed since the parent last looked. */
  changed?: boolean;
  use24HourTime?: boolean;
  onPress?: () => void;
};

/**
 * One event, showing only what a parent needs to decide what to do. The full
 * source wording is deliberately not rendered here -- it lives on the detail
 * screen, where it is labelled as the school's own words.
 */
export function EventCard({
  event,
  affectedLabel,
  today,
  changed = false,
  use24HourTime = true,
  onPress,
}: EventCardProps) {
  const style = importanceStyles[event.importance];
  const timeLabel = formatTimeRange(event.startTime, event.endTime, use24HourTime);
  const dateLabel = relativeDateLabel(event.date, today);

  // One flat, ordered sentence so a screen reader announces the card usefully
  // rather than reading a pile of disconnected fragments.
  const accessibilityLabel = [
    changed ? 'Updated.' : null,
    event.importance === 'critical' || event.importance === 'high' ? `${style.label}.` : null,
    dateLabel,
    event.title,
    affectedLabel,
    timeLabel,
    event.summary,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens the full event details"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        styles.eventCard,
        style.borderWidth > 0 && {
          borderLeftWidth: style.borderWidth,
          borderLeftColor: style.color,
        },
        pressed && { backgroundColor: colors.surfaceSunken },
      ]}
    >
      <View style={styles.eventCardHeader}>
        <Text style={styles.eventDate}>{dateLabel}</Text>
        {changed ? <Badge label="Updated" tone="changed" /> : null}
        <ImportancePill importance={event.importance} />
      </View>

      <Text style={styles.eventTitle}>{event.title}</Text>

      <View style={styles.eventMeta}>
        <Badge label={affectedLabel} tone="accent" />
        {timeLabel ? <Badge label={timeLabel} /> : null}
      </View>

      {event.summary ? (
        <Text style={styles.eventSummary} numberOfLines={3}>
          {event.summary}
        </Text>
      ) : null}

      {event.parentActionRequired && event.parentAction ? (
        <Text style={styles.eventAction}>{event.parentAction}</Text>
      ) : null}

      {event.needsReview ? (
        <Text style={styles.reviewNote}>
          Interpreted with low confidence — check the school calendar.
        </Text>
      ) : null}
    </Pressable>
  );
}

export function EventTypeLabel({ event }: { event: NormalizedSchoolEvent }) {
  return <Badge label={EVENT_TYPE_LABELS[event.eventType]} />;
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screenTitle: {
    ...typography.screenTitle,
    color: colors.ink,
    marginBottom: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    color: colors.inkFaint,
  },
  sectionCount: {
    ...typography.badge,
    color: colors.inkFaint,
  },
  sectionRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  badge: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  badgeText: typography.badge,
  importancePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  importanceIcon: {
    fontSize: 13,
    fontWeight: '800',
  },
  importanceLabel: typography.badge,
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  eventCard: {
    marginBottom: spacing.md,
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  eventCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  eventDate: {
    ...typography.date,
    color: colors.inkMuted,
    flex: 1,
  },
  eventTitle: {
    ...typography.cardTitle,
    color: colors.ink,
  },
  eventMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  eventSummary: {
    ...typography.body,
    color: colors.inkMuted,
    lineHeight: 21,
  },
  eventAction: {
    ...typography.bodyStrong,
    color: colors.ink,
  },
  reviewNote: {
    ...typography.caption,
    color: colors.inkFaint,
    fontStyle: 'italic',
  },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    ...typography.bodyStrong,
    fontSize: 16,
  },
  emptyState: {
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  emptyTitle: {
    ...typography.body,
    color: colors.inkMuted,
  },
  emptyBody: {
    ...typography.caption,
    color: colors.inkFaint,
  },
});

export { styles as sharedStyles };
