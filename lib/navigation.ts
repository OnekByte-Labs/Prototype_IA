export type NavEntry = {
  label: string;
  icon: string;
  /** Omitted while the destination screen isn't built; the item renders inert, as in Stitch. */
  href?: string;
};

/** Single source of truth for the ISCC primary navigation. Add `href` when a screen is implemented. */
export const navItems: NavEntry[] = [
  { label: "Dashboard", icon: "dashboard", href: "/dashboard" },
  { label: "Alerts", icon: "notifications", href: "/alerts" },
  { label: "Map", icon: "map", href: "/map" },
  { label: "Devices", icon: "hub", href: "/devices" },
  { label: "Cameras", icon: "videocam" },
  { label: "Reports", icon: "description" },
  { label: "Admin", icon: "vpn_key", href: "/admin" },
];

/** A destination is active on its own route and on any nested route below it. */
export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
