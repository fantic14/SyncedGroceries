import Ionicons from '@expo/vector-icons/Ionicons';
import {
  useEffect,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
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
import { describeOwnChanges } from '../offline/recovery';
import type { SharedItem } from './types';
import type { SharedController } from './useSharedHousehold';

type Props = {
  householdName: string;
  members: Array<{ user_id: string; display_name: string }>;
  controller: SharedController;
  onClose: () => void;
};

export function SharedHouseholdScreen({
  householdName,
  members,
  controller,
  onClose,
}: Props) {
  const [tab, setTab] = useState<'groceries' | 'note'>('groceries');
  const [confirmClose, setConfirmClose] = useState(false);
  const [noteInput, setNoteInput] = useState(controller.noteDraft);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaveFailed, setDraftSaveFailed] = useState(false);
  const draftWrites = useRef(0);
  const draftVersion = useRef(0);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const { snapshot } = controller;
  const dirtyNote = snapshot !== null && noteInput !== snapshot.note.body;
  const blocked = controller.busy || controller.storageError !== null;

  useEffect(() => {
    if (draftWrites.current === 0 && !draftSaveFailed)
      setNoteInput(controller.noteDraft);
  }, [controller.noteDraft, savingDraft, draftSaveFailed]);

  async function changeDraft(body: string) {
    const version = ++draftVersion.current;
    draftWrites.current++;
    setNoteInput(body);
    setSavingDraft(true);
    const saved = await controller.updateNoteDraft(body);
    draftWrites.current--;
    if (version === draftVersion.current) setDraftSaveFailed(!saved);
    if (draftWrites.current === 0) setSavingDraft(false);
  }

  function close() {
    if (controller.busy) return;
    if (draftSaveFailed || savingDraft) {
      setConfirmClose(true);
      scroll.current?.scrollTo({ y: 0, animated: true });
    } else onClose();
  }

  useEffect(() => {
    if (
      controller.error ||
      controller.noteConflict ||
      controller.itemConflict
    ) {
      scroll.current?.scrollTo({ y: 0, animated: true });
    }
  }, [controller.error, controller.noteConflict, controller.itemConflict]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => listener.remove();
  }, [controller.busy, draftSaveFailed, savingDraft, onClose]);

  function attribution(userId: string | null, timestamp: string) {
    const name =
      userId === null
        ? 'Former housemate'
        : (members.find((member) => member.user_id === userId)?.display_name ??
          'Housemate');
    return `${name} · ${new Date(timestamp).toLocaleString()}`;
  }

  const items =
    snapshot?.items.filter((item) => item.deleted_at === null) ?? [];
  const sorted = [
    ...items.filter((item) => !item.completed),
    ...items.filter((item) => item.completed),
  ];
  const connectionLabel = {
    connecting: 'Connecting live updates…',
    live: 'Live updates connected',
    reconnecting: 'Reconnecting live updates…',
    error: 'Live updates unavailable',
  }[controller.connection];
  const syncLabel = {
    offline: 'Offline · changes stay saved on this phone',
    pending: 'Changes saved on this phone · waiting to sync',
    syncing: 'Syncing with your household…',
    synced: 'All queued changes acknowledged by your household',
    failed: 'Some edits need your attention',
    reauth:
      'Reconnect or sign in to confirm your account · saved edits are kept',
  }[controller.syncStatus];

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.content}>
            <View style={styles.header}>
              <View style={styles.brand}>
                <View style={styles.mark}>
                  <Ionicons
                    name="basket-outline"
                    size={24}
                    color={colors.surface}
                  />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.eyebrow}>OUR SHARED SHELF</Text>
                  <Text accessibilityRole="header" style={styles.title}>
                    {householdName}
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to household"
                accessibilityState={{ disabled: controller.busy }}
                disabled={controller.busy}
                onPress={close}
                style={[styles.iconButton, controller.busy && styles.dimmed]}
              >
                <Ionicons name="close-outline" size={25} color={colors.ink} />
              </Pressable>
            </View>

            {confirmClose && (
              <Card tone="note">
                <Text accessibilityRole="header" style={styles.sectionTitle}>
                  Leave this shared list?
                </Text>
                <Text style={styles.body}>
                  Your latest note text has not been saved on this phone. Retry
                  saving it before leaving, or discard that local text.
                </Text>
                <Button
                  title="Stay here"
                  onPress={() => setConfirmClose(false)}
                />
                <Button
                  title="Leave for now"
                  secondary
                  disabled={controller.busy}
                  onPress={onClose}
                />
              </Card>
            )}

            <View accessibilityLiveRegion="polite" style={styles.connectionRow}>
              {controller.loading || controller.busy ? (
                <ActivityIndicator size="small" color={colors.green} />
              ) : (
                <Ionicons
                  name={
                    controller.connection === 'live'
                      ? 'radio-outline'
                      : 'cloud-offline-outline'
                  }
                  size={17}
                  color={colors.muted}
                />
              )}
              <Text style={styles.caption}>
                {controller.busy ? 'Saving on this phone…' : syncLabel}
              </Text>
            </View>
            <Text style={styles.caption}>{connectionLabel}</Text>

            {controller.error && (
              <View accessibilityRole="alert" style={styles.errorCard}>
                <Text style={styles.errorText}>{controller.error}</Text>
              </View>
            )}
            {controller.pending && (
              <Card tone="note">
                <Text style={styles.sectionTitle}>
                  {controller.queuedCount} saved changes ·{' '}
                  {controller.failedCount} need attention
                </Text>
                <Text style={styles.body}>
                  These edits are saved on this phone and survive an app
                  restart. You can keep editing offline. Sync resumes when your
                  connection and sign-in are ready.
                </Text>
                <Button
                  title={controller.busy ? 'Saving…' : 'Retry syncing'}
                  disabled={controller.busy}
                  onPress={() => void controller.retry()}
                />
              </Card>
            )}
            {controller.storageError && (
              <Card tone="note">
                <Text style={styles.sectionTitle}>
                  Couldn’t save on this phone
                </Text>
                <Text style={styles.body}>
                  {controller.storageError} Your last confirmed local data has
                  been kept.
                </Text>
                <Button
                  title="Retry local storage"
                  disabled={controller.busy}
                  onPress={() => void controller.retry()}
                />
              </Card>
            )}
            {controller.syncStatus === 'reauth' && (
              <Button title="Return to account to sign in" onPress={onClose} />
            )}
            {controller.failedDetails.length > 0 && (
              <Card tone="note">
                <Text style={styles.sectionTitle}>
                  Your saved edits need review
                </Text>
                {controller.failedDetails.map((edit) => (
                  <View key={edit.id}>
                    <Text style={styles.body}>{edit.message}</Text>
                    <Text selectable style={styles.caption}>
                      {edit.body ?? describeOwnChanges(edit.changes ?? {})}
                    </Text>
                    <Button
                      title="Discard this rejected edit"
                      secondary
                      disabled={controller.busy}
                      onPress={() => void controller.discardFailed(edit.id)}
                    />
                  </View>
                ))}
              </Card>
            )}

            {controller.itemConflict && (
              <Card tone="note">
                <Text accessibilityRole="header" style={styles.sectionTitle}>
                  This grocery changed.
                </Text>
                <Text style={styles.body}>
                  {controller.itemConflict.deleted_at
                    ? 'A housemate removed this item. It won’t be added back by an older edit.'
                    : `Latest version: ${controller.itemConflict.title} · ${controller.itemConflict.quantity}${controller.itemConflict.completed ? ' · bought' : ''}. Review the item and edit it again if needed.`}
                </Text>
                <Button
                  title="Discard the conflicting edit and use latest"
                  secondary
                  onPress={() => void controller.dismissItemConflict()}
                />
              </Card>
            )}

            {controller.noteConflict && tab !== 'note' && (
              <Card tone="note">
                <Text style={styles.sectionTitle}>
                  Your note has a newer shared version.
                </Text>
                <Text style={styles.body}>
                  Your draft is preserved. Compare both versions before saving.
                </Text>
                <Button
                  title="Review the note"
                  onPress={() => setTab('note')}
                />
              </Card>
            )}

            {snapshot === null ? (
              <Card>
                <Text style={styles.sectionTitle}>
                  {controller.loading
                    ? 'Opening the shared shelf…'
                    : 'Couldn’t open the shared shelf'}
                </Text>
                {!controller.loading && (
                  <Button
                    title="Try again"
                    disabled={controller.busy}
                    onPress={() => void controller.refresh()}
                  />
                )}
              </Card>
            ) : (
              <>
                <View style={styles.tabs}>
                  {(['groceries', 'note'] as const).map((value) => (
                    <Pressable
                      key={value}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: tab === value }}
                      onPress={() => setTab(value)}
                      style={[styles.tab, tab === value && styles.selectedTab]}
                    >
                      <Ionicons
                        name={
                          value === 'groceries'
                            ? 'basket-outline'
                            : 'document-text-outline'
                        }
                        size={18}
                        color={tab === value ? colors.surface : colors.green}
                      />
                      <Text
                        style={[
                          styles.tabText,
                          tab === value && styles.selectedTabText,
                        ]}
                      >
                        {value === 'groceries' ? 'Groceries' : 'House note'}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {tab === 'groceries' ? (
                  <>
                    <AddForm disabled={blocked} onAdd={controller.addItem} />
                    <View style={styles.sectionHeading}>
                      <Text
                        accessibilityRole="header"
                        style={styles.sectionTitle}
                      >
                        The grocery list
                      </Text>
                      <Text style={styles.count}>
                        {items.filter((item) => !item.completed).length} to get
                      </Text>
                    </View>
                    {sorted.length === 0 ? (
                      <Card>
                        <Text style={styles.body}>
                          Your shared list is empty. Add the first thing your
                          household needs.
                        </Text>
                      </Card>
                    ) : (
                      sorted.map((item) => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          disabled={blocked}
                          onUpdate={controller.updateItem}
                          attribution={attribution(
                            item.updated_by,
                            item.updated_at,
                          )}
                        />
                      ))
                    )}
                  </>
                ) : (
                  <>
                    <Card tone="note">
                      <Text
                        accessibilityRole="header"
                        style={styles.sectionTitle}
                      >
                        A note for the house
                      </Text>
                      <TextInput
                        accessibilityLabel="Shared household note"
                        multiline
                        textAlignVertical="top"
                        maxLength={2000}
                        editable={controller.storageError === null}
                        value={noteInput}
                        onChangeText={(body) => void changeDraft(body)}
                        style={styles.noteInput}
                        placeholder="Favourite brands, kitchen reminders, dinner plans…"
                        placeholderTextColor={colors.muted}
                      />
                      <View style={styles.sectionHeading}>
                        <Text style={styles.caption}>
                          {savingDraft
                            ? 'Saving draft on this phone…'
                            : draftSaveFailed
                              ? 'Latest text is not saved'
                              : dirtyNote
                                ? 'Draft saved on this phone · not shared yet'
                                : 'Saved on this phone · check sync status above'}
                        </Text>
                        <Text style={styles.caption}>
                          {noteInput.length} / 2000
                        </Text>
                      </View>
                      <Text style={styles.caption}>
                        Latest visible edit:{' '}
                        {attribution(
                          snapshot.note.updated_by,
                          snapshot.note.updated_at,
                        )}
                      </Text>
                      <Button
                        title={
                          controller.busy ? 'Saving…' : 'Save household note'
                        }
                        disabled={
                          blocked ||
                          savingDraft ||
                          draftSaveFailed ||
                          !dirtyNote ||
                          controller.noteConflict !== null
                        }
                        onPress={() => void controller.saveNote()}
                      />
                      {draftSaveFailed && (
                        <Button
                          title="Retry saving my draft locally"
                          disabled={savingDraft}
                          onPress={() => void changeDraft(noteInput)}
                        />
                      )}
                    </Card>

                    {controller.noteConflict && (
                      <Card>
                        <Text
                          accessibilityRole="header"
                          style={styles.sectionTitle}
                        >
                          Your housemate saved a different note.
                        </Text>
                        <Text style={styles.body}>
                          Your draft is still in the editor above. Compare it
                          with the latest shared version before choosing.
                        </Text>
                        <Text style={styles.fieldLabel}>
                          LATEST SHARED VERSION
                        </Text>
                        <Text selectable style={styles.conflictBody}>
                          {controller.noteConflict.body || '(Empty note)'}
                        </Text>
                        <Text style={styles.caption}>
                          {attribution(
                            controller.noteConflict.updated_by,
                            controller.noteConflict.updated_at,
                          )}
                        </Text>
                        <Button
                          title="Use shared version and discard my queued note edits"
                          secondary
                          disabled={blocked}
                          onPress={() => {
                            setDraftSaveFailed(false);
                            void controller.useServerNote();
                          }}
                        />
                        <Button
                          title="Save my draft for the household"
                          disabled={blocked || savingDraft || draftSaveFailed}
                          onPress={() => void controller.keepMyNote()}
                        />
                      </Card>
                    )}
                  </>
                )}
              </>
            )}

            <Button
              title={controller.loading ? 'Refreshing…' : 'Refresh shared list'}
              secondary
              disabled={controller.busy || controller.loading}
              onPress={() => void controller.refresh()}
            />
            <Text style={styles.footer}>
              Drafts and queued edits are saved on this phone. They reach your
              household after reconnecting. Explicit sign-out removes this
              account’s local cache. Your local preview remains separate.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AddForm({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (title: string, quantity: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState('');
  const [quantity, setQuantity] = useState('');
  async function submit() {
    if (disabled || !title.trim()) return;
    const itemTitle = title.trim();
    const itemQuantity = quantity.trim() || '1';
    // Clear only after the item and its outbox entry are durably committed.
    if (await onAdd(itemTitle, itemQuantity)) {
      setTitle('');
      setQuantity('');
    }
  }
  return (
    <Card>
      <Text style={styles.sectionTitle}>What do we need?</Text>
      <View style={styles.fields}>
        <View style={styles.itemField}>
          <Text style={styles.fieldLabel}>Item</Text>
          <TextInput
            accessibilityLabel="Shared grocery item name"
            editable={!disabled}
            maxLength={120}
            value={title}
            onChangeText={setTitle}
            onSubmitEditing={submit}
            placeholder="e.g. Oat milk"
            placeholderTextColor={colors.muted}
            returnKeyType="done"
            style={styles.input}
          />
        </View>
        <View style={styles.quantityField}>
          <Text style={styles.fieldLabel}>How much?</Text>
          <TextInput
            accessibilityLabel="Shared grocery quantity"
            editable={!disabled}
            maxLength={40}
            value={quantity}
            onChangeText={setQuantity}
            onSubmitEditing={submit}
            placeholder="1"
            placeholderTextColor={colors.muted}
            returnKeyType="done"
            style={styles.input}
          />
        </View>
      </View>
      <Button
        title="Add to our list"
        disabled={disabled || !title.trim()}
        onPress={submit}
      />
    </Card>
  );
}

function ItemCard({
  item,
  disabled,
  onUpdate,
  attribution,
}: {
  item: SharedItem;
  disabled: boolean;
  onUpdate: SharedController['updateItem'];
  attribution: string;
}) {
  const [editing, setEditing] = useState(false);
  const [deletionBase, setDeletionBase] = useState<SharedItem | null>(null);
  const [editBase, setEditBase] = useState(item);
  const [title, setTitle] = useState(item.title);
  const [quantity, setQuantity] = useState(item.quantity);

  function startEditing() {
    setEditBase(item);
    setTitle(item.title);
    setQuantity(item.quantity);
    setEditing(true);
    setDeletionBase(null);
  }
  async function save() {
    if (disabled || !title.trim()) return;
    const changes: { title?: string; quantity?: string } = {};
    if (title.trim() !== editBase.title) changes.title = title.trim();
    if ((quantity.trim() || '1') !== editBase.quantity)
      changes.quantity = quantity.trim() || '1';
    if (
      Object.keys(changes).length === 0 ||
      (await onUpdate(editBase, changes))
    )
      setEditing(false);
  }

  return (
    <Card>
      <View style={styles.itemHeading}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={`${item.title}, ${item.quantity}`}
          accessibilityState={{ checked: item.completed, disabled }}
          disabled={disabled}
          onPress={() => void onUpdate(item, { completed: !item.completed })}
          style={[styles.checkTarget, disabled && styles.dimmed]}
        >
          <View style={[styles.checkbox, item.completed && styles.checkedBox]}>
            {item.completed && (
              <Ionicons name="checkmark" size={18} color={colors.surface} />
            )}
          </View>
          <View style={styles.flex}>
            <Text style={[styles.itemTitle, item.completed && styles.bought]}>
              {item.title}
            </Text>
            <Text style={styles.body}>{item.quantity}</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${item.title}`}
          disabled={disabled}
          onPress={startEditing}
          style={[styles.iconButton, disabled && styles.dimmed]}
        >
          <Ionicons name="pencil-outline" size={20} color={colors.green} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${item.title}`}
          disabled={disabled}
          onPress={() => {
            setDeletionBase(item);
            setEditing(false);
          }}
          style={[styles.iconButton, disabled && styles.dimmed]}
        >
          <Ionicons name="trash-outline" size={20} color={colors.muted} />
        </Pressable>
      </View>
      <Text style={styles.caption}>Updated by {attribution}</Text>

      {editing && (
        <View style={styles.editForm}>
          <Text style={styles.fieldLabel}>Item name</Text>
          <TextInput
            accessibilityLabel={`New name for ${item.title}`}
            editable={!disabled}
            maxLength={120}
            value={title}
            onChangeText={setTitle}
            style={styles.input}
          />
          <Text style={styles.fieldLabel}>Quantity</Text>
          <TextInput
            accessibilityLabel={`New quantity for ${item.title}`}
            editable={!disabled}
            maxLength={40}
            value={quantity}
            onChangeText={setQuantity}
            style={styles.input}
          />
          <Button
            title="Save item"
            disabled={disabled || !title.trim()}
            onPress={() => void save()}
          />
          <Button
            title="Cancel editing"
            secondary
            disabled={disabled}
            onPress={() => setEditing(false)}
          />
        </View>
      )}

      {deletionBase && (
        <View style={styles.editForm}>
          <Text style={styles.body}>
            Remove {deletionBase.title} from your household’s list?
          </Text>
          <Button
            title="Remove item"
            danger
            disabled={disabled}
            onPress={() => void onUpdate(deletionBase, { deleted: true })}
          />
          <Button
            title="Keep item"
            secondary
            disabled={disabled}
            onPress={() => setDeletionBase(null)}
          />
        </View>
      )}
    </Card>
  );
}

function Card({ children, tone }: { children: ReactNode; tone?: 'note' }) {
  return (
    <View style={[styles.card, tone === 'note' && styles.noteCard]}>
      {children}
    </View>
  );
}

function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
  danger = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondaryButton,
        danger && !secondary && styles.dangerButton,
        disabled && styles.dimmed,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          secondary && styles.secondaryButtonText,
          danger && secondary && styles.dangerText,
        ]}
      >
        {title}
      </Text>
    </Pressable>
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
    paddingBottom: 36,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 3,
  },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  mark: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    color: colors.green,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 5,
  },
  title: {
    color: colors.ink,
    fontSize: 23,
    lineHeight: 29,
    fontWeight: '800',
    letterSpacing: -0.7,
  },
  iconButton: {
    width: 44,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 18,
    gap: 13,
  },
  noteCard: { backgroundColor: colors.note, borderColor: colors.noteBorder },
  sectionTitle: {
    color: colors.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  body: { color: colors.muted, fontSize: 14, lineHeight: 22 },
  caption: { color: colors.muted, fontSize: 11, lineHeight: 18, flexShrink: 1 },
  errorCard: {
    borderWidth: 1,
    borderColor: colors.danger,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 21 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.paleGreen,
    borderRadius: 16,
    padding: 5,
    gap: 6,
  },
  tab: {
    flex: 1,
    minHeight: 45,
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  selectedTab: { backgroundColor: colors.green },
  tabText: {
    color: colors.green,
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  selectedTabText: { color: colors.surface },
  sectionHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  count: {
    color: colors.ink,
    backgroundColor: colors.lime,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: '700',
  },
  fields: { flexDirection: 'row', gap: 12 },
  itemField: { flex: 2 },
  quantityField: { flex: 1 },
  fieldLabel: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    color: colors.ink,
    backgroundColor: colors.background,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  button: {
    backgroundColor: colors.green,
    borderWidth: 1,
    borderColor: colors.green,
    borderRadius: 12,
    minHeight: 46,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: colors.surface,
    fontWeight: '700',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  secondaryButtonText: { color: colors.green },
  dangerButton: { backgroundColor: colors.danger, borderColor: colors.danger },
  dangerText: { color: colors.danger },
  dimmed: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
  itemHeading: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  checkTarget: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#9DAF9F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkedBox: { backgroundColor: colors.green, borderColor: colors.green },
  itemTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 23,
  },
  bought: { color: colors.muted, textDecorationLine: 'line-through' },
  editForm: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 14,
    gap: 10,
  },
  noteInput: {
    minHeight: 210,
    color: colors.ink,
    fontSize: 17,
    lineHeight: 27,
    padding: 0,
  },
  conflictBody: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 24,
    padding: 14,
    backgroundColor: colors.paleGreen,
    borderRadius: 12,
  },
  footer: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 19,
    textAlign: 'center',
  },
});
