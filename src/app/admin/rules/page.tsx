import type { Metadata } from "next";
import RulesManager from "@/components/admin/RulesManager";

export const metadata: Metadata = {
  title: "Readme — MediSpark Admin",
  description: "শুধু অ্যাডমিনদের জন্য ভেতরের নিয়ম।",
  robots: { index: false, follow: false },
};

export default function AdminRulesPage() {
  return <RulesManager />;
}
