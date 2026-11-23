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
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Ionicons from '../../components/Ionicons';
import { ListScopeSwitch } from '../../components/ListNavigation';
import { backendId } from '../../lib/supabase';
import { colors } from '../../theme';
import { getOfflinePersistence } from '../offline/platformPersistence';
import { formatRecoveredWork, recoverOwnEdits } from '../offline/recovery';
import { SharedHouseholdScreen } from '../shared/SharedHouseholdScreen';
import { useSharedHousehold } from '../shared/useSharedHousehold';
import { hasWidgetEdits } from '../widget/bridge';
import { useIdentity } from './useIdentity';

type Identity = ReturnType<typeof useIdentity>;

export function IdentityScreen({ onClose }: { onClose: () => void }) {
  const identity = useIdentity();
  return identity.session && identity.household && identity.householdLoaded ? (
    <HouseholdWorkspace
      key={`${identity.session.user.id}:${identity.household.id}:${identity.members.find((member) => member.user_id === identity.session!.user.id)?.joined_at ?? ''}`}
      identity={identity}
      onClose={onClose}
    />
  ) : (
    <IdentityContent identity={identity} onClose={onClose} />
  );
}

function HouseholdWorkspace({
  identity,
  onClose,
}: {
  identity: Identity;
  onClose: () => void;
}) {
  const household = identity.household!;
  const controller = useSharedHousehold(
    household.id,
    identity.session!.user.id,
    identity.membershipVerified &&
      !identity.authRecoveryRequired &&
      !identity.identityOffline,
    identity.session!.access_token,
  );
  const [open, setOpen] = useState(true);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  function guardAction(action: () => void) {
    if (controller.busy) return;
    if (
      hasWidgetEdits(identity.session!.user.id) ||
      controller.pending ||
      (controller.snapshot &&
        controller.noteDraft !== controller.snapshot.note.body)
    ) {
      setLeaveAction(() => action);
      setConfirmLeave(true);
    } else action();
  }
  return (
    <>
      {open ? (
        <SharedHouseholdScreen
          householdName={household.name}
          members={identity.members}
          controller={controller}
          offline={identity.identityOffline && !identity.authRecoveryRequired}
          checkingMembership={
            !identity.membershipVerified &&
            identity.loading &&
            !identity.authRecoveryRequired &&
            !identity.identityOffline
          }
          onAccount={() => setOpen(false)}
          onClose={onClose}
        />
      ) : (
        <IdentityContent
          identity={identity}
          onClose={() => {
            if (!controller.busy) onClose();
          }}
          guardAccountAction={guardAction}
          onOpenShared={() => setOpen(true)}
        />
      )}
      <Modal
        transparent
        visible={confirmLeave}
        animationType="fade"
        onRequestClose={() => setConfirmLeave(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            padding: 24,
            backgroundColor: '#00000066',
          }}
        >
          <Card>
            <Text style={styles.sectionTitle}>
              Remove this account’s saved work?
            </Text>
            <Text style={styles.body}>
              Signing out or deleting your account removes unsynced edits and
              drafts from this phone, including widget edits. Sync any edits you
              want to keep first.
            </Text>
            <Button
              title="Keep editing"
              onPress={() => {
                setConfirmLeave(false);
                setOpen(true);
              }}
            />
            <Button
              title="Continue and discard local work"
              danger
              onPress={() => {
                setConfirmLeave(false);
                leaveAction?.();
              }}
            />
          </Card>
        </View>
      </Modal>
    </>
  );
}

