import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
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

export const metadata: Metadata = {
  title: "ISCC // COMMAND WATCHFLOOR",
  description: "Integrated Surveillance Command Center",
};

// Material Symbols Outlined, limited to the icons used in the UI (icon_names must stay alphabetical).
// Add new icon names here when a screen needs them.
const MATERIAL_SYMBOLS_URL =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&icon_names=account_circle,add,admin_panel_settings,arrow_downward,arrow_drop_down,arrow_upward,badge,bolt,calendar_today,check,check_circle,chevron_right,close,cloud_sync,crisis_alert,dashboard,description,desktop_windows,directions_car,dns,domain,download,engineering,error,expand_less,expand_more,filter_center_focus,fullscreen,fullscreen_exit,gavel,grid_on,group,help,hub,keyboard,layers,lock,logout,map,memory,military_tech,nightlight,notifications,notifications_active,person,person_add,policy,power_settings_new,refresh,report,router,schedule,search,security,sensors,settings,shield,storm,sync,terminal,timelapse,timer,tune,verified,verified_user,videocam,videocam_off,view_list,visibility,volume_off,volume_up,vpn_key,warning,wifi_off&display=block";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable} dark h-full`}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link rel="stylesheet" href={MATERIAL_SYMBOLS_URL} />
      </head>
      <body className="h-full overflow-hidden bg-g-bg text-g-text antialiased select-none">
        {children}
      </body>
    </html>
  );
}
