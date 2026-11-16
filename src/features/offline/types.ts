import type {
  ItemChanges,
  ItemMutationRequest,
  NoteMutationRequest,
  SharedItem,
  SharedNote,
  SharedSnapshot,
} from '../shared/types.ts';

type OperationMeta = {
  id: string;
  queuedAt: string;
  attempts: number;
  status: 'queued' | 'conflict' | 'failed';
  message: string | null;
};

export type OfflineItemOperation = OperationMeta & {
  kind: 'item';
  itemId: string;
  base: SharedItem | null;
  baseWasQueued: boolean;
  rebases: number;
  changes: ItemChanges;
  request: ItemMutationRequest | null;
  conflict: SharedItem | null;
};

export type OfflineNoteOperation = OperationMeta & {
  kind: 'note';
  base: SharedNote;
  body: string;
  request: NoteMutationRequest | null;
  conflict: SharedNote | null;
};

export type OfflineOperation = OfflineItemOperation | OfflineNoteOperation;

export type OfflineDocument = {
  version: 1;
  userId: string;
  householdId: string;
  server: SharedSnapshot | null;
  queue: OfflineOperation[];
  draft: { body: string; base: SharedNote } | null;
  access: 'active' | 'reauth' | 'revoked';
  nextRetryAt: number;
  readAttempts: number;
  lastSyncedAt: number | null;
};

export type FailedEdit = {
  id: string;
  kind: 'item' | 'note';
  message: string;
  itemId?: string;
  changes?: ItemChanges;
  body?: string;
};

export type OfflineState = {
  snapshot: SharedSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  connection: 'connecting' | 'live' | 'reconnecting' | 'error';
  pending: boolean;
  noteDraft: string;
  noteConflict: SharedNote | null;
  itemConflict: SharedItem | null;
  queuedCount: number;
  failedCount: number;
  failedDetails: FailedEdit[];
  syncStatus:
    'offline' | 'pending' | 'syncing' | 'synced' | 'failed' | 'reauth';
  storageError: string | null;
  online: boolean;
  nextRetryAt: number;
  lastSyncedAt: number | null;
};
