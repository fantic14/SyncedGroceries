import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState, type ComponentRef } from 'react';
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

import { colors } from '../../theme';
import {
  ITEM_TITLE_LIMIT,
  NOTE_LIMIT,
  QUANTITY_LIMIT,
  type GroceryItem,
} from './state';
import { useHousehold } from './useHousehold';

type Tab = 'groceries' | 'notes';

export function HouseholdScreen({
  onOpenIdentity,
}: {
  onOpenIdentity: () => void;
}) {
  const household = useHousehold();
  const [tab, setTab] = useState<Tab>('groceries');
  const { state } = household;

  if (state === null) {
    return (
      <SafeAreaView style={styles.screen}>
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
              <Text style={styles.centeredText}>
                Opening your shared shelf…
              </Text>
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
            <View style={styles.brandRow}>
              <View style={styles.brand}>
                <View style={styles.brandMark}>
                  <Ionicons
                    name="basket-outline"
                    size={25}
                    color={colors.surface}
                  />
                </View>
                <Text style={styles.brandName}>synced groceries</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Household and account"
                onPress={onOpenIdentity}
                style={styles.homeMark}
              >
                <Ionicons name="home-outline" size={21} color={colors.green} />
              </Pressable>
            </View>

            <View style={styles.hero}>
              <Text style={styles.eyebrow}>LIFE UNDER ONE ROOF</Text>
              <Text accessibilityRole="header" style={styles.title}>
                Our shared shelf.
              </Text>
              <Text style={styles.subtitle}>
                Less “did you get milk?” More living together.
              </Text>
            </View>

            <View style={styles.tabs}>
              <TabButton
                title="Groceries"
                icon="basket-outline"
                selected={tab === 'groceries'}
                onPress={() => setTab('groceries')}
              />
              <TabButton
                title="House notes"
                icon="document-text-outline"
                selected={tab === 'notes'}
                onPress={() => setTab('notes')}
              />
            </View>

            {tab === 'groceries' ? (
              <>
                <AddItemForm onAdd={household.addItem} />

                <View style={styles.sectionHeading}>
                  <Text accessibilityRole="header" style={styles.sectionTitle}>
                    The grocery list
                  </Text>
                  <View style={styles.countBadge}>
                    <Text style={styles.countText}>
                      {pending.length} to get
                    </Text>
                  </View>
                </View>

                {state.items.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Ionicons
                      name="leaf-outline"
                      size={36}
                      color={colors.green}
                    />
                    <Text style={styles.emptyTitle}>A fresh start.</Text>
                    <Text style={styles.centeredText}>
                      Add your first item above. Dinner starts here.
                    </Text>
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
                      {pending.length === 0
                        ? 'Everything’s in the bag. Nice teamwork!'
                        : `${completed.length} already in the bag`}
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
              <>
                <View style={styles.sectionHeading}>
                  <Text accessibilityRole="header" style={styles.sectionTitle}>
                    Little things to remember
                  </Text>
                </View>
                <View style={styles.noteCard}>
                  <View style={styles.noteHeading}>
                    <Ionicons name="pin-outline" size={20} color={colors.ink} />
                    <Text style={styles.noteLabel}>A NOTE FOR THE HOUSE</Text>
                  </View>
                  <TextInput
                    accessibilityLabel="Household note"
                    multiline
                    maxLength={NOTE_LIMIT}
                    onChangeText={household.updateNote}
                    placeholder={
                      'Oat milk for coffee? Dinner plans?\n\nLeave the little reminders here.'
                    }
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
                <Text style={styles.caption}>
                  A home for favourite brands, meal ideas, and kitchen
                  reminders. Changes save automatically.
                </Text>
              </>
            )}

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

            <View style={styles.previewCard}>
              <View style={styles.previewIcon}>
                <Ionicons
                  name="people-outline"
                  size={22}
                  color={colors.green}
                />
              </View>
              <View style={styles.flex}>
                <Text style={styles.previewTitle}>Made for your people.</Text>
                <Text style={styles.previewText}>
                  This preview list stays on your phone. Set up your household
                  separately; shared groceries are coming next.
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={onOpenIdentity}
              style={styles.primaryButton}
            >
              <Ionicons
                name="people-outline"
                size={20}
                color={colors.surface}
              />
              <Text style={styles.primaryButtonText}>Household & account</Text>
            </Pressable>
            <Text style={styles.footer}>
              A little less house admin. A little more home.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function TabButton({
  title,
  icon,
  selected,
  onPress,
}: {
  title: string;
  icon: 'basket-outline' | 'document-text-outline';
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        selected && styles.selectedTab,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons
        name={icon}
        size={19}
        color={selected ? colors.surface : colors.muted}
      />
      <Text style={[styles.tabText, selected && styles.selectedTabText]}>
        {title}
      </Text>
    </Pressable>
  );
}

function AddItemForm({
  onAdd,
}: {
  onAdd: (title: string, quantity: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [quantity, setQuantity] = useState('');
  const titleInput = useRef<ComponentRef<typeof TextInput>>(null);
  const canAdd = title.trim().length > 0;

  function submit() {
    if (!canAdd) return;
    onAdd(title, quantity);
    setTitle('');
    setQuantity('');
    titleInput.current?.focus();
  }

  return (
    <View style={styles.formCard}>
      <Text style={styles.formTitle}>What do we need?</Text>
      <View style={styles.fields}>
        <View style={styles.itemField}>
          <Text style={styles.fieldLabel}>Item</Text>
          <TextInput
            ref={titleInput}
            accessibilityLabel="Grocery item name"
            maxLength={ITEM_TITLE_LIMIT}
            onChangeText={setTitle}
            onSubmitEditing={submit}
            placeholder="e.g. Oat milk"
            placeholderTextColor={colors.muted}
            returnKeyType="done"
            style={styles.input}
            value={title}
          />
        </View>
        <View style={styles.quantityField}>
          <Text style={styles.fieldLabel}>How much?</Text>
          <TextInput
            accessibilityLabel="Quantity, for example 2 cartons"
            maxLength={QUANTITY_LIMIT}
            onChangeText={setQuantity}
            onSubmitEditing={submit}
            placeholder="1"
            placeholderTextColor={colors.muted}
            returnKeyType="done"
            style={styles.input}
            value={quantity}
          />
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canAdd }}
        disabled={!canAdd}
        onPress={submit}
        style={({ pressed }) => [
          styles.primaryButton,
          !canAdd && styles.disabledButton,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="add" size={21} color={colors.surface} />
        <Text style={styles.primaryButtonText}>Add to the list</Text>
      </Pressable>
    </View>
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
          <Text style={styles.itemQuantity}>{item.quantity}</Text>
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
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  brandMark: {
    width: 43,
    height: 43,
    borderRadius: 14,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.5,
    flexShrink: 1,
  },
  homeMark: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.paleGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { gap: 9, marginTop: 16, marginBottom: 4 },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.green,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1.4,
    color: colors.ink,
  },
  subtitle: { fontSize: 15, lineHeight: 23, color: colors.muted },
  tabs: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.paleGreen,
    borderRadius: 18,
    padding: 5,
  },
  tab: {
    flex: 1,
    minHeight: 46,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  selectedTab: { backgroundColor: colors.green },
  tabText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.muted,
    flexShrink: 1,
  },
  selectedTabText: { color: colors.surface },
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 16,
  },
  formTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  fields: { flexDirection: 'row', gap: 12 },
  itemField: { flex: 2 },
  quantityField: { flex: 1 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 7,
  },
  input: {
    minHeight: 48,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
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
  disabledButton: { opacity: 0.55 },
  pressed: { opacity: 0.7 },
  sectionHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: colors.ink,
    flexShrink: 1,
  },
  countBadge: {
    borderRadius: 10,
    backgroundColor: colors.lime,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  countText: { fontSize: 12, fontWeight: '700', color: colors.ink },
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
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
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
  noteHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noteLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
    color: colors.ink,
    flexShrink: 1,
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
    justifyContent: 'center',
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
  previewCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 18,
    padding: 16,
    backgroundColor: colors.paleGreen,
  },
  previewIcon: { paddingTop: 2 },
  previewTitle: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 5,
  },
  previewText: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  footer: {
    color: colors.muted,
    textAlign: 'center',
    fontSize: 10,
    lineHeight: 17,
  },
});
