import type { Metadata } from "next";
import { AdminConsole } from "@/components/gotham/admin/AdminConsole";

export const metadata: Metadata = {
  title: "ISCC MATRIX // SYS-ADMIN & SECURITY ACCESS",
};

/** Unified Gotham tactical administrative console */
export default function AdminPage() {
  return (
    <main className="flex-1 flex overflow-hidden bg-g-bg">
      <AdminConsole />
    </main>
  );
}
