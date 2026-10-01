import type { Metadata } from "next";
import ResultBoard from "@/components/ResultBoard";

export const metadata: Metadata = {
  title: "Result Board",
  description:
    "MediSpark BD — সব পরীক্ষার ফল এক জায়গায়। Student ID দিয়ে খুঁজুন, লিডারবোর্ড দেখুন, Excel ডাউনলোড করুন।",
};

export const revalidate = 300;

export default function ResultPage() {
  return (
    <main className="flex-1 bg-dark-950">
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <p className="text-xs font-bold uppercase tracking-widest text-primary-500">
          Public · সবার জন্য খোলা
        </p>
        <h1 className="mt-1 text-2xl font-extrabold text-heading sm:text-3xl">
          Result Board
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-neutral-400">
          সব পরীক্ষার ফল — লিডারবোর্ড, নম্বর, সঠিক/ভুল, একিউরেসি, সময়।
          Student ID দিয়ে সহজে খুঁজুন। ইমেইল-ফোন দেখানো হয় না।
        </p>
        <div className="mt-5">
          <ResultBoard />
        </div>
      </section>
    </main>
  );
}
