import { Sidebar } from "@/components/app/sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="hydro-canvas relative min-h-screen flex">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  );
}