function IdentityContent({
  identity,
  onClose,
  onOpenShared,
  guardAccountAction,
}: {
  identity: Identity;
  onClose: () => void;
  onOpenShared?: () => void;
  guardAccountAction?: (action: () => void) => void;
}) {
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  useEffect(() => {
    if (identity.error) scroll.current?.scrollTo({ y: 0, animated: true });
  }, [identity.error]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!identity.busy) (onOpenShared ?? onClose)();
      return true;
    });
    return () => listener.remove();
  }, [identity.busy, onClose, onOpenShared]);

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          ref={scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.content}>
            <ListScopeSwitch
              scope="household"
              onSwitch={onClose}
              disabled={identity.busy}
            />
            <View style={styles.header}>
              <Text
                accessibilityRole="header"
                style={[styles.brandName, styles.flex]}
              >
                {onOpenShared ? 'Household settings' : 'Household list'}
              </Text>
              {onOpenShared && (
                <Pressable
                  accessibilityLabel="Back to household list"
                  accessibilityRole="button"
                  disabled={identity.busy}
                  onPress={onOpenShared}
                  style={styles.iconButton}
                >
                  <Ionicons name="close-outline" size={25} color={colors.ink} />
                </Pressable>
              )}
            </View>

            {!identity.configured ? (
              <Card>
                <Text accessibilityRole="header" style={styles.title}>
                  Sharing is unavailable
                </Text>
                <Text style={styles.body}>
                  This app needs a backend connection to open household lists.
                </Text>
                <Button title="Open personal list" onPress={onClose} />
              </Card>
            ) : (
              <>
                {identity.pendingCleanup && (
                  <Card>
                    <Text style={styles.sectionTitle}>
                      Local account cleanup needs a retry
                    </Text>
                    <Text style={styles.body}>
                      Some saved account data could not be removed from this
                      phone.
                    </Text>
                    <Button
                      title="Retry local cleanup"
                      onPress={() => void identity.retryCleanup()}
                    />
                  </Card>
                )}
                {identity.identityOffline && identity.household && (
                  <Card>
                    <Text style={styles.sectionTitle}>
                      Using your saved household
                    </Text>
                    <Text style={styles.body}>
                      The household details shown here were saved on this phone.
                      Connect to confirm membership changes and send queued
                      edits.
                    </Text>
                  </Card>
                )}
                {identity.authRecoveryRequired && (
                  <>
                    <Card>
                      <Text style={styles.sectionTitle}>
                        Sign in again to resume syncing
                      </Text>
                      <Text style={styles.body}>
                        Sign in with the same email to resume your saved edits.
                        Signing into a different account removes this account’s
                        saved drafts and edits from this phone.
                      </Text>
                    </Card>
                    {identity.session && (
                      <EmailSignIn
                        key={`reauth-${identity.session.user.id}`}
                        identity={identity}
                      />
                    )}
                  </>
                )}
                {identity.recoveryHouseholdId && identity.session && (
                  <RecoveryPanel
                    key={`${identity.session.user.id}:${identity.recoveryHouseholdId}`}
                    userId={identity.session.user.id}
                    householdId={identity.recoveryHouseholdId}
                  />
                )}
                {identity.error && (
                  <View accessibilityRole="alert" style={styles.errorCard}>
                    <Ionicons
                      name="alert-circle-outline"
                      size={19}
                      color={colors.danger}
                    />
                    <Text style={styles.errorText}>{identity.error}</Text>
                  </View>
                )}

                {identity.loading &&
                (!identity.session ||
                  (!identity.household &&
                    (!identity.householdLoaded ||
                      (!identity.membershipVerified &&
                        !identity.identityOffline)))) ? (
                  <View accessibilityLiveRegion="polite" style={styles.loading}>
                    <ActivityIndicator color={colors.green} />
                    <Text style={styles.body}>Opening your household…</Text>
                  </View>
                ) : !identity.session ? (
                  <EmailSignIn identity={identity} />
                ) : !identity.householdLoaded ? (
                  <Card>
                    <Text
                      accessibilityRole="header"
                      style={styles.sectionTitle}
                    >
                      Couldn’t open your household
                    </Text>
                    <Text style={styles.body}>
                      Check your connection and try loading it again.
                    </Text>
                    <Button
                      title="Try again"
                      disabled={identity.busy}
                      onPress={() => void identity.refresh()}
                    />
                  </Card>
                ) : identity.household ? (
                  <HouseholdDashboard
                    key={`${identity.session.user.id}:${identity.household.id}`}
                    identity={identity}
                    onConfirmationLayout={(y) =>
                      scroll.current?.scrollTo({
                        y: Math.max(0, y - 20),
                        animated: true,
                      })
                    }
                  />
                ) : (
                  <HouseholdSetup
                    key={identity.session.user.id}
                    identity={identity}
                  />
                )}

                {identity.session &&
                  (!identity.loading || identity.householdLoaded) && (
                    <AccountActions
                      key={identity.session.user.id}
                      identity={identity}
                      guardAction={guardAccountAction}
                    />
                  )}
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function RecoveryPanel({
  userId,
  householdId,
}: {
  userId: string;
  householdId: string;
}) {
  const [work, setWork] = useState<ReturnType<typeof recoverOwnEdits>>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let close: (() => void) | undefined;
    void getOfflinePersistence()
      .then(async (persistence) => {
        if (cancelled) return;
        const lease = persistence.open<unknown>({
          backend: backendId,
          userId,
          householdId,
        });
        close = () => lease.close();
        try {
          const value = recoverOwnEdits(
            await lease.load(),
            userId,
            householdId,
          );
          if (!cancelled) {
            setWork(value);
            setError(null);
          }
        } finally {
          lease.close();
        }
      })
      .catch(() => {
        if (!cancelled)
          setError(
            'Couldn’t read your saved edits. They have not been changed.',
          );
      });
    return () => {
      cancelled = true;
      close?.();
    };
  }, [userId, householdId, attempt]);
  if (!error && (!work || (!work.edits.length && work.noteDraft === null)))
    return null;
  return (
    <Card>
      <Text style={styles.sectionTitle}>Recover your earlier edits</Text>
      <Text style={styles.body}>
        You no longer have this household open. Your own unsent changes are
        still saved for this account; they will not be sent to a different
        household.
      </Text>
      {error ? (
        <>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {error}
          </Text>
          <Button
            title="Retry reading saved edits"
            onPress={() => setAttempt((value) => value + 1)}
          />
        </>
      ) : (
        <>
          <Text selectable style={styles.caption}>
            {work && formatRecoveredWork(work)}
          </Text>
          <Button
            title="Export my saved edits"
            onPress={() => {
              void Share.share({
                message: work ? formatRecoveredWork(work) : '',
              }).catch(() =>
                setError(
                  'Couldn’t open sharing. Select the saved text to copy it.',
                ),
              );
            }}
          />
        </>
      )}
    </Card>
  );
}

