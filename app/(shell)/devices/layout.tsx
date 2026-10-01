export default function DevicesLayout({ children }: LayoutProps<"/devices">) {
  return <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-g-bg">{children}</div>;
}
