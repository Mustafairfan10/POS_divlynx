// Shared domain types. All money values are integer minor units (cents).

export type ID = string;

/** Fields every synced record carries. */
export interface BaseRecord {
  id: ID;
  createdAt: number;
  /** Client wall-clock time of last change. Used for last-writer-wins tie breaking. */
  updatedAt: number;
  deleted?: boolean;
}

export type EntityName =
  | "settings"
  | "categories"
  | "modifierGroups"
  | "menuItems"
  | "tables"
  | "staff"
  | "orders"
  | "payments";

export const ENTITIES: EntityName[] = [
  "settings",
  "categories",
  "modifierGroups",
  "menuItems",
  "tables",
  "staff",
  "orders",
  "payments",
];

export type Role = "admin" | "manager" | "cashier" | "kitchen";

export interface Settings extends BaseRecord {
  businessName: string;
  address: string;
  phone: string;
  taxId: string;
  currency: string; // ISO 4217, e.g. USD
  locale: string; // e.g. en-US
  taxRate: number; // percent, e.g. 8.5
  taxInclusive: boolean;
  serviceChargeRate: number; // percent, dine-in only
  deliveryFee: number; // cents
  tipsEnabled: boolean;
  tipPresets: number[]; // percents
  receiptHeader: string;
  receiptFooter: string;
  paperWidth: "58" | "80";
  /** Discounts above this percent of subtotal require manager approval. */
  discountApprovalThreshold: number;
  autoPrintReceipt: boolean;
}

export interface Category extends BaseRecord {
  name: string;
  color: string;
  sort: number;
}

export interface ModifierOption {
  id: ID;
  name: string;
  price: number;
}

export interface ModifierGroup extends BaseRecord {
  name: string;
  min: number; // 0 = optional
  max: number; // 1 = single choice
  options: ModifierOption[];
}

export interface MenuItem extends BaseRecord {
  name: string;
  categoryId: ID;
  price: number;
  description: string;
  available: boolean; // false = 86'd / sold out
  modifierGroupIds: ID[];
  sort: number;
}

export interface DiningTable extends BaseRecord {
  name: string;
  seats: number;
  area: string;
  sort: number;
}

export interface Staff extends BaseRecord {
  name: string;
  role: Role;
  pinHash: string;
  active: boolean;
}

export type OrderType = "dine_in" | "takeaway" | "delivery";
export type OrderStatus = "open" | "closed" | "cancelled";
export type Fulfillment = "new" | "in_kitchen" | "ready" | "out_for_delivery" | "done";
export type ItemStatus = "new" | "sent" | "ready" | "served";

export interface SelectedModifier {
  groupId: ID;
  groupName: string;
  optionId: ID;
  name: string;
  price: number;
}

export interface OrderItem {
  id: ID;
  menuItemId: ID;
  name: string;
  basePrice: number;
  modifiers: SelectedModifier[];
  qty: number;
  notes: string;
  status: ItemStatus;
  sentAt?: number;
  voided?: { reason: string; by: string; at: number; refunded?: boolean };
  addedBy: string;
  updatedAt: number;
}

export interface Discount {
  type: "percent" | "amount";
  value: number; // percent number, or cents
  reason: string;
  approvedBy?: string;
}

export interface Adjustment {
  id: ID;
  amount: number; // cents, reduces total (e.g. goodwill refund)
  reason: string;
  by: string;
  at: number;
}

export interface OrderLogEntry {
  id: ID;
  at: number;
  by: string;
  action: string;
  detail?: string;
}

export interface Customer {
  name: string;
  phone: string;
  address: string;
}

export interface Order extends BaseRecord {
  number: string;
  deviceCode: string;
  type: OrderType;
  status: OrderStatus;
  fulfillment: Fulfillment;
  tableId?: ID;
  guests?: number;
  customer: Customer;
  items: OrderItem[];
  discount?: Discount;
  serviceCharge: boolean;
  tip: number;
  deliveryFee: number;
  adjustments: Adjustment[];
  note: string;
  createdBy: string;
  closedAt?: number;
  cancelled?: { reason: string; by: string; at: number };
  billPrintedAt?: number;
  receiptPrints: number;
  log: OrderLogEntry[];
  /** Snapshot of tax config at creation so later settings changes don't rewrite history. */
  taxRate: number;
  taxInclusive: boolean;
  serviceChargeRate: number;
}

export type PaymentMethod = "cash" | "card" | "wallet" | "other";
export type PaymentKind = "payment" | "refund";
export type PaymentStatus = "approved" | "declined" | "voided";

export interface Payment extends BaseRecord {
  orderId: ID;
  orderNumber: string;
  kind: PaymentKind;
  method: PaymentMethod;
  amount: number; // always positive
  tendered?: number; // cash handed over
  change?: number;
  status: PaymentStatus;
  reference: string;
  reason?: string;
  by: string;
  deviceCode: string;
}

export interface EntityMap {
  settings: Settings;
  categories: Category;
  modifierGroups: ModifierGroup;
  menuItems: MenuItem;
  tables: DiningTable;
  staff: Staff;
  orders: Order;
  payments: Payment;
}

// ---- Sync protocol ----

export interface Mutation {
  mutationId: string;
  entity: EntityName;
  recordId: ID;
  baseVersion: number; // 0 = record didn't exist on server when edited
  data: BaseRecord;
}

export interface MutationResult {
  mutationId: string;
  entity: EntityName;
  recordId: ID;
  version: number;
  status: "applied" | "merged" | "duplicate" | "rejected";
  data?: BaseRecord; // merged/authoritative document when it differs from what client sent
  error?: string;
}

export interface PulledRecord {
  entity: EntityName;
  id: ID;
  version: number;
  seq: number;
  data: BaseRecord;
}

export interface PullResponse {
  records: PulledRecord[];
  cursor: number;
  hasMore: boolean;
  /** Highest sequence on the server. Lower than the client's cursor => server was reset. */
  maxSeq: number;
  serverTime: number;
}

export interface PushResponse {
  results: MutationResult[];
  serverTime: number;
}

export interface RegisterResponse {
  token: string;
  deviceId: string;
  deviceCode: string;
  isNewStore: boolean;
  storage: "postgres" | "embedded";
}
