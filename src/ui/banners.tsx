/**
 * The two banners that sit above the feed.
 *
 * Both exist to stop the app lying by omission: one says when the data was last
 * genuinely refreshed, the other surfaces changes the school made to events the
 * parent has already seen.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useApp } from '@/state/AppProvider';
import { formatRelativeInstant } from '@/domain/dates';
import { MIN_TOUCH_TARGET, colors, radius, spacing, typography } from './theme';

/**
 * Never imply the calendar is current when a refresh has failed or the data is
 * old. When it *is* current, this is a quiet one-line reassurance.
 */
export function StaleBanner() {
  const { syncStatus, stale, lastSyncError, syncing, refresh } = useApp();
  const now = new Date().toISOString();

  if (!stale) {
    return (
      <Text style={styles.freshLine}>
        {syncStatus.lastSuccessAt
          ? `Last updated ${formatRelativeInstant(syncStatus.lastSuccessAt, now)}.`
          : 'Not yet updated.'}
      </Text>
    );
  }

  const age = syncStatus.lastSuccessAt
    ? formatRelativeInstant(syncStatus.lastSuccessAt, now)
    : null;

  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: colors.highSurface, borderColor: colors.high }]}
    >
      <Text style={[styles.bannerTitle, { color: colors.high }]}>
        ⚠ Calendar may be out of date
      </Text>
      <Text style={styles.bannerBody}>
        {age
          ? `Last successfully updated ${age}. Check the official school calendar for recent changes.`
          : 'The school calendar has not been downloaded yet.'}
      </Text>
      {lastSyncError ? <Text style={styles.bannerDetail}>{lastSyncError}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Try to refresh the calendar now"
        accessibilityState={{ disabled: syncing }}
        disabled={syncing}
        onPress={() => void refresh({ force: true })}
        style={styles.bannerAction}
      >
        <Text style={[styles.bannerActionText, { color: colors.high }]}>
          {syncing ? 'Refreshing…' : 'Try again'}
        </Text>
      </Pressable>
    </View>
  );
}

/** Changes the school made since the parent last acknowledged them. */
export function ChangeBanner() {
  const { changes, dismissChanges } = useApp();
  if (changes.length === 0) return null;

  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: colors.changedSurface, borderColor: colors.changed }]}
    >
      <Text style={[styles.bannerTitle, { color: colors.changed }]}>
        ↻ {changes.length === 1 ? 'The school calendar changed' : `${changes.length} calendar changes`}
      </Text>
      {changes.slice(0, 3).map((change) => (
        <Text key={change.id} style={styles.bannerBody}>
          {change.description}
        </Text>
      ))}
      {changes.length > 3 ? (
        <Text style={styles.bannerDetail}>and {changes.length - 3} more.</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss calendar change notices"
        onPress={() => void dismissChanges()}
        style={styles.bannerAction}
      >
        <Text style={[styles.bannerActionText, { color: colors.changed }]}>Got it</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  freshLine: {
    ...typography.caption,
    color: colors.inkFaint,
    marginBottom: spacing.sm,
  },
  banner: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderLeftWidth: 5,
    padding: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  bannerTitle: {
    ...typography.bodyStrong,
    fontSize: 16,
  },
  bannerBody: {
    ...typography.body,
    color: colors.ink,
    lineHeight: 21,
  },
  bannerDetail: {
    ...typography.caption,
    color: colors.inkMuted,
  },
  bannerAction: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  bannerActionText: {
    ...typography.bodyStrong,
  },
});
