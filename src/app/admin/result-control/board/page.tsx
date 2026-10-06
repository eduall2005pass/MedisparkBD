import AdminResultBoard from "@/components/admin/AdminResultBoard";

export const dynamic = "force-dynamic";

export default function AdminResultBoardPage() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-2xl font-extrabold text-[#0b1e3a] admin-dark:text-white">
        Result Board
      </h1>
      <p className="mt-1 text-sm text-slate-500 admin-dark:text-slate-400">
        All exam results — leaderboard, marks, accuracy. Admin only.
      </p>
      <div className="mt-5">
        <AdminResultBoard />
      </div>
    </section>
  );
}
