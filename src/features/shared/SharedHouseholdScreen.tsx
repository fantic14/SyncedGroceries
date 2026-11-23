import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from 'react';
import {
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

import { GroceryComposer } from '../../components/GroceryComposer';
import Ionicons from '../../components/Ionicons';
import {
  ListScopeSwitch,
  ListTabs,
  type ListTab,
} from '../../components/ListNavigation';
import { colors } from '../../theme';
import { describeOwnChanges } from '../offline/recovery';
import type { SharedItem } from './types';
import type { SharedController } from './useSharedHousehold';

type Props = {
  householdName: string;
  members: Array<{ user_id: string; display_name: string }>;
  controller: SharedController;
  checkingMembership: boolean;
  offline: boolean;
  onAccount: () => void;
  onClose: () => void;
};

export function SharedHouseholdScreen({
  householdName,
  members,
  controller,
  checkingMembership,
  offline,
  onAccount,
  onClose,
}: Props) {
  const [tab, setTab] = useState<ListTab>('groceries');
  const [leaveFor, setLeaveFor] = useState<'phone' | 'account' | null>(null);
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

  function close(destination: 'phone' | 'account' = 'phone') {
    if (controller.busy) return;
    if (draftSaveFailed || savingDraft) {
      setLeaveFor(destination);
      scroll.current?.scrollTo({ y: 0, animated: true });
    } else (destination === 'account' ? onAccount : onClose)();
  }

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => listener.remove();
  }, [controller.busy, draftSaveFailed, savingDraft, onClose]);

  const attribution = useCallback(
    (userId: string | null, timestamp: string) => {
      const name =
        userId === null
          ? 'Former housemate'
          : (members.find((member) => member.user_id === userId)
              ?.display_name ?? 'Housemate');
      return `${name} · ${new Date(timestamp).toLocaleString()}`;
    },
    [members],
  );

  const { sorted, needed } = useMemo(() => {
    const remaining: SharedItem[] = [];
    const bought: SharedItem[] = [];
    for (const item of snapshot?.items ?? []) {
      if (!item.deleted_at) (item.completed ? bought : remaining).push(item);
    }
    return { sorted: [...remaining, ...bought], needed: remaining.length };
  }, [snapshot?.items]);
  const opening =
    snapshot === null &&
    !controller.error &&
    !controller.storageError &&
    (controller.loading ||
      checkingMembership ||
      (!offline && controller.syncStatus !== 'reauth'));
  const syncLabel =
    opening || checkingMembership
      ? 'Connecting…'
      : offline
        ? snapshot
          ? 'Offline · saved on this phone'
          : 'Offline'
        : {
            offline: 'Offline · saved on this phone',
            pending: controller.queuedCount
              ? `${controller.queuedCount} waiting to sync`
              : 'Connecting…',
            syncing: 'Syncing…',
            synced:
              controller.connection === 'live' ? 'Synced · live' : 'Synced',
            failed: 'Some edits need review',
            reauth: 'Sync paused · check account',
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
            <ListScopeSwitch
              scope="household"
              onSwitch={() => close('phone')}
              disabled={controller.busy}
            />
            <View style={styles.header}>
              <View style={styles.flex}>
                <Text accessibilityRole="header" style={styles.title}>
                  {householdName}
                </Text>
                <Text accessibilityLiveRegion="polite" style={styles.caption}>
                  {syncLabel}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Household settings"
                disabled={controller.busy}
                onPress={() => close('account')}
                style={styles.iconButton}
              >
                <Ionicons
                  name="settings-outline"
                  size={23}
                  color={colors.green}
                />
              </Pressable>
            </View>
            {leaveFor && (
              <Card tone="note">
                <Text accessibilityRole="header" style={styles.sectionTitle}>
                  Leave this shared list?
                </Text>
                <Text style={styles.body}>
                  Your latest note text has not been saved on this phone. Retry
                  saving it before leaving, or discard that local text.
                </Text>
                <Button title="Stay here" onPress={() => setLeaveFor(null)} />
                <Button
                  title="Leave for now"
                  secondary
                  disabled={controller.busy}
                  onPress={leaveFor === 'account' ? onAccount : onClose}
                />
              </Card>
            )}

            {snapshot === null ? (
              <Card>
                <Text style={styles.sectionTitle}>
                  {opening ? 'Opening the list…' : 'Couldn’t open the list'}
                </Text>
                {!opening && (
                  <Button
                    title="Try again"
                    disabled={controller.busy}
                    onPress={() => void controller.refresh()}
                  />
                )}
              </Card>
            ) : (
              <>
                <ListTabs tab={tab} onSelect={setTab} />

                {tab === 'groceries' ? (
                  <>
                    <GroceryComposer
                      shared
                      disabled={blocked}
                      onAdd={controller.addItem}
                    />
                    {sorted.length > 0 && (
                      <Text
                        accessibilityRole="header"
                        style={styles.sectionTitle}
                      >
                        {needed} to get
                      </Text>
                    )}
                    {sorted.length === 0 ? (
                      <Card>
                        <Text style={styles.body}>No groceries yet</Text>
                      </Card>
                    ) : (
                      <View style={styles.listCard}>
                        {sorted.map((item, index) => (
                          <ItemCard
                            key={item.id}
                            item={item}
                            last={index === sorted.length - 1}
                            disabled={blocked}
                            onUpdate={controller.updateItem}
                            attribution={attribution}
                          />
                        ))}
                      </View>
                    )}
                  </>
                ) : (
                  <>
                    <Card tone="note">
                      <Text
                        accessibilityRole="header"
                        style={styles.sectionTitle}
                      >
                        Household note
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
                        placeholder="Write a household note…"
                        placeholderTextColor={colors.muted}
                      />
                      <View style={styles.sectionHeading}>
                        <Text style={styles.caption}>
                          {savingDraft
                            ? 'Saving draft on this phone…'
                            : draftSaveFailed
                              ? 'Latest text is not saved'
                              : dirtyNote
                                ? 'Unshared draft'
                                : 'Saved'}
                        </Text>
                        <Text style={styles.caption}>
                          {noteInput.length} / 2000
                        </Text>
                      </View>
                      <Text style={styles.caption}>
                        Last edit:{' '}
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

            {controller.error && (
              <View accessibilityRole="alert" style={styles.errorCard}>
                <Text style={styles.errorText}>{controller.error}</Text>
              </View>
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
            {!offline &&
              !checkingMembership &&
              controller.syncStatus === 'reauth' && (
                <Button
                  title="Check account"
                  onPress={() => close('account')}
                />
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

            <Button
              title={controller.pending ? 'Retry sync' : 'Refresh list'}
              secondary
              disabled={controller.busy || controller.loading}
              onPress={() =>
                void (controller.pending
                  ? controller.retry()
                  : controller.refresh())
              }
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const ItemCard = memo(function ItemCard({
  item,
  last,
  disabled,
  onUpdate,
  attribution,
}: {
  item: SharedItem;
  last: boolean;
  disabled: boolean;
  onUpdate: SharedController['updateItem'];
  attribution: (userId: string | null, timestamp: string) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
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
    if (disabled || saving || !title.trim()) return;
    const changes: { title?: string; quantity?: string } = {};
    if (title.trim() !== editBase.title) changes.title = title.trim();
    if ((quantity.trim() || '1') !== editBase.quantity)
      changes.quantity = quantity.trim() || '1';
    setSaving(true);
    try {
      if (
        Object.keys(changes).length === 0 ||
        (await onUpdate(editBase, changes))
      )
        setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.groceryRow, !last && styles.rowBorder]}>
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
            {item.quantity !== '1' && (
              <Text style={styles.body}>{item.quantity}</Text>
            )}
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

      {editing && (
        <View style={styles.editForm}>
          <Text style={styles.caption}>
            Updated by {attribution(item.updated_by, item.updated_at)}
          </Text>
          <Text style={styles.fieldLabel}>Item name</Text>
          <TextInput
            accessibilityLabel={`New name for ${item.title}`}
            editable={!saving}
            maxLength={120}
            value={title}
            onChangeText={setTitle}
            style={styles.input}
          />
          <Text style={styles.fieldLabel}>Quantity</Text>
          <TextInput
            accessibilityLabel={`New quantity for ${item.title}`}
            editable={!saving}
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
    </View>
  );
});

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
  title: {
    color: colors.ink,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '800',
    letterSpacing: -0.7,
  },
  iconButton: {
    width: 44,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  sectionHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
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
  listCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  groceryRow: { paddingVertical: 5 },
  rowBorder: { borderBottomWidth: 1, borderColor: colors.border },
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
});
