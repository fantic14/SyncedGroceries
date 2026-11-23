import { Pressable, StyleSheet, Text, View } from 'react-native';

import Ionicons from './Ionicons';
import { colors } from '../theme';

export type ListScope = 'phone' | 'household';
export type ListTab = 'groceries' | 'note';

export function ListScopeSwitch({
  scope,
  onSwitch,
  disabled = false,
}: {
  scope: ListScope;
  onSwitch: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.switcher}>
      {(['phone', 'household'] as const).map((value) => {
        const selected = value === scope;
        return (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled }}
            disabled={disabled || selected}
            onPress={onSwitch}
            style={[styles.scope, selected && styles.activeScope]}
          >
            <Ionicons
              name={
                value === 'phone' ? 'phone-portrait-outline' : 'people-outline'
              }
              size={17}
              color={selected ? colors.surface : colors.green}
            />
            <Text style={[styles.label, selected && styles.activeLabel]}>
              {value === 'phone' ? 'On this phone' : 'Household'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ListTabs({
  tab,
  onSelect,
}: {
  tab: ListTab;
  onSelect: (tab: ListTab) => void;
}) {
  return (
    <View style={styles.tabs}>
      {(['groceries', 'note'] as const).map((value) => (
        <Pressable
          key={value}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === value }}
          onPress={() => onSelect(value)}
          style={[styles.tab, value === tab && styles.activeTab]}
        >
          <Text style={[styles.tabText, value === tab && styles.activeTabText]}>
            {value === 'groceries' ? 'Groceries' : 'Note'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  switcher: {
    flexDirection: 'row',
    backgroundColor: colors.paleGreen,
    padding: 4,
    borderRadius: 14,
    gap: 4,
  },
  scope: {
    flex: 1,
    minHeight: 44,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  activeScope: { backgroundColor: colors.green },
  label: {
    fontWeight: '700',
    color: colors.green,
    fontSize: 14,
    flexShrink: 1,
  },
  activeLabel: { color: colors.surface },
  tabs: {
    flexDirection: 'row',
    gap: 20,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  tab: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: { borderBottomColor: colors.green },
  tabText: { color: colors.muted, fontSize: 15, fontWeight: '600' },
  activeTabText: { color: colors.green, fontWeight: '700' },
});
