"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { FINANCE_CATEGORIES, formatBDT, validateCostInput } from "@/lib/finance-validation";

const PAYMENT_METHODS = ["Cash", "Bank", "Card", "Mobile Banking", "Other"];
const STATUSES = ["paid", "pending", "cancelled"] as const;

type Summary = {
  from: string | null;
  to: string | null;
  courseIncome: { gross: number; refund: number; net: number; orders: number; courses: number };
  physicalCosts: { total: number; transactions: number };
  netBalance: number;
  categories: { category: string; transactions: number; total: number }[];
  adminSpending: { paidBy: string; transactions: number; total: number; percentage: number }[];
  lastUpdated: string;
};

type IncomeRow = {
  date: string;
  courseId: string;
  courseName: string;
  orders: number;
  gross: number;
  refund: number;
  net: number;
};

type Cost = {
  id?: number;
  costDate: string;
  category: string;
  itemName: string;
  description: string | null;
  amount: number;
  paidBy: string;
  paymentMethod: string;
  status: string;
  receiptUrl?: string | null;
  note?: string | null;
};

type AuditEntry = {
  id: number;
  adminUid: string;
  adminEmail: string;
  action: string;
  recordId: number | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
};

type Preset = "today" | "week" | "month" | "lastMonth" | "year" | "all" | "custom";

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function presetRange(preset: Preset): { from: string | null; to: string | null } {
  const now = new Date();
  if (preset === "all") return { from: null, to: null };
  if (preset === "today") {
    const t = toISODate(now);
    return { from: t, to: t };
  }
  if (preset === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    return { from: toISODate(start), to: toISODate(now) };
  }
  if (preset === "month") {
    return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toISODate(now) };
  }
  if (preset === "lastMonth") {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: toISODate(first), to: toISODate(last) };
  }
  if (preset === "year") {
    return { from: `${now.getFullYear()}-01-01`, to: toISODate(now) };
  }
  return { from: null, to: null };
}

const EMPTY_FORM = {
  costDate: toISODate(new Date()),
  category: "Equipment",
  itemName: "",
  description: "",
  amount: "",
  paidBy: "",
  paymentMethod: "Cash",
  status: "paid",
  receiptUrl: "",
  note: "",
};

