export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-g-bg">{children}</div>;
}
