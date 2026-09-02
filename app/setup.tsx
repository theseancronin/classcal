/**
 * First-launch setup: welcome, class selection, then optional child names.
 *
 * At least one class is required; nothing else is. Everything chosen here stays
 * on the device.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '@/state/AppProvider';
import { CLASS_LABELS, SELECTABLE_CLASSES, type Child, type SelectableClass } from '@/domain/types';
import { newChildId } from '@/family/store';
import { requestPermission } from '@/notifications/delivery';
import { Button, ScreenTitle } from '@/ui/components';
import { MIN_TOUCH_TARGET, colors, radius, spacing, typography } from '@/ui/theme';

type Step = 'welcome' | 'classes' | 'names';

export default function SetupScreen() {
  const { family, updateFamily } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>(family.children.length > 0 ? 'classes' : 'welcome');
  const [selected, setSelected] = useState<SelectableClass[]>(() =>
    family.children.map((child) => child.schoolClass),
  );
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(family.children.map((c) => [c.schoolClass, c.name ?? ''])),
  );

  const toggle = (schoolClass: SelectableClass) => {
    setSelected((current) =>
      current.includes(schoolClass)
        ? current.filter((c) => c !== schoolClass)
        : [...current, schoolClass],
    );
  };

  const finish = async () => {
    const children: Child[] = selected.map((schoolClass) => {
      const name = names[schoolClass]?.trim();
      return {
        id: newChildId(schoolClass),
        schoolClass,
        ...(name ? { name } : {}),
      };
    });

    await updateFamily({ children, setupCompletedAt: new Date().toISOString() });
    // Asked for after setup so the request has obvious context.
    await requestPermission().catch(() => false);
    router.replace('/');
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.container,
        { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      {step === 'welcome' ? (
        <View style={styles.stepBody}>
          <ScreenTitle>Your school calendar, without the clutter.</ScreenTitle>
          <Text style={styles.lead}>
            Select the classes relevant to your family and ClassCal will show the school events you
            need to know about — closures, early finishes, meetings and your children&apos;s own
            activities.
          </Text>
          <Text style={styles.privacy}>
            Everything you enter stays on this phone. No account, no sign-in.
          </Text>
          <Button label="Get started" onPress={() => setStep('classes')} />
        </View>
      ) : null}

      {step === 'classes' ? (
        <View style={styles.stepBody}>
          <ScreenTitle>Which classes?</ScreenTitle>
          <Text style={styles.lead}>Choose every class your children are in.</Text>

          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="School classes"
            style={styles.classList}
          >
            {SELECTABLE_CLASSES.map((schoolClass) => {
              const isSelected = selected.includes(schoolClass);
              return (
                <Pressable
                  key={schoolClass}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={CLASS_LABELS[schoolClass]}
                  onPress={() => toggle(schoolClass)}
                  style={[styles.classOption, isSelected && styles.classOptionSelected]}
                >
                  {/* A tick as well as a colour change, so selection is not
                      conveyed by colour alone. */}
                  <Text style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                    {isSelected ? '✓' : ''}
                  </Text>
                  <Text style={[styles.classLabel, isSelected && styles.classLabelSelected]}>
                    {CLASS_LABELS[schoolClass]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {selected.length === 0 ? (
            <Text style={styles.requirement}>Choose at least one class to continue.</Text>
          ) : null}

          <Button
            label="Continue"
            disabled={selected.length === 0}
            onPress={() => setStep('names')}
          />
        </View>
      ) : null}

      {step === 'names' ? (
        <View style={styles.stepBody}>
          <ScreenTitle>Name your children?</ScreenTitle>
          <Text style={styles.lead}>
            Optional. Names make event cards easier to scan — &ldquo;Aoife · Junior Infants&rdquo;
            rather than just the class. They never leave this phone.
          </Text>

          {selected.map((schoolClass) => (
            <View key={schoolClass} style={styles.nameRow}>
              <Text style={styles.nameClass}>{CLASS_LABELS[schoolClass]}</Text>
              <TextInput
                accessibilityLabel={`Child's name for ${CLASS_LABELS[schoolClass]}`}
                placeholder="Name (optional)"
                placeholderTextColor={colors.inkFaint}
                value={names[schoolClass] ?? ''}
                maxLength={40}
                onChangeText={(text) =>
                  setNames((current) => ({ ...current, [schoolClass]: text }))
                }
                style={styles.nameInput}
              />
            </View>
          ))}

          <Button label="Show my calendar" onPress={() => void finish()} />
          <Button label="Back" variant="secondary" onPress={() => setStep('classes')} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    flexGrow: 1,
    justifyContent: 'center',
  },
  stepBody: {
    gap: spacing.lg,
  },
  lead: {
    ...typography.body,
    color: colors.inkMuted,
    lineHeight: 22,
  },
  privacy: {
    ...typography.caption,
    color: colors.inkFaint,
  },
  classList: {
    gap: spacing.sm,
  },
  classOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  classOptionSelected: {
    borderColor: colors.accent,
    borderWidth: 2,
    backgroundColor: colors.accentSurface,
  },
  checkbox: {
    width: 22,
    height: 22,
    lineHeight: 22,
    textAlign: 'center',
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    color: colors.onAccent,
    overflow: 'hidden',
    fontSize: 14,
    fontWeight: '700',
  },
  checkboxSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  classLabel: {
    ...typography.body,
    fontSize: 16,
    color: colors.ink,
  },
  classLabelSelected: {
    fontWeight: '600',
  },
  requirement: {
    ...typography.caption,
    color: colors.critical,
  },
  nameRow: {
    gap: spacing.xs,
  },
  nameClass: {
    ...typography.caption,
    color: colors.inkMuted,
    fontWeight: '600',
  },
  nameInput: {
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
});
