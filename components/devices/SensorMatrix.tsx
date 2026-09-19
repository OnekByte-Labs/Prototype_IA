import { Icon } from "@/components/ui/Icon";
import { matrix, useDeviceCameras, type CameraRow, type Tone } from "@/lib/devices-data";

const dot: Record<Tone, string> = { ok: "bg-secondary", warn: "bg-tertiary", err: "bg-error" };
const text: Record<Tone, string> = { ok: "text-secondary", warn: "text-tertiary", err: "text-error" };

// Stitch (Tailwind v3) lets `divide-*` recolour these rows' 2px left border to the neutral divider tone.
const rowStyle: Record<Tone, string> = {
  ok: "hover:bg-surface-container-high/60 transition-colors",
  warn: "bg-tertiary-container/10 border-l-2 border-surface-container-high hover:bg-tertiary-container/20 transition-colors",
  err: "bg-error-container/15 border-l-2 border-surface-container-high hover:bg-error-container/25 transition-colors",
};

const idStyle: Record<Tone, string> = {
  ok: "text-primary font-semibold",
  warn: "text-tertiary font-bold",
  err: "text-error font-bold",
};

const recordingStyle: Record<Tone, string> = {
  ok: "text-secondary",
  warn: "text-tertiary font-semibold",
  err: "text-error font-semibold",
};

const uptimeStyle: Record<Tone, string> = {
  ok: "text-secondary",
  warn: "text-tertiary",
  err: "text-error font-semibold",
};

const faultStyle: Record<Tone, string> = {
  ok: "text-outline",
  warn: "text-tertiary",
  err: "text-error font-medium",
};

const actionStyle = {
  default:
    "px-1.5 py-0.5 bg-surface-container-lowest border border-outline-variant hover:border-primary text-outline hover:text-primary text-[10px] font-code-sm rounded-[2px]",
  warn: "px-1.5 py-0.5 bg-surface-container-lowest border border-tertiary text-tertiary hover:bg-tertiary/20 text-[10px] font-code-sm rounded-[2px]",
  err: "px-1.5 py-0.5 bg-error/20 border border-error text-error hover:bg-error/30 text-[10px] font-code-sm rounded-[2px] font-bold",
} as const;

const tagStyle = {
  warn: "px-1 bg-tertiary/20 text-tertiary text-[9px] font-code-sm rounded-[2px] font-bold",
  err: "px-1 bg-error-container text-error text-[9px] font-code-sm rounded-[2px] font-bold border border-error/50",
} as const;

function CameraTableRow({ cam }: { cam: CameraRow }) {
  const fw = cam.firmware;
  return (
    <tr className={rowStyle[cam.state]}>
      <td className={`py-1.5 px-2.5 font-code-sm ${idStyle[cam.state]}`}>{cam.id}</td>
      <td
        className={`py-1.5 px-2.5 text-on-surface font-medium${cam.tag ? " flex items-center gap-1.5" : ""}`}
      >
        {cam.tag ? (
          <>
            <span>{cam.name}</span>
            <span
              className={`${cam.state === "warn" ? tagStyle.warn : tagStyle.err}${cam.tag.pulse ? " animate-pulse" : ""}`}
            >
              {cam.tag.label}
            </span>
          </>
        ) : (
          cam.name
        )}
      </td>
      <td className="py-1.5 px-2 text-outline">{cam.zone}</td>
      <td
        className={`py-1.5 px-2 font-code-sm ${cam.state === "err" ? "text-error/80" : "text-on-surface-variant"}`}
      >
        {cam.ip}
      </td>
      <td className="py-1.5 px-2 text-outline text-[11px]">{cam.model}</td>
      <td
        className={`py-1.5 px-2 font-code-sm text-[11px] ${fw.note ? "text-on-surface-variant" : text[fw.tone]}`}
      >
        {fw.text}
        {fw.note && (
          <>
            {" "}
            <span className="text-secondary">{fw.note}</span>
          </>
        )}
      </td>
      <td className="py-1.5 px-2 whitespace-nowrap">
        <span className={`inline-flex items-center gap-1.5 ${text[cam.stream.tone]} text-[11px] font-code-sm`}>
          <span className={`w-1.5 h-1.5 rounded-full ${dot[cam.stream.tone]}`} />
          {cam.stream.label}
        </span>
      </td>
      <td className={`py-1.5 px-2${cam.recording.tone === "ok" ? "" : " whitespace-nowrap"}`}>
        <span className={`${recordingStyle[cam.recording.tone]} text-[11px] font-code-sm`}>
          {cam.recording.label}
        </span>
      </td>
      <td className="py-1.5 px-2">
        {cam.storage.pct !== undefined ? (
          <div className="flex items-center gap-1.5">
            <div className="w-10 bg-surface-container-lowest h-1.5 rounded-[2px] overflow-hidden">
              <div className={`${dot[cam.storage.tone]} h-full`} style={{ width: `${cam.storage.pct}%` }} />
            </div>
            <span
              className={`font-code-sm text-[10px] ${cam.storage.tone === "warn" ? "text-tertiary font-bold" : "text-outline"}`}
            >
              {cam.storage.label}
            </span>
          </div>
        ) : (
          <span className="font-code-sm text-[10px] text-outline">{cam.storage.label}</span>
        )}
      </td>
      <td
        className={`py-1.5 px-2 text-right font-code-sm ${uptimeStyle[cam.uptime.tone]}${cam.uptime.strong ? " font-semibold" : ""}`}
      >
        {cam.uptime.label}
      </td>
      <td
        className={`py-1.5 px-2.5 font-code-sm text-[11px] ${faultStyle[cam.fault.tone]} truncate max-w-[160px]`}
      >
        {cam.fault.label}
      </td>
      <td className="py-1.5 px-2 text-center whitespace-nowrap">
        {cam.actions.map(({ label, tone }, i) => (
          <span key={label} className="contents">
            {i > 0 && " "}
            <button type="button" className={actionStyle[tone]}>
              {label}
            </button>
          </span>
        ))}
      </td>
    </tr>
  );
}

