import { exportColorVar, type ExportStatusInfo } from '../lib/exportStatus';

interface ExportStatusProps {
  info: ExportStatusInfo;
  onExport: () => void;
  busy?: boolean;
}

export function ExportStatus({ info, onExport, busy = false }: ExportStatusProps) {
  return (
    <button
      type="button"
      class="export-status"
      data-severity={info.severity}
      style={{ color: `var(${exportColorVar(info.severity)})` }}
      onClick={onExport}
      disabled={busy}
    >
      {busy ? 'EXPORTING…' : info.label}
    </button>
  );
}
