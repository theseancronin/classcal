/**
 * Settings — children and classes, notification and display preferences, the
 * calendar source, and the privacy controls.
 *
 * Changes to the family take effect immediately: removing a class removes that
 * class's events from Home on the next render, with no sync required.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useApp } from '@/state/AppProvider';
import { DEFAULT_SCHOOL } from '@/config/school';
import { formatRelativeInstant } from '@/domain/dates';
import {
  CLASS_LABELS,
  SELECTABLE_CLASSES,
  type NotificationPreferences,
  type ReminderType,
  type SelectableClass,
} from '@/domain/types';
import { newChildId } from '@/family/store';
import { Button, Card, SectionHeader } from '@/ui/components';
import { MIN_TOUCH_TARGET, colors, radius, spacing, typography } from '@/ui/theme';

const NOTIFICATION_ROWS: { key: keyof Omit<NotificationPreferences, 'reminderTypes'>; label: string; hint: string }[] = [
  { key: 'schoolClosure', label: 'School closed', hint: 'Closures and holidays' },
  { key: 'earlyFinish', label: 'Early finish', hint: 'Half days and changed hours' },
  { key: 'parentMeetings', label: 'Parent meetings', hint: 'Parent/teacher and information meetings' },
  { key: 'classImportant', label: 'Class events needing action', hint: 'Trips and deadlines' },
  { key: 'generalActivities', label: 'General activities', hint: 'Sports, choir, swimming' },
];

const REMINDER_ROWS: { key: ReminderType; label: string }[] = [
  { key: 'seven_days_before', label: '7 days before' },
  { key: 'one_day_before', label: '1 day before' },
  { key: 'morning_of', label: 'Morning of' },
];

export default function SettingsScreen() {
  const app = useApp();
  const router = useRouter();
  const [feedUrl, setFeedUrlDraft] = useState('');

  const selectedClasses = app.family.children.map((child) => child.schoolClass);

  const toggleClass = async (schoolClass: SelectableClass) => {
    const existing = app.family.children.find((child) => child.schoolClass === schoolClass);

    if (existing) {
      if (app.family.children.length === 1) {
        Alert.alert('Keep at least one class', 'ClassCal needs one class to show you anything.');
        return;
      }
      await app.updateFamily({
        ...app.family,
        children: app.family.children.filter((child) => child.id !== existing.id),
      });
      return;
    }

    await app.updateFamily({
      ...app.family,
      children: [...app.family.children, { id: newChildId(schoolClass), schoolClass }],
    });
  };

  const renameChild = async (id: string, name: string) => {
    await app.updateFamily({
      ...app.family,
      children: app.family.children.map((child) =>
        child.id === id ? { ...child, ...(name.trim() ? { name: name.trim() } : { name: undefined }) } : child,
      ),
    });
  };

  const confirmClear = () => {
    Alert.alert(
      'Clear family data?',
      'This removes your children, classes and preferences from this phone. The school calendar itself is unaffected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            void app.clearEverything().then(() => router.replace('/setup'));
          },
        },
      ],
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <SectionHeader title="Your children" />
      <Card style={styles.card}>
        {app.family.children.map((child) => (
          <View key={child.id} style={styles.childRow}>
            <Text style={styles.childClass}>{CLASS_LABELS[child.schoolClass]}</Text>
            <TextInput
              accessibilityLabel={`Name for the child in ${CLASS_LABELS[child.schoolClass]}`}
              placeholder="Name (optional)"
              placeholderTextColor={colors.inkFaint}
              defaultValue={child.name ?? ''}
              maxLength={40}
              onEndEditing={(e) => void renameChild(child.id, e.nativeEvent.text)}
              style={styles.input}
            />
          </View>
        ))}
      </Card>

      <SectionHeader title="Classes" />
      <Card style={styles.card}>
        {SELECTABLE_CLASSES.map((schoolClass) => {
          const isSelected = selectedClasses.includes(schoolClass);
          return (
            <Pressable
              key={schoolClass}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              accessibilityLabel={CLASS_LABELS[schoolClass]}
              onPress={() => void toggleClass(schoolClass)}
              style={styles.row}
            >
              <Text style={styles.rowLabel}>{CLASS_LABELS[schoolClass]}</Text>
              <Text style={[styles.rowState, isSelected && styles.rowStateOn]}>
                {isSelected ? '✓ Selected' : 'Not selected'}
              </Text>
            </Pressable>
          );
        })}
      </Card>

      <SectionHeader title="Notify me about" />
      <Card style={styles.card}>
        {NOTIFICATION_ROWS.map((row) => (
          <View key={row.key} style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={styles.rowHint}>{row.hint}</Text>
            </View>
            <Switch
              accessibilityLabel={row.label}
              value={app.preferences[row.key]}
              onValueChange={(value) =>
                void app.updatePreferences({ ...app.preferences, [row.key]: value })
              }
            />
          </View>
        ))}
      </Card>

      <SectionHeader title="When to remind me" />
      <Card style={styles.card}>
        {REMINDER_ROWS.map((row) => (
          <View key={row.key} style={styles.switchRow}>
            <Text style={styles.rowLabel}>{row.label}</Text>
            <Switch
              accessibilityLabel={row.label}
              value={app.preferences.reminderTypes[row.key]}
              onValueChange={(value) =>
                void app.updatePreferences({
                  ...app.preferences,
                  reminderTypes: { ...app.preferences.reminderTypes, [row.key]: value },
                })
              }
            />
          </View>
        ))}
      </Card>

      <SectionHeader title="Display" />
      <Card style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.rowLabel}>24-hour time</Text>
            <Text style={styles.rowHint}>Show 13:00 rather than 1:00pm</Text>
          </View>
          <Switch
            accessibilityLabel="24-hour time"
            value={app.display.use24HourTime}
            onValueChange={(value) =>
              void app.updateDisplay({ ...app.display, use24HourTime: value })
            }
          />
        </View>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.rowLabel}>Parents association events</Text>
            <Text style={styles.rowHint}>Hidden by default</Text>
          </View>
          <Switch
            accessibilityLabel="Show parents association events"
            value={app.display.showParentAssociation}
            onValueChange={(value) =>
              void app.updateDisplay({ ...app.display, showParentAssociation: value })
            }
          />
        </View>
      </Card>

      <SectionHeader title="Calendar source" />
      <Card style={styles.card}>
        <Text style={styles.rowLabel}>{DEFAULT_SCHOOL.name}</Text>
        <Text style={styles.rowHint}>
          {app.syncStatus.lastSuccessAt
            ? `Last updated ${formatRelativeInstant(app.syncStatus.lastSuccessAt, new Date().toISOString())}.`
            : 'Never successfully updated.'}
        </Text>
        {app.lastSyncError ? (
          <Text style={[styles.rowHint, { color: colors.critical }]}>{app.lastSyncError}</Text>
        ) : null}

        <Button
          label={app.syncing ? 'Refreshing…' : 'Refresh now'}
          variant="secondary"
          disabled={app.syncing}
          onPress={() => void app.refresh({ force: true })}
        />

        <Text style={styles.rowHint}>
          If the school changes its calendar feed address, paste the new one here.
        </Text>
        <TextInput
          accessibilityLabel="Calendar feed address"
          placeholder={DEFAULT_SCHOOL.calendarFeedUrl}
          placeholderTextColor={colors.inkFaint}
          value={feedUrl}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setFeedUrlDraft}
          style={styles.input}
        />
        <Button
          label="Use this feed"
          variant="secondary"
          disabled={feedUrl.trim().length === 0}
          onPress={() => {
            void app.updateFeedUrl(feedUrl.trim());
            setFeedUrlDraft('');
          }}
        />
      </Card>

      <SectionHeader title="Privacy" />
      <Card style={styles.card}>
        <Text style={styles.rowHint}>
          ClassCal reads only the school&apos;s public calendar. Your children&apos;s names and
          classes are stored on this phone and are never sent anywhere — not to the school, not to
          us, and not to any AI model.
        </Text>
        <Button label="Clear family data" variant="danger" onPress={confirmClear} />
      </Card>

      {__DEV__ ? (
        <>
          <SectionHeader title="Developer" />
          <Card style={styles.card}>
            <Button
              label="Open review queue"
              variant="secondary"
              onPress={() => router.push('/review')}
            />
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  card: {
    gap: spacing.md,
  },
  childRow: {
    gap: spacing.xs,
  },
  childClass: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.inkMuted,
  },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    ...typography.body,
    fontSize: 16,
    color: colors.ink,
  },
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchRow: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  switchText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    ...typography.body,
    fontSize: 16,
    color: colors.ink,
  },
  rowHint: {
    ...typography.caption,
    color: colors.inkMuted,
    lineHeight: 19,
  },
  rowState: {
    ...typography.badge,
    color: colors.inkFaint,
  },
  rowStateOn: {
    color: colors.accent,
  },
});
