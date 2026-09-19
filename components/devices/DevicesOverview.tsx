import { Icon } from "@/components/ui/Icon";
import { kpis as staticKpis, tabs, useDeviceCameras } from "@/lib/devices-data";

/** Sub-tab ribbon (cameras / NVRs / terminals) with search, zone filter and bulk actions. */
export function DevicesToolbar() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-container-low border border-outline-variant px-3 py-1.5 rounded-[2px]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-current="page"
          className="flex items-center gap-2 px-3 py-1.5 rounded-t-[2px] border-b-2 border-primary bg-surface-container text-primary text-headline-sm font-semibold"
        >
          <Icon name="videocam" className="align-middle" />
          <span>{tabs.cameras.label}</span>
          <span className="px-1.5 bg-primary/20 text-primary text-[10px] font-code-sm rounded-[2px]">
            {tabs.cameras.badge}
          </span>
        </button>
        <button
          type="button"
          className="flex items-center gap-2 px-3 py-1.5 rounded-t-[2px] border-b-2 border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors text-headline-sm"
        >
          <Icon name="dns" className="align-middle" />
          <span>{tabs.nvrs.label}</span>
          <span className="flex items-center gap-1 px-1.5 py-0.5 bg-tertiary/20 text-tertiary border border-tertiary/30 text-[9px] font-code-sm rounded-[2px] font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-ping" />
            {tabs.nvrs.badge}
          </span>
        </button>
        <button
          type="button"
          className="flex items-center gap-2 px-3 py-1.5 rounded-t-[2px] border-b-2 border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors text-headline-sm"
        >
          <Icon name="terminal" className="align-middle" />
          <span>{tabs.terminals.label}</span>
          <span className="flex items-center gap-1 px-1.5 py-0.5 bg-secondary/15 text-secondary border border-secondary/30 text-[9px] font-code-sm rounded-[2px]">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
            {tabs.terminals.badge}
          </span>
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex items-center">
          <Icon name="search" className="absolute left-2 text-outline align-middle" />
          <input
            type="text"
            aria-label="Filter devices"
            placeholder={tabs.searchPlaceholder}
            className="h-8 pl-7 pr-2 w-64 bg-surface-container-lowest border border-outline-variant rounded-[2px] text-body-sm text-on-surface placeholder:text-outline focus:border-primary focus:ring-0 focus:outline-none font-code-sm"
          />
        </div>
        <div className="relative">
          <select
            aria-label="Zone"
            className="alerts-select h-8 pl-2 pr-6 bg-surface-container-lowest border border-outline-variant rounded-[2px] text-label-sm text-on-surface focus:border-primary focus:ring-0 focus:outline-none cursor-pointer"
          >
            {tabs.zones.map((zone) => (
              <option key={zone}>{zone}</option>
            ))}
          </select>
          <Icon
            name="arrow_drop_down"
            size={14}
            className="absolute right-1.5 top-2 text-outline pointer-events-none align-middle"
          />
        </div>
        <button
          type="button"
          className="h-8 px-2.5 bg-surface-container border border-outline-variant hover:border-outline text-on-surface text-label-sm rounded-[2px] flex items-center gap-1 transition-colors"
        >
          <Icon name="sync" size={14} className="align-middle" />
          <span>{tabs.repoll}</span>
        </button>
        <button
          type="button"
          className="h-8 px-2.5 bg-surface-container border border-outline-variant hover:border-outline text-on-surface text-label-sm rounded-[2px] flex items-center gap-1 transition-colors"
        >
          <Icon name="download" size={14} className="align-middle" />
          <span>{tabs.export}</span>
        </button>
      </div>
    </div>
  );
}

const card =
  "bg-surface-container border border-outline-variant rounded-[2px] p-2.5 flex items-center justify-between";

/** Four compact KPI telemetry cards. */
export function KpiCards() {
  const { cameras, isLoading } = useDeviceCameras();
  
  const totalCams = cameras.length;
  const onlineCams = cameras.filter(c => c.state === 'ok').length;
  const offlineCams = cameras.filter(c => c.state === 'err').length;
  const offlineNames = cameras.filter(c => c.state === 'err').map(c => c.name).join(', ');
  const degradedCams = cameras.filter(c => c.state === 'warn').length;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5">
      <div className={card}>
        <div>
          <div className="text-label-sm text-outline uppercase tracking-wider">{staticKpis.total.label}</div>
          <div className="text-2xl font-bold font-code-sm text-on-surface mt-0.5">{isLoading ? '-' : totalCams}</div>
          <div className="text-[11px] text-outline mt-0.5">{staticKpis.total.note}</div>
        </div>
        <div className="w-10 h-10 rounded-[2px] bg-surface-container-high border border-outline-variant flex items-center justify-center text-primary">
          <Icon name="videocam" size={24} className="align-middle" />
        </div>
      </div>

      <div className={card}>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-secondary" />
            <span className="text-label-sm text-secondary font-bold uppercase tracking-wider">{staticKpis.online.label}</span>
          </div>
          <div className="text-2xl font-bold font-code-sm text-secondary mt-0.5">
            {isLoading ? '-' : onlineCams} <span className="text-xs font-normal text-outline">/ {totalCams}</span>
          </div>
          <div className="text-[11px] font-code-sm text-secondary">{staticKpis.online.note}</div>
        </div>
        <div className="w-10 h-10 rounded-[2px] bg-secondary-container/20 border border-secondary/30 flex items-center justify-center text-secondary">
          <Icon name="check_circle" size={24} className="align-middle" />
        </div>
      </div>

      <div className={`${card} border-l-4 border-l-error`}>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-error animate-ping" />
            <span className="text-label-sm text-error font-bold uppercase tracking-wider">{staticKpis.offline.label}</span>
          </div>
          <div className="text-2xl font-bold font-code-sm text-error mt-0.5">{isLoading ? '-' : offlineCams}</div>
          <div className="text-[10px] font-code-sm text-error/90 truncate max-w-[200px]" title={offlineNames}>
            {offlineNames || "None"}
          </div>
        </div>
        <div className="w-10 h-10 rounded-[2px] bg-error-container/30 border border-error/40 flex items-center justify-center text-error">
          <Icon name="error" size={24} className="align-middle" />
        </div>
      </div>

      <div className={`${card} border-l-4 border-l-tertiary`}>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-tertiary" />
            <span className="text-label-sm text-tertiary font-bold uppercase tracking-wider">{staticKpis.degraded.label}</span>
          </div>
          <div className="text-2xl font-bold font-code-sm text-tertiary mt-0.5">{isLoading ? '-' : degradedCams}</div>
          <div className="text-[10px] font-code-sm text-tertiary/90">{staticKpis.degraded.note}</div>
        </div>
        <div className="w-10 h-10 rounded-[2px] bg-tertiary-container/20 border border-tertiary/30 flex items-center justify-center text-tertiary">
          <Icon name="warning" size={24} className="align-middle" />
        </div>
      </div>
    </div>
  );
}
