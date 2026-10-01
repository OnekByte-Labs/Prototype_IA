import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Data font: timestamps, incident IDs, IPs, counts. Never used for prose.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// Data font of the dashboard's glass theme (Stitch: JetBrains Mono).
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "ARGUS Command Centre",
  description: "ARGUS — surveillance command centre",
};

// Material Symbols Outlined, limited to the icons used in the UI (icon_names must stay alphabetical).
// Add new icon names here when a screen needs them.
const MATERIAL_SYMBOLS_URL =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&icon_names=add,admin_panel_settings,arrow_downward,arrow_upward,bar_chart,build,check,check_circle,chevron_right,close,code,content_copy,crisis_alert,dashboard,database,delete,description,dns,edit_location_alt,error,expand_less,expand_more,forum,fullscreen,fullscreen_exit,grid_on,grid_view,hub,keyboard,layers,location_on,lock,logout,map,my_location,notifications,notifications_active,open_in_new,power_settings_new,push_pin,refresh,remove,router,search,send,settings,shield,stop,sync,undo,unfold_more,videocam,videocam_off,volume_off,volume_up,vpn_key,warning&display=block";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable} ${jetbrainsMono.variable} h-full`}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link rel="stylesheet" href={MATERIAL_SYMBOLS_URL} />
      </head>
      <body className="h-full overflow-hidden bg-canvas text-ink antialiased select-none">
        {children}
      </body>
    </html>
  );
}
