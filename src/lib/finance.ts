import { exec, query } from "@/lib/mysql";
import {
  FINANCE_STATUSES,
  type CostInput,
  type FinanceCostStatus,
} from "@/lib/finance-validation";

export {
  FINANCE_CATEGORIES,
  FINANCE_PAYMENT_METHODS,
  FINANCE_STATUSES,
  formatBDT,
  normalizeRange,
  validateCostInput,
} from "@/lib/finance-validation";
export type { CostInput, FinanceCostStatus } from "@/lib/finance-validation";

// ── Finance & Cost Transparency ────────────────────────────────────────────
// TWO separate data sources, separated at the DB/API level:
//
//  1. COURSE INCOME (automated, READ-ONLY): aggregated live from the existing
//     `enrollments` (+ `enrollment_applications`) tables. There is NO manual
//     income table and NO API that writes income.
//
//  2. PHYSICAL / MANUAL COSTS (admin-managed): stored in
//     `finance_manual_costs` with soft-delete (`deleted_at`) and a dedicated
//     audit trail in `finance_audit_logs` (plus `admin_activity_logs`).

export type ManualCost = {
  id: number;
  costDate: string;
  category: string;
  itemName: string;
  description: string | null;
  amount: number;
  paidBy: string;
  paymentMethod: string;
  status: FinanceCostStatus;
  receiptUrl: string | null;
  note: string | null;
  createdByUid: string | null;
  createdByEmail: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/** Public-safe shape: no internal ids, emails, notes, receipts, auth data. */
export type PublicManualCost = {
  costDate: string;
  category: string;
  itemName: string;
  description: string | null;
  amount: number;
  paidBy: string;
  paymentMethod: string;
  status: FinanceCostStatus;
};

export type FinanceAuditEntry = {
  id: number;
  adminUid: string;
  adminEmail: string;
  action: string;
  recordId: number | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
};

type CostRow = {
  id: number | string;
  cost_date: Date | string;
  category: string;
  item_name: string;
  description: string | null;
  amount: string | number;
  paid_by: string;
  payment_method: string;
  status: string;
  receipt_url: string | null;
  note: string | null;
  created_by_uid: string | null;
  created_by_email: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
};

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

function toDateOnly(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function mapCost(row: CostRow): ManualCost {
  const status = (FINANCE_STATUSES as readonly string[]).includes(row.status)
    ? (row.status as FinanceCostStatus)
    : "paid";
  return {
    id: Number(row.id),
    costDate: toDateOnly(row.cost_date),
    category: row.category,
    itemName: row.item_name,
    description: row.description,
    amount: Number(row.amount) || 0,
    paidBy: row.paid_by,
    paymentMethod: row.payment_method,
    status,
    receiptUrl: row.receipt_url,
    note: row.note,
    createdByUid: row.created_by_uid,
    createdByEmail: row.created_by_email,
    createdAt: toIso(row.created_at) ?? "",
    updatedAt: toIso(row.updated_at) ?? "",
    deletedAt: toIso(row.deleted_at),
  };
}

let tablesEnsured = false;

export async function ensureFinanceTables(): Promise<void> {
  if (tablesEnsured) return;
  await exec(`CREATE TABLE IF NOT EXISTS finance_manual_costs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    cost_date DATE NOT NULL,
    category VARCHAR(64) NOT NULL DEFAULT 'Other',
    item_name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    amount DECIMAL(12,2) NOT NULL,
    paid_by VARCHAR(191) NOT NULL DEFAULT '',
    payment_method VARCHAR(32) NOT NULL DEFAULT 'Cash',
    status VARCHAR(16) NOT NULL DEFAULT 'paid',
    receipt_url VARCHAR(512) NULL,
    note TEXT NULL,
    created_by_uid VARCHAR(191) NULL,
    created_by_email VARCHAR(191) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    KEY finance_costs_date_idx (cost_date),
    KEY finance_costs_category_idx (category),
    KEY finance_costs_status_idx (status),
    KEY finance_costs_deleted_idx (deleted_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await exec(`CREATE TABLE IF NOT EXISTS finance_audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    admin_uid VARCHAR(191) NOT NULL DEFAULT '',
    admin_email VARCHAR(191) NOT NULL DEFAULT '',
    action VARCHAR(64) NOT NULL,
    record_id BIGINT UNSIGNED NULL,
    old_value JSON NULL,
    new_value JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY finance_audit_record_idx (record_id),
    KEY finance_audit_created_idx (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  tablesEnsured = true;
}

// ── COURSE INCOME (automated, read-only) ───────────────────────────────────
// Source of truth: existing `enrollments` rows.
//   Gross  = SUM(COALESCE(payment_amount, fee)) of paid enrollments with
//            status active/completed (approved, successful payments).
//   Refund = SUM(COALESCE(payment_amount, fee)) of paid enrollments later
//            cancelled (status = cancelled with a recorded payment).
//   Net    = Gross - Refund.
// Date basis: approval/enrollment date for gross, last update for refunds.

export type IncomeRow = {
  date: string;
  courseId: string;
  courseName: string;
  orders: number;
  gross: number;
  refund: number;
  net: number;
};

async function tableHasColumn(
  table: string,
  column: string,
): Promise<boolean> {
  try {
    const rows = await query<{ n: number }[]>(
      `SELECT COUNT(*) AS n FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [table, column],
      { cache: false },
    );
    return (rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

async function incomeAmountExpr(): Promise<string> {
  // Prefer the verified payment_amount when the migration exists.
  const has = await tableHasColumn("enrollments", "payment_amount");
  return has ? "COALESCE(e.payment_amount, e.fee, 0)" : "COALESCE(e.fee, 0)";
}

async function incomeDateExpr(): Promise<string> {
  const has = await tableHasColumn("enrollments", "approved_at");
  return has ? "COALESCE(DATE(e.approved_at), DATE(e.enrollment_date))" : "DATE(e.enrollment_date)";
}

export async function fetchCourseIncome(options: {
  from?: string | null;
  to?: string | null;
  course?: string | null;
  search?: string | null;
}): Promise<IncomeRow[]> {
  const amount = await incomeAmountExpr();
  const dateExpr = await incomeDateExpr();
  const conditions: string[] = [
    "e.course_kind = 'paid'",
    "e.enrollment_status IN ('active','completed','cancelled')",
  ];
  const params: unknown[] = [];
  if (options.from) {
    conditions.push(`${dateExpr} >= ?`);
    params.push(options.from);
  }
  if (options.to) {
    conditions.push(`${dateExpr} <= ?`);
    params.push(options.to);
  }
  if (options.course) {
    conditions.push("e.course_id = ?");
    params.push(options.course);
  }
  if (options.search && options.search.trim()) {
    conditions.push("(e.course_name LIKE ? OR e.course_id LIKE ?)");
    const like = `%${options.search.trim()}%`;
    params.push(like, like);
  }
  let rows: {
    day: Date | string;
    course_id: string;
    course_name: string;
    orders: number | string;
    gross: number | string | null;
    refund: number | string | null;
  }[];
  try {
    rows = await query(
      `SELECT ${dateExpr} AS day, e.course_id, e.course_name,
              COUNT(*) AS orders,
              SUM(CASE WHEN e.enrollment_status IN ('active','completed') THEN ${amount} ELSE 0 END) AS gross,
              SUM(CASE WHEN e.enrollment_status = 'cancelled' THEN ${amount} ELSE 0 END) AS refund
         FROM enrollments e
        WHERE ${conditions.join(" AND ")}
        GROUP BY day, e.course_id, e.course_name
        ORDER BY day DESC
        LIMIT 1000`,
      params,
      { cache: 5000 },
    );
  } catch {
    return [];
  }
  return rows.map((r) => {
    const gross = Number(r.gross) || 0;
    const refund = Number(r.refund) || 0;
    return {
      date: toDateOnly(r.day),
      courseId: r.course_id,
      courseName: r.course_name,
      orders: Number(r.orders) || 0,
      gross,
      refund,
      net: gross - refund,
    };
  });
}

export async function fetchIncomeTotals(options: {
  from?: string | null;
  to?: string | null;
}): Promise<{ gross: number; refund: number; net: number; orders: number; courses: number }> {
  const rows = await fetchCourseIncome(options);
  const courses = new Set(rows.map((r) => r.courseId));
  return {
    gross: rows.reduce((s, r) => s + r.gross, 0),
    refund: rows.reduce((s, r) => s + r.refund, 0),
    net: rows.reduce((s, r) => s + r.net, 0),
    orders: rows.reduce((s, r) => s + r.orders, 0),
    courses: courses.size,
  };
}

// ── MANUAL COST queries ────────────────────────────────────────────────────

export type CostFilters = {
  from?: string | null;
  to?: string | null;
  category?: string | null;
  status?: string | null;
  paidBy?: string | null;
  search?: string | null;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
};

function buildCostWhere(filters: CostFilters): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (!filters.includeDeleted) conditions.push("deleted_at IS NULL");
  if (filters.from) {
    conditions.push("cost_date >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push("cost_date <= ?");
    params.push(filters.to);
  }
  if (filters.category) {
    conditions.push("category = ?");
    params.push(filters.category);
  }
  if (filters.status && (FINANCE_STATUSES as readonly string[]).includes(filters.status)) {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.paidBy) {
    conditions.push("paid_by = ?");
    params.push(filters.paidBy);
  }
  if (filters.search && filters.search.trim()) {
    conditions.push("(item_name LIKE ? OR description LIKE ? OR category LIKE ? OR paid_by LIKE ?)");
    const like = `%${filters.search.trim().slice(0, 100)}%`;
    params.push(like, like, like, like);
  }
  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export async function fetchManualCosts(
  filters: CostFilters = {},
): Promise<{ costs: ManualCost[]; total: number }> {
  await ensureFinanceTables();
  const { clause, params } = buildCostWhere(filters);
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);
  try {
    const [rows, countRows] = await Promise.all([
      query<CostRow[]>(
        `SELECT * FROM finance_manual_costs ${clause}
         ORDER BY cost_date DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
        params,
        { cache: false },
      ),
      query<{ n: number | string }[]>(
        `SELECT COUNT(*) AS n FROM finance_manual_costs ${clause}`,
        params,
        { cache: false },
      ),
    ]);
    return {
      costs: rows.map(mapCost),
      total: Number(countRows[0]?.n) || 0,
    };
  } catch {
    return { costs: [], total: 0 };
  }
}

export async function fetchCostById(id: number): Promise<ManualCost | null> {
  await ensureFinanceTables();
  try {
    const rows = await query<CostRow[]>(
      "SELECT * FROM finance_manual_costs WHERE id = ? LIMIT 1",
      [id],
      { cache: false },
    );
    return rows[0] ? mapCost(rows[0]) : null;
  } catch {
    return null;
  }
}

/** SUM over valid (non-deleted, non-cancelled) cost records. */
export async function fetchCostTotals(filters: CostFilters = {}): Promise<{
  total: number;
  transactions: number;
}> {
  await ensureFinanceTables();
  const withStatus = { ...filters };
  // Cancelled records are kept for history but excluded from totals.
  const { clause, params } = buildCostWhere(withStatus);
  const extra = "status != 'cancelled'";
  const fullClause = clause ? `${clause} AND ${extra}` : `WHERE ${extra}`;
  try {
    const rows = await query<{ total: number | string | null; n: number | string }[]>(
      `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS n
         FROM finance_manual_costs ${fullClause}`,
      params,
      { cache: false },
    );
    return {
      total: Number(rows[0]?.total) || 0,
      transactions: Number(rows[0]?.n) || 0,
    };
  } catch {
    return { total: 0, transactions: 0 };
  }
}

export async function fetchCategoryBreakdown(filters: CostFilters = {}): Promise<
  { category: string; transactions: number; total: number }[]
> {
  await ensureFinanceTables();
  const { clause, params } = buildCostWhere(filters);
  const extra = "status != 'cancelled'";
  const fullClause = clause ? `${clause} AND ${extra}` : `WHERE ${extra}`;
  try {
    const rows = await query<{
      category: string;
      n: number | string;
      total: number | string | null;
    }[]>(
      `SELECT category, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total
         FROM finance_manual_costs ${fullClause}
        GROUP BY category ORDER BY total DESC`,
      params,
      { cache: false },
    );
    return rows.map((r) => ({
      category: r.category,
      transactions: Number(r.n) || 0,
      total: Number(r.total) || 0,
    }));
  } catch {
    return [];
  }
}

export async function fetchAdminSpending(filters: CostFilters = {}): Promise<
  { paidBy: string; transactions: number; total: number; percentage: number }[]
> {
  await ensureFinanceTables();
  const { clause, params } = buildCostWhere(filters);
  const extra = "status != 'cancelled'";
  const fullClause = clause ? `${clause} AND ${extra}` : `WHERE ${extra}`;
  try {
    const rows = await query<{
      paid_by: string;
      n: number | string;
      total: number | string | null;
    }[]>(
      `SELECT paid_by, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total
         FROM finance_manual_costs ${fullClause}
        GROUP BY paid_by ORDER BY total DESC`,
      params,
      { cache: false },
    );
    const grand = rows.reduce((s, r) => s + (Number(r.total) || 0), 0);
    return rows.map((r) => {
      const total = Number(r.total) || 0;
      return {
        paidBy: r.paid_by,
        transactions: Number(r.n) || 0,
        total,
        percentage: grand > 0 ? Math.round((total / grand) * 1000) / 10 : 0,
      };
    });
  } catch {
    return [];
  }
}

export async function fetchMonthlyReport(year: number): Promise<
  { month: string; courseIncome: number; physicalCosts: number; net: number }[]
> {
  const y = Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : new Date().getFullYear();
  const [incomeRows, costRows] = await Promise.all([
    fetchCourseIncome({ from: `${y}-01-01`, to: `${y}-12-31` }),
    (async () => {
      await ensureFinanceTables();
      try {
        return await query<{ m: number | string; total: number | string | null }[]>(
          `SELECT MONTH(cost_date) AS m, COALESCE(SUM(amount),0) AS total
             FROM finance_manual_costs
            WHERE deleted_at IS NULL AND status != 'cancelled'
              AND cost_date >= ? AND cost_date <= ?
            GROUP BY m`,
          [`${y}-01-01`, `${y}-12-31`],
          { cache: false },
        );
      } catch {
        return [];
      }
    })(),
  ]);
  const incomeByMonth = new Map<number, number>();
  for (const r of incomeRows) {
    const m = Number(r.date.slice(5, 7));
    incomeByMonth.set(m, (incomeByMonth.get(m) ?? 0) + r.net);
  }
  const costByMonth = new Map<number, number>();
  for (const r of costRows) {
    costByMonth.set(Number(r.m), Number(r.total) || 0);
  }
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return MONTHS.map((month, i) => {
    const m = i + 1;
    const courseIncome = incomeByMonth.get(m) ?? 0;
    const physicalCosts = costByMonth.get(m) ?? 0;
    return { month, courseIncome, physicalCosts, net: courseIncome - physicalCosts };
  });
}

// ── Mutations (admin only — enforced in API routes) ────────────────────────

export async function createManualCost(
  input: CostInput,
  createdBy: { uid: string; email: string | null },
): Promise<ManualCost> {
  await ensureFinanceTables();
  const { exec: runExec } = await import("@/lib/mysql");
  const result = await runExec(
    `INSERT INTO finance_manual_costs
      (cost_date, category, item_name, description, amount, paid_by,
       payment_method, status, receipt_url, note, created_by_uid, created_by_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.costDate,
      input.category,
      input.itemName,
      input.description,
      input.amount,
      input.paidBy,
      input.paymentMethod,
      input.status,
      input.receiptUrl,
      input.note,
      createdBy.uid,
      createdBy.email,
    ],
  );
  const created = await fetchCostById(Number(result.insertId));
  if (!created) throw new Error("Failed to create the cost record.");
  await writeFinanceAudit(
    createdBy,
    "created",
    created.id,
    null,
    sanitizeForAudit(created),
  );
  return created;
}

export async function updateManualCost(
  id: number,
  input: CostInput,
  admin: { uid: string; email: string | null },
): Promise<ManualCost | null> {
  await ensureFinanceTables();
  const existing = await fetchCostById(id);
  if (!existing || existing.deletedAt) return null;
  const { exec: runExec } = await import("@/lib/mysql");
  const result = await runExec(
    `UPDATE finance_manual_costs SET
       cost_date = ?, category = ?, item_name = ?, description = ?,
       amount = ?, paid_by = ?, payment_method = ?, status = ?,
       receipt_url = ?, note = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [
      input.costDate,
      input.category,
      input.itemName,
      input.description,
      input.amount,
      input.paidBy,
      input.paymentMethod,
      input.status,
      input.receiptUrl,
      input.note,
      id,
    ],
  );
  if (result.affectedRows === 0) return null;
  const updated = await fetchCostById(id);
  if (updated) {
    await writeFinanceAudit(
      admin,
      "updated",
      id,
      sanitizeForAudit(existing),
      sanitizeForAudit(updated),
    );
  }
  return updated;
}

export async function softDeleteManualCost(
  id: number,
  admin: { uid: string; email: string | null },
): Promise<boolean> {
  await ensureFinanceTables();
  const existing = await fetchCostById(id);
  if (!existing || existing.deletedAt) return false;
  const { exec: runExec } = await import("@/lib/mysql");
  const result = await runExec(
    "UPDATE finance_manual_costs SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL",
    [id],
  );
  if (result.affectedRows === 0) return false;
  await writeFinanceAudit(
    admin,
    "soft_deleted",
    id,
    sanitizeForAudit(existing),
    null,
  );
  return true;
}

function sanitizeForAudit(cost: ManualCost): Record<string, unknown> {
  // Audit keeps full values server-side (admin-only reads); strip nothing
  // except keeping it JSON-safe.
  return {
    costDate: cost.costDate,
    category: cost.category,
    itemName: cost.itemName,
    description: cost.description,
    amount: cost.amount,
    paidBy: cost.paidBy,
    paymentMethod: cost.paymentMethod,
    status: cost.status,
    receiptUrl: cost.receiptUrl,
    note: cost.note,
  };
}

export async function writeFinanceAudit(
  admin: { uid: string; email?: string | null },
  action: string,
  recordId: number | null,
  oldValue: unknown,
  newValue: unknown,
): Promise<void> {
  try {
    await ensureFinanceTables();
    const { exec: runExec } = await import("@/lib/mysql");
    await runExec(
      `INSERT INTO finance_audit_logs (admin_uid, admin_email, action, record_id, old_value, new_value)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        admin.uid,
        admin.email ?? "",
        action.slice(0, 64),
        recordId,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
      ],
    );
  } catch {
    // Audit write must never break the request.
  }
}

export async function fetchFinanceAudit(limit = 200): Promise<FinanceAuditEntry[]> {
  await ensureFinanceTables();
  try {
    const rows = await query<{
      id: number | string;
      admin_uid: string;
      admin_email: string;
      action: string;
      record_id: number | string | null;
      old_value: unknown;
      new_value: unknown;
      created_at: Date | string;
    }[]>(
      `SELECT * FROM finance_audit_logs ORDER BY created_at DESC LIMIT ${Math.min(500, Math.max(1, limit))}`,
      [],
      { cache: false },
    );
    return rows.map((r) => ({
      id: Number(r.id),
      adminUid: r.admin_uid,
      adminEmail: r.admin_email,
      action: r.action,
      recordId: r.record_id === null ? null : Number(r.record_id),
      oldValue: parseMaybeJson(r.old_value),
      newValue: parseMaybeJson(r.new_value),
      createdAt: toIso(r.created_at) ?? "",
    }));
  } catch {
    return [];
  }
}

function parseMaybeJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
