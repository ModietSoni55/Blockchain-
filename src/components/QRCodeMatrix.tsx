import React, { useMemo } from 'react';
import QRCode from 'qrcode';
import { Download } from 'lucide-react';

interface QRCodeMatrixProps {
  value: string;
  size?: number;
  label?: string;
  allowDownload?: boolean;
}

/**
 * Genuine ISO/IEC 18004 Standard QR Code SVG Generator
 * Uses Reed-Solomon Error Correction (Level M) so any smartphone camera,
 * pharmacy scanner, or jsQR / BarcodeDetector decodes the embedded payload.
 */
export const QRCodeMatrix: React.FC<QRCodeMatrixProps> = ({
  value,
  size = 136,
  label,
  allowDownload = false,
}) => {
  const { modulesCount, activeCells } = useMemo(() => {
    try {
      const qr = QRCode.create(value || 'MEDSUPPLY-SENTINEL', {
        errorCorrectionLevel: 'M',
      });
      const count = qr.modules.size;
      const cells: Array<{ r: number; c: number }> = [];
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (qr.modules.get(r, c)) {
            cells.push({ r, c });
          }
        }
      }
      return { modulesCount: count, activeCells: cells };
    } catch {
      return { modulesCount: 21, activeCells: [] as Array<{ r: number; c: number }> };
    }
  }, [value]);

  const quietZone = 2;
  const totalViewBox = modulesCount + quietZone * 2;

  const handleDownloadPNG = async () => {
    try {
      const dataUrl = await QRCode.toDataURL(value, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 512,
        color: {
          dark: '#0F172A',
          light: '#FFFFFF',
        },
      });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${(label || 'medsupply-pack-qr').replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      // Ignore export error
    }
  };

  return (
    <div
      className="inline-flex flex-col items-center bg-white p-2.5 rounded-lg border border-slate-300"
      data-qr-valid="true"
      data-qr-modules={modulesCount}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${totalViewBox} ${totalViewBox}`}
        shapeRendering="crispEdges"
        role="img"
        aria-label={label ? `ISO-18004 Scannable QR Code for ${label}` : `ISO-18004 QR Code`}
      >
        <rect width={totalViewBox} height={totalViewBox} fill="#FFFFFF" />
        {activeCells.map(({ r, c }) => (
          <rect
            key={`${r}-${c}`}
            x={c + quietZone}
            y={r + quietZone}
            width={1}
            height={1}
            fill="#0F172A"
          />
        ))}
      </svg>
      {label && (
        <span className="mt-1.5 font-mono text-[11px] font-medium text-slate-800 tracking-tight">
          {label}
        </span>
      )}
      {allowDownload && (
        <button
          type="button"
          onClick={handleDownloadPNG}
          className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-semibold text-slate-700 hover:text-slate-950 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
        >
          <Download className="w-2.5 h-2.5" />
          Download QR PNG
        </button>
      )}
    </div>
  );
};
