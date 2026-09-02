/**
 * Event detail.
 *
 * Everything the parent needs to act, plus — crucially — the school's own
 * wording and a link to the official calendar. When an interpretation is
 * involved, the original text is what makes it verifiable.
 */
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useApp } from '@/state/AppProvider';
import { DEFAULT_SCHOOL } from '@/config/school';
import { getNormalizedEvent, getRecentChanges } from '@/db/repository';
import { formatTime, formatTimeRange } from '@/domain/dates';
import { formatClassList } from '@/domain/labels';
import { CLASS_LABELS, EVENT_TYPE_LABELS, type EventChange, type NormalizedSchoolEvent } from '@/domain/types';
import { dateRangeLabel, relativeDateLabel } from '@/relevance/grouping';
import { affectedChildren, classTimeFor } from '@/relevance/relevance';
import { Badge, Card, ImportancePill, SectionHeader } from '@/ui/components';
import { MIN_TOUCH_TARGET, colors, radius, spacing, typography } from '@/ui/theme';

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApp();

  const [event, setEvent] = useState<NormalizedSchoolEvent | null>(null);
  const [changes, setChanges] = useState<EventChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => {
    if (!app.db || !id) return;
    let cancelled = false;

    (async () => {
      const found = await getNormalizedEvent(app.db!, id);
      const history = await getRecentChanges(app.db!, { eventId: id, limit: 5 });
      if (cancelled) return;
      setEvent(found);
      setChanges(history);
      setLoading(false);
    })().catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [app.db, id, app.revision]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.loading}>
        <Text style={styles.body}>This event is no longer in the school calendar.</Text>
      </View>
    );
  }

  const children = affectedChildren(event, app.family);
  const use24Hour = app.display.use24HourTime;
  const eventTimes = formatTimeRange(event.startTime, event.endTime, use24Hour);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.titleBlock}>
        <View style={styles.pillRow}>
          <ImportancePill importance={event.importance} />
          <Badge label={EVENT_TYPE_LABELS[event.eventType]} />
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          {event.title}
        </Text>
        <Text style={styles.date}>
          {dateRangeLabel(event)}
          {event.date === event.endDate ? ` · ${relativeDateLabel(event.date, app.today)}` : ''}
        </Text>
        {eventTimes ? <Text style={styles.time}>{eventTimes}</Text> : null}
      </View>

      {changes.length > 0 ? (
        <Card style={[styles.card, styles.changeCard]}>
          <Text style={[styles.cardHeading, { color: colors.changed }]}>Updated</Text>
          {changes.map((change) => (
            <Text key={change.id} style={styles.body}>
              {change.description}
            </Text>
          ))}
        </Card>
      ) : null}

      {event.summary ? <Text style={styles.summary}>{event.summary}</Text> : null}

      {event.parentActionRequired ? (
        <Card style={[styles.card, styles.actionCard]}>
          <Text style={[styles.cardHeading, { color: colors.critical }]}>What you need to do</Text>
          <Text style={styles.body}>
            {event.parentAction ?? 'Check the school calendar for details.'}
          </Text>
        </Card>
      ) : null}

      <SectionHeader title="Affects" />
      <Card style={styles.card}>
        {children.length > 0 ? (
          children.map((child) => {
            const times = classTimeFor(event, child.schoolClass);
            const detail = formatTimeRange(times.startTime, times.finishTime, use24Hour);
            return (
              <View key={child.id} style={styles.affectedRow}>
                <Text style={styles.affectedName}>
                  {child.name ?? CLASS_LABELS[child.schoolClass]}
                </Text>
                <Text style={styles.affectedClass}>{CLASS_LABELS[child.schoolClass]}</Text>
                {detail ? <Text style={styles.affectedTime}>{detail}</Text> : null}
              </View>
            );
          })
        ) : (
          <Text style={styles.body}>{formatClassList(event.appliesTo)}</Text>
        )}
      </Card>

      {event.classDetails.length > 0 ? (
        <>
          <SectionHeader title="Times by class" />
          <Card style={styles.card}>
            {event.classDetails.map((detail) => (
              <View key={detail.schoolClass} style={styles.affectedRow}>
                <Text style={styles.affectedName}>{CLASS_LABELS[detail.schoolClass]}</Text>
                <Text style={styles.affectedTime}>
                  {detail.finishTime
                    ? `finishes ${formatTime(detail.finishTime, use24Hour)}`
                    : detail.startTime
                      ? `starts ${formatTime(detail.startTime, use24Hour)}`
                      : (detail.note ?? '')}
                  {detail.startTime && detail.finishTime
                    ? ` (from ${formatTime(detail.startTime, use24Hour)})`
                    : ''}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {event.location ? (
        <>
          <SectionHeader title="Where" />
          <Card style={styles.card}>
            <Text style={styles.body}>{event.location}</Text>
          </Card>
        </>
      ) : null}

      <SectionHeader title="Source" />
      <Card style={styles.card}>
        <Text style={styles.sourceLabel}>{DEFAULT_SCHOOL.name} school calendar</Text>

        {event.needsReview ? (
          <Text style={styles.reviewNote}>
            This entry was interpreted with low confidence. The school&apos;s own wording below is
            the authoritative version.
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showOriginal }}
          accessibilityLabel={
            showOriginal ? 'Hide the original wording' : 'Show the original wording'
          }
          onPress={() => setShowOriginal((current) => !current)}
          style={styles.linkButton}
        >
          <Text style={styles.linkText}>
            {showOriginal ? 'Hide original wording' : 'Show original wording'}
          </Text>
        </Pressable>

        {showOriginal ? (
          <View style={styles.originalBlock}>
            {/* Rendered as plain text: React Native never interprets markup, so
                anything in the feed is shown literally. */}
            <Text style={styles.originalText}>{event.originalTitle}</Text>
            {event.originalDescription ? (
              <Text style={styles.originalText}>{event.originalDescription}</Text>
            ) : null}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="link"
          accessibilityLabel="View the official school calendar in your browser"
          onPress={() => void Linking.openURL(event.sourceUrl || DEFAULT_SCHOOL.calendarPageUrl)}
          style={styles.linkButton}
        >
          <Text style={styles.linkText}>View official school calendar</Text>
        </Pressable>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  container: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  titleBlock: {
    gap: spacing.sm,
  },
  pillRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  title: {
    ...typography.screenTitle,
    fontSize: 27,
    color: colors.ink,
  },
  date: {
    ...typography.bodyStrong,
    fontSize: 16,
    color: colors.ink,
  },
  time: {
    ...typography.body,
    color: colors.inkMuted,
  },
  summary: {
    ...typography.body,
    fontSize: 16,
    lineHeight: 24,
    color: colors.inkMuted,
    marginTop: spacing.lg,
  },
  card: {
    gap: spacing.sm,
  },
  changeCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.changedSurface,
    borderColor: colors.changed,
    borderLeftWidth: 5,
  },
  actionCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.criticalSurface,
    borderColor: colors.critical,
    borderLeftWidth: 5,
  },
  cardHeading: {
    ...typography.sectionTitle,
  },
  body: {
    ...typography.body,
    color: colors.ink,
    lineHeight: 22,
  },
  affectedRow: {
    paddingVertical: spacing.xs,
    gap: 2,
  },
  affectedName: {
    ...typography.bodyStrong,
    fontSize: 16,
    color: colors.ink,
  },
  affectedClass: {
    ...typography.caption,
    color: colors.inkMuted,
  },
  affectedTime: {
    ...typography.body,
    color: colors.accent,
  },
  sourceLabel: {
    ...typography.body,
    color: colors.inkMuted,
  },
  reviewNote: {
    ...typography.caption,
    color: colors.high,
  },
  linkButton: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  linkText: {
    ...typography.bodyStrong,
    color: colors.accent,
  },
  originalBlock: {
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.sm,
  },
  originalText: {
    ...typography.body,
    color: colors.ink,
    lineHeight: 22,
  },
});
