import type { Metadata } from "next";
import AdminResultBoard from "@/components/admin/AdminResultBoard";

export const metadata: Metadata = {
  title: "Result Board",
  description: "MediSpark BD — exam results (administrators only).",
};

export default function ResultPage() {
  return (
    <main className="flex-1 bg-dark-950">
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <p className="text-xs font-bold uppercase tracking-widest text-primary-500">
          Admin · শুধু অ্যাডমিনদের জন্য
        </p>
        <h1 className="mt-1 text-2xl font-extrabold text-heading sm:text-3xl">
          Result Board
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-neutral-400">
          সব পরীক্ষার ফল — শুধু অ্যাডমিন প্যানেল থেকে দেখা যাবে।
        </p>
        <div className="mt-5">
          <AdminResultBoard />
        </div>
      </section>
    </main>
  );
}
