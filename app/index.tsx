/**
 * Home — the personalised "For You" feed.
 *
 * The information hierarchy is decided in `buildHomeSections`; this screen only
 * renders it. Relevance filtering happens against the family's selected classes,
 * and whole-school events are always included.
 */
import { Link, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp, useEvents } from '@/state/AppProvider';
import { CLASS_LABELS } from '@/domain/types';
import { buildHomeSections } from '@/relevance/grouping';
import { affectedLabel, filterRelevant, selectedClassesOf } from '@/relevance/relevance';
import { ChangeBanner, StaleBanner } from '@/ui/banners';
import { Card, EmptyState, EventCard, SectionHeader } from '@/ui/components';
import { MIN_TOUCH_TARGET, colors, radius, spacing, typography } from '@/ui/theme';

export default function HomeScreen() {
  const app = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const selectedClasses = useMemo(() => selectedClassesOf(app.family), [app.family]);

  // Read a generous window; sectioning and relevance happen in memory, which
  // keeps the query simple and the filtering rules in one deterministic place.
  const { events, loading } = useEvents({ from: app.today });

  useEffect(() => {
    if (app.ready && !app.setupComplete) router.replace('/setup');
  }, [app.ready, app.setupComplete, router]);

  const relevant = useMemo(
    () =>
      filterRelevant(events, selectedClasses, {
        includeParentAssociation: app.display.showParentAssociation,
      }),
    [events, selectedClasses, app.display.showParentAssociation],
  );

  const sections = useMemo(
    () => buildHomeSections(relevant, app.today),
    [relevant, app.today],
  );

  const changedEventIds = useMemo(
    () => new Set(app.changes.map((change) => change.eventId)),
    [app.changes],
  );

  if (!app.ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[
        styles.container,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={app.syncing}
          onRefresh={() => void app.refresh({ force: true })}
          tintColor={colors.accent}
        />
      }
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.greeting}>Your school calendar</Text>
          <Text style={styles.familyLine}>
            {app.family.children
              .map((child) => child.name ?? CLASS_LABELS[child.schoolClass])
              .join(' · ')}
          </Text>
        </View>
        <Link href="/settings" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            style={styles.headerButton}
          >
            <Text style={styles.headerButtonText}>Settings</Text>
          </Pressable>
        </Link>
      </View>

      <StaleBanner />
      <ChangeBanner />

      {loading && events.length === 0 ? (
        <ActivityIndicator style={styles.inlineLoader} color={colors.accent} />
      ) : null}

      {sections.map((section) => (
        <View key={section.id}>
          <SectionHeader title={section.title} count={section.events.length} />
          {section.events.length === 0 ? (
            <EmptyState title={section.emptyMessage ?? 'Nothing here.'} />
          ) : (
            section.events.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                today={app.today}
                use24HourTime={app.display.use24HourTime}
                changed={changedEventIds.has(event.id)}
                affectedLabel={affectedLabel(event, app.family)}
                onPress={() => router.push(`/event/${encodeURIComponent(event.id)}`)}
              />
            ))
          )}
        </View>
      ))}

      {!loading && relevant.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyCardTitle}>Nothing coming up</Text>
          <Text style={styles.emptyCardBody}>
            {app.syncStatus.lastSuccessAt
              ? 'There are no upcoming events for your classes in the school calendar.'
              : 'The calendar has not been downloaded yet. Pull down to refresh.'}
          </Text>
        </Card>
      ) : null}

      <View style={styles.footerActions}>
        <Link href="/calendar" asChild>
          <Pressable accessibilityRole="button" style={styles.footerButton}>
            <Text style={styles.footerButtonText}>Open full calendar</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  container: {
    paddingHorizontal: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  greeting: {
    ...typography.screenTitle,
    fontSize: 26,
    color: colors.ink,
  },
  familyLine: {
    ...typography.body,
    color: colors.inkMuted,
  },
  headerButton: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSunken,
  },
  headerButtonText: {
    ...typography.bodyStrong,
    color: colors.ink,
  },
  inlineLoader: {
    marginTop: spacing.xl,
  },
  emptyCard: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  emptyCardTitle: {
    ...typography.cardTitle,
    color: colors.ink,
  },
  emptyCardBody: {
    ...typography.body,
    color: colors.inkMuted,
  },
  footerActions: {
    marginTop: spacing.xxl,
  },
  footerButton: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  footerButtonText: {
    ...typography.bodyStrong,
    color: colors.accent,
  },
});