function AccountActions({
  identity,
  guardAction = (action) => action(),
}: {
  identity: Identity;
  guardAction?: (action: () => void) => void;
}) {
  const [confirmDeletion, setConfirmDeletion] = useState(false);

  return (
    <View style={styles.accountCard}>
      <Text style={styles.caption}>
        Signed in as {identity.session?.user.email ?? 'your account'}
      </Text>
      <Button
        title="Sign out"
        secondary
        disabled={identity.busy}
        onPress={() =>
          guardAction(() => {
            void identity.signOut();
          })
        }
      />
      {confirmDeletion ? (
        <View style={styles.confirmCard}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Permanently delete your account?
          </Text>
          <Text style={styles.body}>
            This removes your account and household membership. You can’t undo
            this. If other people live in a household you own, first transfer
            ownership to another member.
          </Text>
          <Button
            title={
              identity.busy ? 'Please wait…' : 'Permanently delete my account'
            }
            danger
            disabled={identity.busy}
            onPress={() =>
              guardAction(() => {
                void identity.deleteAccount();
              })
            }
          />
          <Button
            title="Keep my account"
            secondary
            disabled={identity.busy}
            onPress={() => setConfirmDeletion(false)}
          />
        </View>
      ) : (
        <Button
          title="Delete my account"
          secondary
          danger
          disabled={identity.busy}
          onPress={() => setConfirmDeletion(true)}
        />
      )}
    </View>
  );
}

