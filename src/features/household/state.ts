export const ITEM_TITLE_LIMIT = 120;
export const QUANTITY_LIMIT = 40;
export const NOTE_LIMIT = 2000;

export type GroceryItem = {
  id: string;
  title: string;
  quantity: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type HouseholdState = {
  version: 1;
  items: GroceryItem[];
  note: string;
};

export type HouseholdAction =
  | { type: 'add'; item: GroceryItem }
  | { type: 'toggle'; id: string; updatedAt: string }
  | { type: 'remove'; id: string }
  | { type: 'clear-completed' }
  | { type: 'update-note'; note: string };

export function createItem(
  id: string,
  title: string,
  quantity: string,
  now: string,
): GroceryItem {
  const cleanTitle = title.trim();
  const cleanQuantity = quantity.trim() || '1';

  if (
    !id.trim() ||
    !cleanTitle ||
    cleanTitle.length > ITEM_TITLE_LIMIT ||
    cleanQuantity.length > QUANTITY_LIMIT ||
    !isDate(now)
  ) {
    throw new Error('Invalid grocery item.');
  }

  return {
    id,
    title: cleanTitle,
    quantity: cleanQuantity,
    completed: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function createInitialState(): HouseholdState {
  // Examples are created only when there is no existing local list.
  const now = new Date().toISOString();

  return {
    version: 1,
    items: [
      createItem('example-milk', 'Milk', '1 carton', now),
      createItem('example-eggs', 'Eggs', '6', now),
      createItem('example-pasta', 'Pasta', '2 packs', now),
    ],
    note: '',
  };
}

export function householdReducer(
  state: HouseholdState,
  action: HouseholdAction,
): HouseholdState {
  switch (action.type) {
    case 'add':
      // Retried operations must not duplicate an existing item.
      return state.items.some((item) => item.id === action.item.id)
        ? state
        : { ...state, items: [...state.items, action.item] };
    case 'toggle':
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id
            ? {
                ...item,
                completed: !item.completed,
                updatedAt: action.updatedAt,
              }
            : item,
        ),
      };
    case 'remove':
      return {
        ...state,
        items: state.items.filter((item) => item.id !== action.id),
      };
    case 'clear-completed':
      return {
        ...state,
        items: state.items.filter((item) => !item.completed),
      };
    case 'update-note':
      return { ...state, note: action.note.slice(0, NOTE_LIMIT) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isItem(value: unknown): value is GroceryItem {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    typeof value.title === 'string' &&
    value.title.trim().length > 0 &&
    value.title.length <= ITEM_TITLE_LIMIT &&
    typeof value.quantity === 'string' &&
    value.quantity.trim().length > 0 &&
    value.quantity.length <= QUANTITY_LIMIT &&
    typeof value.completed === 'boolean' &&
    isDate(value.createdAt) &&
    isDate(value.updatedAt)
  );
}

export function parseHouseholdState(raw: string): HouseholdState {
  const value: unknown = JSON.parse(raw);

  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.note !== 'string' ||
    value.note.length > NOTE_LIMIT ||
    !Array.isArray(value.items) ||
    !value.items.every(isItem) ||
    new Set(value.items.map((item: GroceryItem) => item.id)).size !==
      value.items.length
  ) {
    // Do not silently replace unreadable or newer saved data with examples.
    throw new Error('The saved household data could not be read.');
  }

  return { version: 1, items: value.items, note: value.note };
}
