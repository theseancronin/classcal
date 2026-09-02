/**
 * The developer review queue.
 *
 * Shows what the interpreter produced next to what the school actually wrote, so
 * classification quality can be judged during model evaluation. Reachable only
 * from the developer section of Settings, which is itself only rendered in a
 * development build.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useApp } from '@/state/AppProvider';
import { getCurrentRawEvent, getEventsNeedingAttention, queryEvents, type RawEventVersion } from '@/db/repository';
import { formatClassList } from '@/domain/labels';
import { EVENT_TYPE_LABELS, type NormalizedSchoolEvent } from '@/domain/types';
import { readInterpreterSettings } from '@/interpreter/config';
import { createInterpreter } from '@/interpreter/factory';
import { reprocessEvent } from '@/pipeline/sync';
import { Badge, Button, Card, EmptyState, SectionHeader } from '@/ui/components';
import { colors, radius, spacing, typography } from '@/ui/theme';

export default function ReviewScreen() {
  const app = useApp();
  const [failures, setFailures] = useState<RawEventVersion[]>([]);
  const [lowConfidence, setLowConfidence] = useState<NormalizedSchoolEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!app.db) return;
    setLoading(true);
    setFailures(await getEventsNeedingAttention(app.db));
    setLowConfidence(await queryEvents(app.db, { needsReview: true }));
    setLoading(false);
  }, [app.db]);

  useEffect(() => {
    void load();
  }, [load, app.revision]);

  const reprocess = async (sourceId: string) => {
    if (!app.db) return;
    setBusyId(sourceId);
    try {
      const current = await getCurrentRawEvent(app.db, sourceId);
      if (current) {
        await reprocessEvent(
          app.db,
          createInterpreter(readInterpreterSettings()),
          current.event,
          current.versionId,
        );
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (!__DEV__) {
    // Belt and braces: even if the route is reached some other way, it renders
    // nothing outside a development build.
    return (
      <View style={styles.centre}>
        <Text style={styles.body}>Not available.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <SectionHeader title="Failed" count={failures.length} />
      {failures.length === 0 ? (
        <EmptyState title="Nothing failed interpretation." />
      ) : (
        failures.map((item) => (
          <Card key={item.versionId} style={styles.card}>
            <View style={styles.badgeRow}>
              <Badge label={item.processingStatus} />
              <Badge label={`v${item.versionId}`} />
            </View>
            <Text style={styles.rawTitle}>{item.event.title}</Text>
            {item.processingError ? (
              <Text style={styles.error}>{item.processingError}</Text>
            ) : null}
            <Button
              label={busyId === item.event.sourceId ? 'Reprocessing…' : 'Reprocess'}
              variant="secondary"
              disabled={busyId !== null}
              onPress={() => void reprocess(item.event.sourceId)}
            />
          </Card>
        ))
      )}

      <SectionHeader title="Low confidence" count={lowConfidence.length} />
      {lowConfidence.length === 0 ? (
        <EmptyState title="Nothing is awaiting review." />
      ) : (
        lowConfidence.map((event) => (
          <Card key={event.id} style={styles.card}>
            <View style={styles.badgeRow}>
              <Badge label={`confidence ${event.confidence}`} />
              <Badge label={EVENT_TYPE_LABELS[event.eventType]} />
              <Badge label={event.importance} />
            </View>

            <Text style={styles.label}>Source</Text>
            <Text style={styles.rawTitle}>{event.originalTitle}</Text>
            {event.originalDescription ? (
              <Text style={styles.rawTitle}>{event.originalDescription}</Text>
            ) : null}

            <Text style={styles.label}>Interpreted</Text>
            <Text style={styles.body}>{event.title}</Text>
            <Text style={styles.body}>{event.summary}</Text>
            <Text style={styles.body}>
              {event.date}
              {event.date === event.endDate ? '' : ` to ${event.endDate}`} ·{' '}
              {formatClassList(event.appliesTo)}
            </Text>
            {event.classDetails.length > 0 ? (
              <Text style={styles.body}>
                {event.classDetails
                  .map(
                    (d) =>
                      `${d.schoolClass}: ${[d.startTime, d.finishTime].filter(Boolean).join('–')}`,
                  )
                  .join(' · ')}
              </Text>
            ) : null}
            {event.tags.length > 0 ? (
              <Text style={styles.tags}>{event.tags.join(', ')}</Text>
            ) : null}

            <Button
              label={busyId === event.rawEventId ? 'Reprocessing…' : 'Reprocess'}
              variant="secondary"
              disabled={busyId !== null}
              onPress={() => void reprocess(event.rawEventId)}
            />
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  card: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  label: {
    ...typography.sectionTitle,
    color: colors.inkFaint,
    marginTop: spacing.xs,
  },
  rawTitle: {
    ...typography.body,
    color: colors.ink,
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.sm,
    padding: spacing.sm,
    lineHeight: 20,
  },
  body: {
    ...typography.body,
    color: colors.inkMuted,
    lineHeight: 20,
  },
  tags: {
    ...typography.caption,
    color: colors.inkFaint,
  },
  error: {
    ...typography.caption,
    color: colors.critical,
  },
});