export default function FinanceClient() {
  const { user, signInWithGoogle, logout } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [tab, setTab] = useState<"overview" | "income" | "costs" | "monthly" | "audit">("overview");
  const [preset, setPreset] = useState<Preset>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range = useMemo(() => {
    if (preset === "custom") {
      return {
        from: customFrom || null,
        to: customTo || null,
      };
    }
    return presetRange(preset);
  }, [preset, customFrom, customTo]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (range.from) p.set("from", range.from);
    if (range.to) p.set("to", range.to);
    return p.toString();
  }, [range]);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [income, setIncome] = useState<{ rows: IncomeRow[]; totals: IncomeRow } | null>(null);
  const [costs, setCosts] = useState<{ costs: Cost[]; total: number }>({ costs: [], total: 0 });
  const [monthly, setMonthly] = useState<{
    year: number;
    months: { month: string; courseIncome: number; physicalCosts: number; net: number }[];
    totals: { courseIncome: number; physicalCosts: number; net: number };
  } | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());

  // Cost table controls
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [incomeSearch, setIncomeSearch] = useState("");

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Cost | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  async function authedHeaders(): Promise<Record<string, string>> {
    if (!user) return {};
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  }

  // Admin gate check (server-side verified)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) {
        if (!cancelled) {
          setIsAdmin(false);
          setAdminEmail(null);
        }
        return;
      }
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/admin", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = (await res.json().catch(() => null)) as {
          isAdmin?: boolean;
          admin?: { email?: string | null };
        } | null;
        if (!cancelled) {
          setIsAdmin(data?.isAdmin === true);
          setAdminEmail(data?.admin?.email ?? null);
        }
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authedHeaders();
      const [s, i, c, m] = await Promise.all([
        fetch(`/api/finance/summary?${query}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/finance/income?${query}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/finance/costs?${query}&pageSize=100`, {
          headers,
          cache: "no-store",
        }).then((r) => r.json()),
        fetch(`/api/finance/monthly?year=${year}`, { cache: "no-store" }).then((r) => r.json()),
      ]);
      setSummary(s);
      setIncome(i);
      setCosts(c);
      setMonthly(m);
      if (isAdmin && user) {
        const token = await user.getIdToken();
        const a = await fetch("/api/finance/audit?limit=100", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }).then((r) => r.json().catch(() => null));
        if (a?.entries) setAudit(a.entries);
      }
    } catch {
      showToast("Failed to load finance data.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, year, isAdmin, user?.uid]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleLogin() {
    setLoginBusy(true);
    setLoginError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : "Login failed.");
    } finally {
      setLoginBusy(false);
    }
  }

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, costDate: toISODate(new Date()), paidBy: adminEmail?.split("@")[0] ?? "" });
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(cost: Cost) {
    setEditing(cost);
    setForm({
      costDate: cost.costDate,
      category: cost.category,
      itemName: cost.itemName,
      description: cost.description ?? "",
      amount: String(cost.amount),
      paidBy: cost.paidBy,
      paymentMethod: cost.paymentMethod,
      status: cost.status,
      receiptUrl: cost.receiptUrl ?? "",
      note: cost.note ?? "",
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setFormError(null);
    const checked = validateCostInput({
      costDate: form.costDate,
      category: form.category,
      itemName: form.itemName,
      description: form.description || null,
      amount: Number(form.amount),
      paidBy: form.paidBy,
      paymentMethod: form.paymentMethod,
      status: form.status,
      receiptUrl: form.receiptUrl || null,
      note: form.note || null,
    });
    if (!checked.ok) {
      setFormError(checked.error);
      setSaving(false);
      return;
    }
    try {
      const token = user ? await user.getIdToken() : null;
      if (!token) throw new Error("Please log in as an admin first.");
      const payload = {
        costDate: form.costDate,
        category: form.category,
        itemName: form.itemName,
        description: form.description || null,
        amount: Number(form.amount),
        paidBy: form.paidBy,
        paymentMethod: form.paymentMethod,
        status: form.status,
        receiptUrl: form.receiptUrl || null,
        note: form.note || null,
      };
      const url =
        editing?.id != null ? `/api/finance/costs/${editing.id}` : "/api/finance/costs";
      const res = await fetch(url, {
        method: editing?.id != null ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "Save failed.");
      setModalOpen(false);
      showToast(editing ? "Cost updated." : "Cost added.");
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(cost: Cost) {
    if (cost.id == null) return;
    if (!window.confirm(`Soft-delete "${cost.itemName}" (${formatBDT(cost.amount)})? It will stay in history.`)) return;
    try {
      const token = user ? await user.getIdToken() : null;
      const res = await fetch(`/api/finance/costs/${cost.id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Delete failed.");
      }
      showToast("Record moved to history.");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Delete failed.");
    }
  }

  async function handleExport() {
    try {
      const token = user ? await user.getIdToken() : null;
      if (!token) throw new Error("Admin login required.");
      const p = new URLSearchParams(query);
      if (categoryFilter) p.set("category", categoryFilter);
      if (search) p.set("search", search);
      const res = await fetch(`/api/finance/export?format=csv&${p.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Export failed.");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `medispark-costs-${range.from ?? "all"}-${range.to ?? "all"}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Export failed.");
    }
  }

  const filteredCosts = useMemo(() => {
    let list = costs.costs;
    if (categoryFilter) list = list.filter((c) => c.category === categoryFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((c) =>
        [c.itemName, c.category, c.paidBy, c.description ?? ""].join(" ").toLowerCase().includes(q),
      );
    }
    return list;
  }, [costs.costs, categoryFilter, search]);

  const filteredIncome = useMemo(() => {
    if (!income) return [];
    if (!incomeSearch.trim()) return income.rows;
    const q = incomeSearch.trim().toLowerCase();
    return income.rows.filter((r) =>
      `${r.courseName} ${r.courseId}`.toLowerCase().includes(q),
    );
  }, [income, incomeSearch]);

  const maxCategory = summary?.categories[0]?.total ?? 1;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Finance &amp; Cost Transparency</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Course income is calculated automatically from enrollments. Physical costs are managed by admins.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <span className="max-w-[180px] truncate text-xs text-gray-500 dark:text-gray-400">
                  {adminEmail ?? user.email}
                  {isAdmin && <span className="ml-1 rounded bg-green-100 px-1.5 py-0.5 font-semibold text-green-700 dark:bg-green-900 dark:text-green-300">ADMIN</span>}
                </span>
                <button
                  onClick={() => void logout()}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  Logout
                </button>
              </>
            ) : (
              <button
                onClick={() => void handleLogin()}
                disabled={loginBusy}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {loginBusy ? "Signing in…" : "Login with Google"}
              </button>
            )}
          </div>
        </div>
        {loginError && <p className="mt-2 text-sm text-red-600">{loginError}</p>}
        {!user && (
          <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            Public transparency view — no login needed. Admins log in with Google to manage physical costs.
          </p>
        )}

        {/* Date filter */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(["today", "week", "month", "lastMonth", "year", "all", "custom"] as Preset[]).map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                preset === p
                  ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                  : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-700"
              }`}
            >
              {{ today: "Today", week: "This Week", month: "This Month", lastMonth: "Last Month", year: "This Year", all: "All Time", custom: "Custom" }[p]}
            </button>
          ))}
          {preset === "custom" && (
            <span className="flex items-center gap-2 text-xs">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-lg border px-2 py-1.5 dark:border-gray-700 dark:bg-gray-900" />
              <span>→</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded-lg border px-2 py-1.5 dark:border-gray-700 dark:bg-gray-900" />
            </span>
          )}
        </div>

        {/* Summary cards */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-green-50 p-4 ring-1 ring-green-200 dark:bg-green-950 dark:ring-green-900">
            <p className="text-sm font-medium text-green-700 dark:text-green-300">🟢 Course Income</p>
            <p className="mt-1 text-2xl font-bold text-green-800 dark:text-green-200">
              {loading ? "…" : formatBDT(summary?.courseIncome.net ?? 0)}
            </p>
            <p className="mt-1 text-xs text-green-600 dark:text-green-400">
              Gross {formatBDT(summary?.courseIncome.gross ?? 0)} · Refund {formatBDT(summary?.courseIncome.refund ?? 0)} · {summary?.courseIncome.orders ?? 0} orders
            </p>
          </div>
          <div className="rounded-2xl bg-red-50 p-4 ring-1 ring-red-200 dark:bg-red-950 dark:ring-red-900">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">🔴 Physical Costs</p>
            <p className="mt-1 text-2xl font-bold text-red-800 dark:text-red-200">
              {loading ? "…" : formatBDT(summary?.physicalCosts.total ?? 0)}
            </p>
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {summary?.physicalCosts.transactions ?? 0} transactions · admin-entered
            </p>
          </div>
          <div className="rounded-2xl bg-blue-50 p-4 ring-1 ring-blue-200 dark:bg-blue-950 dark:ring-blue-900">
            <p className="text-sm font-medium text-blue-700 dark:text-blue-300">💰 Net Balance</p>
            <p className="mt-1 text-2xl font-bold text-blue-800 dark:text-blue-200">
              {loading ? "…" : formatBDT(summary?.netBalance ?? 0)}
            </p>
            <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">Income − Physical Costs</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800">
          {(
            [
              ["overview", "Overview"],
              ["income", "Course Income"],
              ["costs", "Physical Costs"],
              ["monthly", "Monthly"],
              ...(isAdmin ? [["audit", "Audit Log"] as const] : []),
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`whitespace-nowrap px-4 py-2 text-sm font-medium ${
                tab === key
                  ? "border-b-2 border-blue-600 text-blue-600 dark:text-blue-400"
                  : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              {label}
              {key === "income" && <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] dark:bg-gray-800">auto</span>}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
              <h2 className="font-semibold">Spending by Category</h2>
              <div className="mt-3 space-y-2">
                {(summary?.categories ?? []).slice(0, 8).map((c) => (
                  <div key={c.category}>
                    <div className="flex justify-between text-xs">
                      <span>{c.category} · {c.transactions}</span>
                      <span className="font-semibold">{formatBDT(c.total)}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-gray-100 dark:bg-gray-800">
                      <div
                        className="h-2 rounded-full bg-red-500"
                        style={{ width: `${maxCategory > 0 ? Math.round((c.total / maxCategory) * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
                {(summary?.categories ?? []).length === 0 && <p className="text-sm text-gray-500">No cost data in this period.</p>}
              </div>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
              <h2 className="font-semibold">Spending by Admin</h2>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="py-2">Admin</th>
                      <th className="py-2 text-right">Txns</th>
                      <th className="py-2 text-right">Total</th>
                      <th className="py-2 text-right">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary?.adminSpending ?? []).map((a) => (
                      <tr key={a.paidBy} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="py-2">{a.paidBy}</td>
                        <td className="py-2 text-right">{a.transactions}</td>
                        <td className="py-2 text-right font-semibold">{formatBDT(a.total)}</td>
                        <td className="py-2 text-right">{a.percentage}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(summary?.adminSpending ?? []).length === 0 && <p className="text-sm text-gray-500">No spending data.</p>}
              </div>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200 lg:col-span-2 dark:bg-gray-900 dark:ring-gray-800">
              <h2 className="font-semibold">Monthly Summary — {monthly?.year}</h2>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="sticky top-0 bg-white dark:bg-gray-900">
                    <tr className="text-left text-xs text-gray-500">
                      <th className="py-2">Month</th>
                      <th className="py-2 text-right">Course Income</th>
                      <th className="py-2 text-right">Physical Costs</th>
                      <th className="py-2 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(monthly?.months ?? []).map((m) => (
                      <tr key={m.month} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="py-2">{m.month}</td>
                        <td className="py-2 text-right text-green-700 dark:text-green-400">{formatBDT(m.courseIncome)}</td>
                        <td className="py-2 text-right text-red-700 dark:text-red-400">{formatBDT(m.physicalCosts)}</td>
                        <td className="py-2 text-right font-semibold">{formatBDT(m.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === "income" && (
          <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Course Income <span className="text-xs font-normal text-gray-500">(read-only · automated from enrollments)</span></h2>
              <input
                value={incomeSearch}
                onChange={(e) => setIncomeSearch(e.target.value)}
                placeholder="Search course…"
                className="rounded-lg border px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
              />
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="sticky top-0 bg-white dark:bg-gray-900">
                  <tr className="text-left text-xs text-gray-500">
                    <th className="py-2">Date</th>
                    <th className="py-2">Course</th>
                    <th className="py-2 text-right">Orders</th>
                    <th className="py-2 text-right">Gross</th>
                    <th className="py-2 text-right">Refund</th>
                    <th className="py-2 text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIncome.map((r, i) => (
                    <tr key={`${r.date}-${r.courseId}-${i}`} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="py-2">{r.date}</td>
                      <td className="py-2">{r.courseName}</td>
                      <td className="py-2 text-right">{r.orders}</td>
                      <td className="py-2 text-right">{formatBDT(r.gross)}</td>
                      <td className="py-2 text-right text-red-600">{formatBDT(r.refund)}</td>
                      <td className="py-2 text-right font-semibold text-green-700 dark:text-green-400">{formatBDT(r.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredIncome.length === 0 && <p className="py-6 text-center text-sm text-gray-500">No course income in this period.</p>}
            </div>
            {income && (
              <p className="mt-3 text-sm font-semibold">
                Total: {income.totals.orders} orders · Gross {formatBDT(income.totals.gross)} · Refund {formatBDT(income.totals.refund)} · Net {formatBDT(income.totals.net)}
              </p>
            )}
          </div>
        )}

        {tab === "costs" && (
          <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Physical / Manual Costs</h2>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search item…"
                  className="rounded-lg border px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
                />
                <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800">
                  <option value="">All categories</option>
                  {FINANCE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {isAdmin && (
                  <>
                    <button onClick={() => void handleExport()} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800">Export CSV</button>
                    <button onClick={openAdd} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">+ Add Cost</button>
                  </>
                )}
              </div>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="sticky top-0 bg-white dark:bg-gray-900">
                  <tr className="text-left text-xs text-gray-500">
                    <th className="py-2">Date</th>
                    <th className="py-2">Category</th>
                    <th className="py-2">Item</th>
                    <th className="py-2 text-right">Amount</th>
                    <th className="py-2">Paid By</th>
                    <th className="py-2">Method</th>
                    <th className="py-2">Status</th>
                    {isAdmin && <th className="py-2 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredCosts.map((c, i) => (
                    <tr key={c.id ?? i} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="py-2">{c.costDate}</td>
                      <td className="py-2"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">{c.category}</span></td>
                      <td className="py-2">
                        <span className="font-medium">{c.itemName}</span>
                        {c.description && <span className="block max-w-[240px] truncate text-xs text-gray-500">{c.description}</span>}
                      </td>
                      <td className="py-2 text-right font-semibold">{formatBDT(c.amount)}</td>
                      <td className="py-2">{c.paidBy}</td>
                      <td className="py-2">{c.paymentMethod}</td>
                      <td className="py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${c.status === "paid" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : c.status === "pending" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}>
                          {c.status}
                        </span>
                      </td>
                      {isAdmin && (
                        <td className="py-2 text-right">
                          <button onClick={() => openEdit(c)} className="mr-2 text-blue-600 hover:underline">Edit</button>
                          <button onClick={() => void handleDelete(c)} className="text-red-600 hover:underline">Delete</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredCosts.length === 0 && <p className="py-6 text-center text-sm text-gray-500">No cost records found.</p>}
            </div>
          </div>
        )}

        {tab === "monthly" && (
          <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Monthly Financial Summary</h2>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="ml-auto rounded-lg border px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800">
                {[2024, 2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="py-2">Month</th>
                    <th className="py-2 text-right">Course Income</th>
                    <th className="py-2 text-right">Physical Costs</th>
                    <th className="py-2 text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {(monthly?.months ?? []).map((m) => (
                    <tr key={m.month} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="py-2">{m.month} {monthly?.year}</td>
                      <td className="py-2 text-right text-green-700 dark:text-green-400">{formatBDT(m.courseIncome)}</td>
                      <td className="py-2 text-right text-red-700 dark:text-red-400">{formatBDT(m.physicalCosts)}</td>
                      <td className="py-2 text-right font-semibold">{formatBDT(m.net)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 font-semibold dark:border-gray-700">
                    <td className="py-2">Total</td>
                    <td className="py-2 text-right">{formatBDT(monthly?.totals.courseIncome ?? 0)}</td>
                    <td className="py-2 text-right">{formatBDT(monthly?.totals.physicalCosts ?? 0)}</td>
                    <td className="py-2 text-right">{formatBDT(monthly?.totals.net ?? 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {tab === "audit" && isAdmin && (
          <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
            <h2 className="font-semibold">Audit Log — every manual cost change</h2>
            <div className="mt-2 space-y-2">
              {audit.map((a) => (
                <div key={a.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-gray-800">
                  <span className="font-semibold">{a.adminEmail || a.adminUid}</span>
                  {" · "}
                  <span className="rounded bg-gray-200 px-1 dark:bg-gray-700">{a.action}</span>
                  {a.recordId != null && <span> · record #{a.recordId}</span>}
                  {" · "}
                  <span className="text-gray-500">{new Date(a.createdAt).toLocaleString()}</span>
                  <details className="mt-1 text-gray-600 dark:text-gray-400">
                    <summary className="cursor-pointer">details</summary>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify({ old: a.oldValue, new: a.newValue }, null, 1)}</pre>
                  </details>
                </div>
              ))}
              {audit.length === 0 && <p className="text-sm text-gray-500">No audit entries yet.</p>}
            </div>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-gray-400">
          Transparency note: course income is read automatically from verified enrollments and cannot be edited. Last updated: {summary ? new Date(summary.lastUpdated).toLocaleString() : "…"}
        </p>
      </div>

      {/* Add/Edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setModalOpen(false)}>
          <div
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">{editing ? "Edit Physical Cost" : "Add Physical Cost"}</h3>
            {formError && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{formError}</p>}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-sm">Date *
                <input type="date" value={form.costDate} onChange={(e) => setForm({ ...form, costDate: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
              </label>
              <label className="text-sm">Category *
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
                  {FINANCE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="text-sm sm:col-span-2">Item / Purpose *
                <input value={form.itemName} onChange={(e) => setForm({ ...form, itemName: e.target.value })} placeholder="e.g. Sony Camera" className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
              </label>
              <label className="text-sm sm:col-span-2">Description
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Camera purchased for video production." rows={2} className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
              </label>
              <label className="text-sm">Amount (৳) *
                <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="85000" className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
              </label>
              <label className="text-sm">Paid By *
                <input value={form.paidBy} onChange={(e) => setForm({ ...form, paidBy: e.target.value })} placeholder="e.g. Siam" className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
              </label>
              <label className="text-sm">Payment Method
                <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="text-sm">Status
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="text-sm sm:col-span-2">Receipt URL (optional)
                <input value={form.receiptUrl} onChange={(e) => setForm({ ...form, receiptUrl: e.target.value })} placeholder="https://…" className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
              </label>
              <label className="text-sm sm:col-span-2">Private admin note (never public)
                <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Internal note…" className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="rounded-lg border px-4 py-2 text-sm dark:border-gray-700">Cancel</button>
              <button onClick={() => void handleSave()} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                {saving ? "Saving…" : editing ? "Save Changes" : "Add Cost"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-gray-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-white dark:text-gray-900">
          {toast}
        </div>
      )}
    </div>
  );
}
