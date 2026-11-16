export type SharedItem = {
  id: string;
  title: string;
  quantity: string;
  completed: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  deleted_at: string | null;
};

export type SharedNote = {
  id: string;
  body: string;
  updated_by: string | null;
  updated_at: string;
  revision: number;
};

export type SharedSnapshot = {
  items: SharedItem[];
  note: SharedNote;
};

export type ItemChanges = {
  title?: string;
  quantity?: string;
  completed?: boolean;
  deleted?: boolean;
};

export type ItemMutationRequest = {
  operationId: string;
  householdId: string;
  itemId: string;
  baseRevision: number;
  changes: ItemChanges;
};

export type NoteMutationRequest = {
  operationId: string;
  householdId: string;
  baseRevision: number;
  body: string;
};

export type ItemResult =
  | { status: 'applied'; item: SharedItem }
  | { status: 'conflict'; item: SharedItem | null };

export type NoteResult = {
  status: 'applied' | 'conflict';
  note: SharedNote;
};
