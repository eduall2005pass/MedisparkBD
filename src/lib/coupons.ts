import { exec, query } from "@/lib/mysql";
import { normalizeCouponCode } from "@/lib/form-validation";

// Admin Panel → Courses → Coupons. Discount codes validated at checkout.

export type Coupon = {
  code: string;
  discountType: "percent" | "flat";
  value: number;
  maxUses: number;
  usedCount: number;
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
};

type CouponRow = {
  code: string;
  discount_type: string;
  value: string | number;
  max_uses: number;
  used_count: number;
  starts_at: Date | string | null;
  expires_at: Date | string | null;
  is_active: number | boolean;
};

function toIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function rowToCoupon(row: CouponRow): Coupon {
  return {
    code: row.code,
    discountType: row.discount_type === "flat" ? "flat" : "percent",
    value: Number(row.value) || 0,
    maxUses: row.max_uses ?? 0,
    usedCount: row.used_count ?? 0,
    startsAt: toIso(row.starts_at),
    expiresAt: toIso(row.expires_at),
    isActive: Boolean(row.is_active),
  };
}

async function ensureCouponsTable(): Promise<void> {
  await exec(`CREATE TABLE IF NOT EXISTS coupons (
    code VARCHAR(64) NOT NULL PRIMARY KEY,
    discount_type ENUM('percent','flat') NOT NULL DEFAULT 'percent',
    value DECIMAL(10,2) NOT NULL DEFAULT 0,
    max_uses INT NOT NULL DEFAULT 0,
    used_count INT NOT NULL DEFAULT 0,
    starts_at DATETIME NULL,
    expires_at DATETIME NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

export async function fetchCoupons(): Promise<Coupon[]> {
  try {
    await ensureCouponsTable();
    const rows = await query<CouponRow[]>(
      `SELECT * FROM coupons ORDER BY created_at DESC`,
    );
    return rows.map(rowToCoupon);
  } catch {
    return [];
  }
}

/** True when the coupon has exhausted its capped usage (maxUses > 0). */
export function isCouponExhausted(coupon: Coupon): boolean {
  return coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses;
}

/** Returns the coupon when valid and usable, otherwise an error message. */
export async function validateCoupon(
  code: string,
): Promise<{ coupon: Coupon; error?: undefined } | { coupon?: undefined; error: string }> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { error: "Coupon code is required." };
  let rows: CouponRow[];
  try {
    await ensureCouponsTable();
    // Fresh read: used_count must never come from the SELECT cache, or an
    // exhausted coupon could validate between the check and increment.
    rows = await query<CouponRow[]>(
      `SELECT * FROM coupons WHERE code = ? LIMIT 1`,
      [normalized],
      { cache: false },
    );
  } catch {
    return { error: "Could not verify the coupon. Try again." };
  }
  const coupon = rows[0] ? rowToCoupon(rows[0]) : null;
  if (!coupon) return { error: "Invalid coupon code." };
  if (!coupon.isActive) return { error: "This coupon is inactive." };
  const now = Date.now();
  if (coupon.startsAt && new Date(coupon.startsAt).getTime() > now) {
    return { error: "This coupon is not active yet." };
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < now) {
    return { error: "This coupon has expired." };
  }
  if (isCouponExhausted(coupon)) {
    return { error: "This coupon has reached its usage limit." };
  }
  return { coupon };
}

export async function saveCoupon(
  input: Record<string, unknown>,
): Promise<Coupon> {
  await ensureCouponsTable();
  const code = normalizeCouponCode(input.code);
  if (!code || code.length < 3 || code.length > 64) {
    throw new Error("Code must be 3-64 letters, numbers, dashes or underscores.");
  }
  const rawCode = code;
  const discountType = input.discountType === "flat" ? "flat" : "percent";
  const value = Math.max(0, Number(input.value) || 0);
  if (discountType === "percent" && value > 100) {
    throw new Error("Percent discount cannot exceed 100.");
  }
  const toDateTime = (raw: unknown): string | null => {
    if (typeof raw !== "string" || !raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 19).replace("T", " ");
  };
  const startsAt = toDateTime(input.startsAt);
  const expiresAt = toDateTime(input.expiresAt);
  if (startsAt && expiresAt && startsAt > expiresAt) {
    throw new Error("Start date must be before the expiry date.");
  }
  const maxUses = Math.max(0, Math.floor(Number(input.maxUses) || 0));
  if (maxUses > 1000000) {
    throw new Error("Max uses looks too large (max 1,000,000).");
  }

  const existing = await query<{ used_count: number }[]>(
    `SELECT used_count FROM coupons WHERE code = ? LIMIT 1`,
    [rawCode],
  );

  await exec(
    `INSERT INTO coupons (code, discount_type, value, max_uses, used_count, starts_at, expires_at, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE discount_type = VALUES(discount_type), value = VALUES(value),
       max_uses = VALUES(max_uses), starts_at = VALUES(starts_at), expires_at = VALUES(expires_at),
       is_active = VALUES(is_active)`,
    [
      rawCode,
      discountType,
      value,
      maxUses,
      existing[0]?.used_count ?? 0,
      startsAt,
      expiresAt,
      input.isActive === false ? 0 : 1,
    ],
  );

  const rows = await query<CouponRow[]>(
    `SELECT * FROM coupons WHERE code = ? LIMIT 1`,
    [rawCode],
  );
  return rowToCoupon(rows[0]);
}

export async function deleteCoupon(code: string): Promise<void> {
  await ensureCouponsTable();
  await exec(`DELETE FROM coupons WHERE code = ?`, [code.trim().toUpperCase()]);
}

/** Discounted fee for a validated coupon — never below zero. */
export function computeDiscountedFee(coupon: Coupon, amount: number): number {
  const base = Math.max(0, amount);
  if (coupon.discountType === "percent") {
    return Math.max(0, Math.round(base * (1 - coupon.value / 100)));
  }
  return Math.max(0, Math.round(base - coupon.value));
}

/** Count one more use — atomic cap check. Returns true when counted. */
export async function incrementCouponUsage(code: string): Promise<boolean> {
  try {
    await ensureCouponsTable();
    const result = await exec(
      `UPDATE coupons SET used_count = used_count + 1
       WHERE code = ? AND (max_uses <= 0 OR used_count < max_uses)`,
      [code.trim().toUpperCase()],
    );
    return result.affectedRows > 0;
  } catch {
    // Usage counting is best-effort; enrollment must not fail for it.
    return false;
  }
}