function EmailSignIn({ identity }: { identity: Identity }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  useEffect(() => {
    if (!sentTo) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sentTo]);

  async function send() {
    if (identity.busy) return;
    const recipient = (sentTo ?? email).trim().toLowerCase();
    if (await identity.sendCode(recipient)) {
      setSentTo(recipient);
      setCode('');
      setNow(Date.now());
      setResendAt(Date.now() + 60_000);
    }
  }

  return (
    <Card>
      <Text accessibilityRole="header" style={styles.title}>
        {sentTo ? 'Check your email' : 'Sign in to share a list'}
      </Text>
      <Text style={styles.body}>
        {sentTo
          ? `Enter the sign-in code sent to ${sentTo}. Check your spam folder if it hasn’t arrived.`
          : 'We’ll email you a sign-in code.'}
      </Text>

      {sentTo ? (
        <>
          <Field label="Email code">
            <TextInput
              accessibilityLabel="Email sign-in code"
              autoComplete="one-time-code"
              editable={!identity.busy}
              keyboardType="number-pad"
              maxLength={10}
              onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
              onSubmitEditing={() => {
                if (!identity.busy && /^\d{6,10}$/.test(code))
                  void identity.verifyCode(sentTo, code);
              }}
              placeholder="Enter your code"
              placeholderTextColor={colors.muted}
              returnKeyType="done"
              style={styles.input}
              textContentType="oneTimeCode"
              value={code}
            />
          </Field>
          <Button
            title={identity.busy ? 'Checking…' : 'Sign in'}
            disabled={identity.busy || !/^\d{6,10}$/.test(code)}
            onPress={() => void identity.verifyCode(sentTo, code)}
          />
          <Button
            title={
              remaining > 0 ? `Resend code in ${remaining}s` : 'Resend code'
            }
            secondary
            disabled={identity.busy || remaining > 0}
            onPress={() => void send()}
          />
          <Button
            title="Use a different email"
            secondary
            disabled={identity.busy}
            onPress={() => {
              setSentTo(null);
              setCode('');
            }}
          />
        </>
      ) : (
        <>
          <Field label="Your email">
            <TextInput
              accessibilityLabel="Your email address"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              editable={!identity.busy}
              keyboardType="email-address"
              maxLength={254}
              onChangeText={setEmail}
              onSubmitEditing={() => {
                if (validEmail) void send();
              }}
              placeholder="you@university.edu"
              placeholderTextColor={colors.muted}
              returnKeyType="send"
              style={styles.input}
              value={email}
            />
          </Field>
          <Button
            title={identity.busy ? 'Sending…' : 'Send code'}
            disabled={identity.busy || !validEmail}
            onPress={() => void send()}
          />
        </>
      )}
    </Card>
  );
}

function HouseholdSetup({ identity }: { identity: Identity }) {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [token, setToken] = useState('');
  const canSubmit =
    displayName.trim().length > 0 &&
    (mode === 'create'
      ? name.trim().length > 0
      : /^[a-f0-9]{64}$/i.test(token.trim()));

  return (
    <Card>
      <View style={styles.tabs}>
        {(['create', 'join'] as const).map((value) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{
              selected: mode === value,
              disabled: identity.busy,
            }}
            disabled={identity.busy}
            key={value}
            onPress={() => setMode(value)}
            style={[styles.tab, mode === value && styles.selectedTab]}
          >
            <Text
              style={[styles.tabText, mode === value && styles.selectedTabText]}
            >
              {value === 'create' ? 'Create a household' : 'Join a household'}
            </Text>
          </Pressable>
        ))}
      </View>
      <Field label="Your name">
        <TextInput
          accessibilityLabel="Your display name"
          editable={!identity.busy}
          maxLength={60}
          onChangeText={setDisplayName}
          placeholder="Your name"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={displayName}
        />
      </Field>
      {mode === 'create' ? (
        <Field label="Household name">
          <TextInput
            accessibilityLabel="Household name"
            editable={!identity.busy}
            maxLength={80}
            onChangeText={setName}
            placeholder="e.g. The Maple Street flat"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={name}
          />
        </Field>
      ) : (
        <Field label="Invitation code">
          <TextInput
            accessibilityLabel="Household invitation code"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!identity.busy}
            maxLength={128}
            multiline
            onChangeText={setToken}
            placeholder="Paste the code from your flatmate"
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.tokenInput]}
            value={token}
          />
        </Field>
      )}
      <Button
        title={
          identity.busy
            ? 'Please wait…'
            : mode === 'create'
              ? 'Create household'
              : 'Join household'
        }
        disabled={identity.busy || !canSubmit}
        onPress={() =>
          void (mode === 'create'
            ? identity.createHousehold(name.trim(), displayName.trim())
            : identity.joinHousehold(token.trim(), displayName.trim()))
        }
      />
    </Card>
  );
}

type Confirmation =
  | { kind: 'remove' | 'transfer'; id: string; name: string }
  | { kind: 'revoke'; id: string }
  | { kind: 'leave' };

