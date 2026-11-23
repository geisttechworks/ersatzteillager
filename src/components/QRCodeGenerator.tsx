import { useState, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface QRCodeGeneratorProps {
  sparePartId: string;
  sparePartName: string;
}

export default function QRCodeGenerator({ sparePartId, sparePartName }: QRCodeGeneratorProps) {
  const [showModal, setShowModal] = useState(false);
  const qrContainerRef = useRef<HTMLDivElement>(null);

  const handleDownload = () => {
    const svg = qrContainerRef.current?.querySelector('svg');
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 200;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const link = document.createElement('a');
        link.download = `qr-${sparePartId}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="bg-purple-600 hover:bg-purple-700 text-white text-sm py-2 px-3 rounded transition-colors"
        title="QR-Code anzeigen"
      >
        📱 QR
      </button>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-lg p-6 max-w-sm w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-slate-100">
                QR-Code für {sparePartName}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-500 hover:text-slate-300 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="flex flex-col items-center space-y-4">
              <div ref={qrContainerRef} className="bg-white p-4 rounded-lg border border-slate-700">
                <QRCodeSVG
                  value={sparePartId}
                  size={200}
                  level="H"
                  includeMargin={true}
                />
              </div>

              <div className="text-center">
                <p className="text-sm text-slate-400 mb-1">ID: {sparePartId}</p>
                <p className="text-xs text-slate-500">QR-Code = ID</p>
              </div>

              <button
                onClick={handleDownload}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                📥 Download
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
