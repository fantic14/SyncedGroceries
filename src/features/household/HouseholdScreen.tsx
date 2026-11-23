import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GroceryComposer } from '../../components/GroceryComposer';
import Ionicons from '../../components/Ionicons';
import {
  ListScopeSwitch,
  ListTabs,
  type ListTab,
} from '../../components/ListNavigation';
import { colors } from '../../theme';
import { NOTE_LIMIT, type GroceryItem } from './state';
import { useHousehold } from './useHousehold';

export function HouseholdScreen({
  onOpenIdentity,
}: {
  onOpenIdentity: () => void;
}) {
  const household = useHousehold();
  const [tab, setTab] = useState<ListTab>('groceries');
  const { state } = household;

  if (state === null) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.loadingScope}>
          <ListScopeSwitch scope="phone" onSwitch={onOpenIdentity} />
        </View>
        <View style={styles.centered}>
          {household.loadError ? (
            <>
              <Ionicons
                name="alert-circle-outline"
                size={36}
                color={colors.danger}
              />
              <Text style={styles.emptyTitle}>Couldn’t open your list</Text>
              <Text style={styles.centeredText}>
                Your saved data hasn’t been changed. Try opening it again.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={household.retryLoad}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Try again</Text>
              </Pressable>
            </>
          ) : (
            <>
              <ActivityIndicator size="large" color={colors.green} />
              <Text style={styles.centeredText}>Opening your list…</Text>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const pending = state.items.filter((item) => !item.completed);
  const completed = state.items.filter((item) => item.completed);

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.content}>
            <ListScopeSwitch scope="phone" onSwitch={onOpenIdentity} />
            <View>
              <Text accessibilityRole="header" style={styles.title}>
                Personal list
              </Text>
              <View accessibilityLiveRegion="polite" style={styles.saveRow}>
                <Ionicons
                  name={
                    household.saveStatus === 'error'
                      ? 'alert-circle-outline'
                      : household.saveStatus === 'saving'
                        ? 'time-outline'
                        : 'checkmark-circle-outline'
                  }
                  size={16}
                  color={
                    household.saveStatus === 'error'
                      ? colors.danger
                      : colors.muted
                  }
                />
                <Text
                  style={[
                    styles.saveText,
                    household.saveStatus === 'error' && styles.errorText,
                  ]}
                >
                  {household.saveStatus === 'error'
                    ? 'Couldn’t save. Keep the app open and retry.'
                    : household.saveStatus === 'saving'
                      ? 'Saving changes…'
                      : 'Saved on this phone'}
                </Text>
                {household.saveStatus === 'error' && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={household.retrySave}
                    style={styles.textButton}
                  >
                    <Text style={styles.textButtonText}>Retry</Text>
                  </Pressable>
                )}
              </View>
            </View>
            <ListTabs tab={tab} onSelect={setTab} />

            {tab === 'groceries' ? (
              <>
                <GroceryComposer onAdd={household.addItem} />

                {state.items.length > 0 && (
                  <Text accessibilityRole="header" style={styles.sectionTitle}>
                    {pending.length} to get
                  </Text>
                )}

                {state.items.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Text style={styles.centeredText}>No groceries yet</Text>
                  </View>
                ) : (
                  <View style={styles.listCard}>
                    {[...pending, ...completed].map((item, index) => (
                      <GroceryRow
                        key={item.id}
                        item={item}
                        last={index === state.items.length - 1}
                        onToggle={() => household.toggleItem(item.id)}
                        onRemove={() => household.removeItem(item.id)}
                      />
                    ))}
                  </View>
                )}

                {completed.length > 0 && (
                  <View style={styles.completedRow}>
                    <Text style={styles.caption}>
                      {completed.length} bought
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Remove all bought groceries"
                      onPress={household.clearCompleted}
                      style={styles.textButton}
                    >
                      <Text style={styles.textButtonText}>Clear bought</Text>
                    </Pressable>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.noteCard}>
                <TextInput
                  accessibilityLabel="Personal note"
                  multiline
                  maxLength={NOTE_LIMIT}
                  onChangeText={household.updateNote}
                  placeholder="Write a personal note…"
                  placeholderTextColor={colors.muted}
                  style={styles.noteInput}
                  textAlignVertical="top"
                  value={state.note}
                />
                <Text style={styles.noteCount}>
                  {state.note.length.toLocaleString()} /{' '}
                  {NOTE_LIMIT.toLocaleString()}
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function GroceryRow({
  item,
  last,
  onToggle,
  onRemove,
}: {
  item: GroceryItem;
  last: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={[styles.groceryRow, !last && styles.rowBorder]}>
      <Pressable
        accessibilityLabel={`${item.title}, ${item.quantity}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.completed }}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.groceryToggle,
          pressed && styles.pressed,
        ]}
      >
        <View style={[styles.checkbox, item.completed && styles.checkedBox]}>
          {item.completed && (
            <Ionicons name="checkmark" size={17} color={colors.surface} />
          )}
        </View>
        <View style={styles.flex}>
          <Text
            style={[styles.itemTitle, item.completed && styles.boughtTitle]}
          >
            {item.title}
          </Text>
          {item.quantity !== '1' && (
            <Text style={styles.itemQuantity}>{item.quantity}</Text>
          )}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.title}`}
        hitSlop={2}
        onPress={onRemove}
        style={({ pressed }) => [
          styles.removeButton,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="close-outline" size={21} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: 'center' },
  content: {
    width: '100%',
    maxWidth: 620,
    padding: 22,
    paddingBottom: 32,
    gap: 18,
  },
  loadingScope: {
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
    padding: 22,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 16,
  },
  centeredText: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1.4,
    color: colors.ink,
  },
  primaryButton: {
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 13,
    backgroundColor: colors.green,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: { color: colors.surface, fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: colors.ink,
    flexShrink: 1,
  },
  listCard: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  groceryRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  groceryToggle: {
    flex: 1,
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 13,
  },
  checkbox: {
    width: 25,
    height: 25,
    borderWidth: 1.5,
    borderColor: '#9DAF9F',
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkedBox: { backgroundColor: colors.green, borderColor: colors.green },
  itemTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 23,
  },
  boughtTitle: { color: colors.muted, textDecorationLine: 'line-through' },
  itemQuantity: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
    color: colors.muted,
  },
  removeButton: {
    width: 44,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: -12,
  },
  textButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  textButtonText: { fontSize: 12, fontWeight: '700', color: colors.green },
  caption: { fontSize: 12, lineHeight: 20, color: colors.muted, flexShrink: 1 },
  emptyCard: {
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    padding: 28,
    borderRadius: 22,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'center',
  },
  noteCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.noteBorder,
    backgroundColor: colors.note,
    padding: 20,
    gap: 18,
  },
  noteInput: {
    minHeight: 230,
    fontSize: 17,
    lineHeight: 28,
    color: colors.ink,
    padding: 0,
  },
  noteCount: { fontSize: 11, color: colors.muted, textAlign: 'right' },
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 24,
  },
  saveText: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 18,
    flexShrink: 1,
  },
  errorText: { color: colors.danger },
});