const th = "py-2 px-2 font-medium tracking-wider";

/** Tactical edge sensor matrix: density bar plus the full diagnostic table. */
export function SensorMatrix() {
  const { cameras, isLoading } = useDeviceCameras();
  return (
    <div className="bg-surface-container border border-outline-variant rounded-[2px] flex flex-col overflow-hidden">
      <div className="h-8 px-3 bg-surface-container-low border-b border-outline-variant flex items-center justify-between text-label-sm">
        <div className="flex items-center gap-3">
          <span className="text-on-surface font-semibold flex items-center gap-1">
            <Icon name="view_list" size={14} className="text-primary align-middle" />
            {matrix.title}
          </span>
          <span className="text-outline text-code-sm font-code-sm">{matrix.showing}</span>
        </div>
        <div className="flex items-center gap-2 text-outline">
          {matrix.legend.map(({ label, tone }) => (
            <span key={label} className="flex items-center gap-1 text-code-sm font-code-sm">
              <span className={`w-2 h-2 rounded-full ${dot[tone]}`} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto custom-scroll">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-container-lowest border-b border-outline-variant text-label-sm uppercase text-outline">
              <th className="py-2 px-2.5 font-medium tracking-wider">ID</th>
              <th className="py-2 px-2.5 font-medium tracking-wider min-w-[150px]">NAME &amp; DESCRIPTION</th>
              <th className={th}>ZONE</th>
              <th className={`${th} font-code-sm`}>IP ADDRESS</th>
              <th className={`${th} min-w-[120px]`}>MODEL</th>
              <th className={`${th} min-w-[110px]`}>FIRMWARE</th>
              <th className={`${th} min-w-[115px]`}>STREAM STATUS</th>
              <th className={`${th} min-w-[130px]`}>RECORDING</th>
              <th className={`${th} w-24`}>STORAGE</th>
              <th className={`${th} text-right font-code-sm`}>UPTIME 30D</th>
              <th className="py-2 px-2.5 font-medium tracking-wider min-w-[160px]">LAST FAULT / LOG</th>
              <th className={`${th} text-center`}>ACTION</th>
            </tr>
          </thead>
          <tbody className="text-body-sm divide-y divide-surface-container-high">
            {isLoading ? (
              <tr><td colSpan={12} className="text-center py-4 text-outline">Loading...</td></tr>
            ) : cameras.length === 0 ? (
              <tr><td colSpan={12} className="text-center py-4 text-outline">No cameras found.</td></tr>
            ) : cameras.map((cam) => (
              <CameraTableRow key={cam.id} cam={cam} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
