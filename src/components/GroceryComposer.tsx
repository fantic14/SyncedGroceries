import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ITEM_TITLE_LIMIT, QUANTITY_LIMIT } from '../features/household/state';
import { colors } from '../theme';
import Ionicons from './Ionicons';

type Props = {
  shared?: boolean;
  disabled?: boolean;
  onAdd: (title: string, quantity: string) => void | Promise<boolean>;
};

export function GroceryComposer({ shared, disabled, onAdd }: Props) {
  const [draft, setDraft] = useState({ title: '', quantity: '' });
  const submitting = useRef(false);
  const canAdd = !disabled && draft.title.trim().length > 0;

  async function submit() {
    if (!canAdd || submitting.current) return;
    submitting.current = true;
    try {
      const saved = await onAdd(
        draft.title.trim(),
        draft.quantity.trim() || '1',
      );
      if (saved !== false) {
        // Typing may have continued while a household edit was saved to disk.
        setDraft((current) =>
          current === draft ? { title: '', quantity: '' } : current,
        );
      }
    } finally {
      submitting.current = false;
    }
  }

  return (
    <View style={styles.row}>
      <TextInput
        accessibilityLabel={
          shared ? 'Shared grocery item name' : 'Grocery item name'
        }
        maxLength={ITEM_TITLE_LIMIT}
        value={draft.title}
        onChangeText={(title) => setDraft((current) => ({ ...current, title }))}
        onSubmitEditing={submit}
        submitBehavior="submit"
        placeholder="Add an item"
        placeholderTextColor={colors.muted}
        returnKeyType="done"
        style={[styles.input, styles.title]}
      />
      <TextInput
        accessibilityLabel={
          shared ? 'Shared grocery quantity' : 'Grocery quantity'
        }
        maxLength={QUANTITY_LIMIT}
        value={draft.quantity}
        onChangeText={(quantity) =>
          setDraft((current) => ({ ...current, quantity }))
        }
        onSubmitEditing={submit}
        submitBehavior="submit"
        placeholder="Qty"
        placeholderTextColor={colors.muted}
        returnKeyType="done"
        style={[styles.input, styles.quantity]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add item"
        accessibilityState={{ disabled: !canAdd }}
        disabled={!canAdd}
        onPress={submit}
        style={({ pressed }) => [
          styles.add,
          (!canAdd || pressed) && styles.dimmed,
        ]}
      >
        <Ionicons name="add" size={24} color={colors.surface} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  input: {
    minWidth: 0,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    color: colors.ink,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  title: { flex: 1 },
  quantity: { width: '21%', maxWidth: 100 },
  add: {
    width: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.green,
    borderRadius: 12,
  },
  dimmed: { opacity: 0.55 },
});
