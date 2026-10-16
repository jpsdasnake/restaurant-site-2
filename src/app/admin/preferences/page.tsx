import type { Metadata } from "next";
import AdminPreferences from "./AdminPreferences";

export const metadata: Metadata = {
  title: "Set up the week",
  robots: { index: false, follow: false },
};

export default function AdminPreferencesPage() {
  return <AdminPreferences />;
}