function HouseholdDashboard({
  identity,
  onConfirmationLayout,
}: {
  identity: Identity;
  onConfirmationLayout: (y: number) => void;
}) {
  const { household, session } = identity;
  const invitation = identity.generatedInvite;
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [shareError, setShareError] = useState(false);
  const [now, setNow] = useState(Date.now());
  const isOwner = household?.owner_id === session?.user.id;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setConfirmation(null);
  }, [isOwner]);

  if (!household || !session) return null;

  async function confirm() {
    if (!confirmation) return;
    const result =
      confirmation.kind === 'remove'
        ? await identity.removeMember(confirmation.id)
        : confirmation.kind === 'transfer'
          ? await identity.transferOwnership(confirmation.id)
          : confirmation.kind === 'revoke'
            ? await identity.revokeInvite(confirmation.id)
            : await identity.leaveHousehold();
    if (result) {
      if (confirmation.kind === 'revoke' && invitation?.id === confirmation.id)
        identity.dismissGeneratedInvite();
      setConfirmation(null);
    }
  }

  async function shareInvite() {
    if (!invitation) return;
    setShareError(false);
    try {
      await Share.share({
        message: `Join our household in Synced Groceries. Enter this invitation code after signing in:\n\n${invitation.token}\n\nIt expires ${new Date(invitation.expires_at).toLocaleString()}. Keep it private.`,
      });
    } catch {
      setShareError(true);
    }
  }

  const pendingInvites = identity.invites.filter(
    (invite) =>
      !invite.revoked_at &&
      !invite.redeemed_at &&
      new Date(invite.expires_at).getTime() > now,
  );
  const activeInvitation =
    invitation && pendingInvites.some((invite) => invite.id === invitation.id)
      ? invitation
      : null;

  return (
    <>
      <Card>
        <Text accessibilityRole="header" style={styles.title}>
          {household.name}
        </Text>
        <Button
          title="Refresh household"
          secondary
          disabled={identity.busy}
          onPress={() => void identity.refresh()}
        />
      </Card>

      <Card>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Members
        </Text>
        {identity.members.map((member) => (
          <View style={styles.member} key={member.user_id}>
            <View style={styles.memberHeading}>
              <View style={styles.avatar}>
                <Ionicons
                  name="person-outline"
                  size={20}
                  color={colors.green}
                />
              </View>
              <View style={styles.flex}>
                <Text style={styles.memberName}>
                  {member.display_name}
                  {member.user_id === session.user.id ? ' (you)' : ''}
                </Text>
                <Text style={styles.caption}>
                  {member.role === 'owner' ? 'Household owner' : 'Housemate'}
                </Text>
              </View>
            </View>
            {isOwner && member.user_id !== session.user.id && (
              <View style={styles.rowButtons}>
                <Button
                  title={`Make ${member.display_name} owner`}
                  secondary
                  disabled={identity.busy}
                  onPress={() =>
                    setConfirmation({
                      kind: 'transfer',
                      id: member.user_id,
                      name: member.display_name,
                    })
                  }
                />
                <Button
                  title={`Remove ${member.display_name}`}
                  secondary
                  danger
                  disabled={identity.busy}
                  onPress={() =>
                    setConfirmation({
                      kind: 'remove',
                      id: member.user_id,
                      name: member.display_name,
                    })
                  }
                />
              </View>
            )}
          </View>
        ))}
      </Card>

      {isOwner && (
        <Card>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Invitations
          </Text>
          <Text style={styles.body}>Each code can be used by one person.</Text>
          <Button
            title={identity.busy ? 'Please wait…' : 'Create an invitation'}
            disabled={identity.busy}
            onPress={() => {
              setShareError(false);
              void identity.createInvite();
            }}
          />
          {activeInvitation && (
            <View style={styles.invitationCard}>
              <Text style={styles.fieldLabel}>YOUR NEW INVITATION CODE</Text>
              <Text selectable style={styles.invitationToken}>
                {activeInvitation.token}
              </Text>
              <Text style={styles.caption}>
                Invitation {activeInvitation.id.slice(0, 8)} · Expires{' '}
                {new Date(activeInvitation.expires_at).toLocaleString()}. This
                code is shown only now; keep it private.
              </Text>
              <Button
                title="Share invitation"
                secondary
                onPress={() => void shareInvite()}
              />
              {shareError && (
                <Text accessibilityRole="alert" style={styles.errorText}>
                  Couldn’t open sharing. Select the code above to copy it.
                </Text>
              )}
            </View>
          )}
          {pendingInvites.length > 0 && (
            <Text style={styles.fieldLabel}>UNUSED INVITATIONS</Text>
          )}
          {pendingInvites.map((invite) => (
            <View key={invite.id} style={styles.inviteRow}>
              <Text style={[styles.caption, styles.flex]}>
                Invitation {invite.id.slice(0, 8)} · Expires{' '}
                {new Date(invite.expires_at).toLocaleString()}
              </Text>
              <Button
                title="Revoke"
                secondary
                disabled={identity.busy}
                onPress={() =>
                  setConfirmation({ kind: 'revoke', id: invite.id })
                }
              />
            </View>
          ))}
        </Card>
      )}

      {confirmation && (
        <View
          accessibilityLiveRegion="polite"
          style={styles.confirmCard}
          onLayout={(event) => onConfirmationLayout(event.nativeEvent.layout.y)}
        >
          <Text style={styles.sectionTitle}>Confirm this change</Text>
          <Text style={styles.body}>
            {confirmation.kind === 'remove'
              ? `Remove ${confirmation.name} from this household? They will lose household access.`
              : confirmation.kind === 'transfer'
                ? `Make ${confirmation.name} the owner? You will become a member and will no longer manage invitations or remove members.`
                : confirmation.kind === 'revoke'
                  ? 'Revoke this invitation? The code will stop working immediately.'
                  : 'Leave this household? You will need a new invitation to rejoin. Save any shared note draft first; unsaved work on this phone will be discarded.'}
          </Text>
          <Button
            title={identity.busy ? 'Please wait…' : 'Confirm change'}
            danger
            disabled={identity.busy}
            onPress={() => void confirm()}
          />
          <Button
            title="Cancel"
            secondary
            disabled={identity.busy}
            onPress={() => setConfirmation(null)}
          />
        </View>
      )}

      {isOwner ? (
        <Text style={styles.caption}>
          To leave this household, first make another member the owner.
        </Text>
      ) : (
        <Button
          title="Leave this household"
          secondary
          danger
          disabled={identity.busy}
          onPress={() => setConfirmation({ kind: 'leave' })}
        />
      )}
    </>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
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
        (pressed || disabled) && styles.dimmed,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          secondary && styles.secondaryButtonText,
          secondary && danger && styles.errorText,
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
    paddingBottom: 32,
    gap: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  brandName: {
    color: colors.ink,
    fontSize: 19,
    fontWeight: '800',
    flexShrink: 1,
  },
  iconButton: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 20,
    gap: 17,
  },
  title: {
    color: colors.ink,
    fontSize: 29,
    fontWeight: '800',
    letterSpacing: -0.9,
  },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '700' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  caption: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  field: { gap: 7 },
  fieldLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  input: {
    color: colors.ink,
    backgroundColor: colors.background,
    minHeight: 50,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 13,
    fontSize: 16,
  },
  tokenInput: { minHeight: 92, textAlignVertical: 'top' },
  button: {
    backgroundColor: colors.green,
    minHeight: 48,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  secondaryButton: { backgroundColor: colors.paleGreen },
  dangerButton: { backgroundColor: colors.danger },
  buttonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  secondaryButtonText: { color: colors.green },
  dimmed: { opacity: 0.55 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20 },
  errorCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#FCEAE6',
    borderRadius: 14,
    padding: 15,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 21,
    flexShrink: 1,
  },
  accountCard: { gap: 12, paddingHorizontal: 5 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.paleGreen,
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    padding: 9,
  },
  selectedTab: { backgroundColor: colors.green },
  tabText: {
    color: colors.green,
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
  },
  selectedTabText: { color: colors.surface },
  member: {
    gap: 12,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: 16,
  },
  memberHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.paleGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberName: {
    fontSize: 16,
    color: colors.ink,
    fontWeight: '600',
    lineHeight: 23,
  },
  rowButtons: { gap: 8 },
  invitationCard: {
    backgroundColor: colors.note,
    borderColor: colors.noteBorder,
    borderWidth: 1,
    borderRadius: 14,
    padding: 15,
    gap: 12,
  },
  invitationToken: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 14,
    lineHeight: 23,
    color: colors.ink,
  },
  inviteRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  confirmCard: {
    padding: 20,
    gap: 15,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.noteBorder,
    backgroundColor: colors.note,
  },
});
