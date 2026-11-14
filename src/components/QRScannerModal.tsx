import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, Upload, X, CheckCircle2, AlertTriangle } from 'lucide-react';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDecoded: (decodedPayload: string) => void;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  isOpen,
  onClose,
  onDecoded,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Upload a QR code PNG/image file (such as an exported pack label) or start your webcam scanner.'
  );
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [decodedPreview, setDecodedPreview] = useState<string>('');

  const stopCamera = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setErrorMessage('');
      setDecodedPreview('');
    }
    return () => stopCamera();
  }, [isOpen]);

  if (!isOpen) return null;

  const scanVideoFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (code && code.data) {
          setDecodedPreview(code.data);
          setStatusMessage('QR Code decoded via live camera stream.');
          stopCamera();
          onDecoded(code.data);
          onClose();
          return;
        }
      }
    }
    rafRef.current = requestAnimationFrame(scanVideoFrame);
  };

  const handleStartCamera = async () => {
    setErrorMessage('');
    setDecodedPreview('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorMessage(
        'Camera API is unavailable in this browser context. Use QR image upload below.'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      setStatusMessage('Point a MedSupply Sentinel ISO-18004 QR code at the camera...');
      rafRef.current = requestAnimationFrame(scanVideoFrame);
    } catch {
      setErrorMessage(
        'Camera access denied or no webcam detected. Upload a downloaded QR PNG/JPG file instead.'
      );
      stopCamera();
    }
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage('');
    setDecodedPreview('');

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current || document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setErrorMessage('Unable to initialize canvas decoder.');
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (decoded && decoded.data) {
          setDecodedPreview(decoded.data);
          setStatusMessage('Decoded ISO-18004 QR matrix from uploaded image.');
          onDecoded(decoded.data);
          onClose();
        } else {
          setErrorMessage(
            'No valid ISO-18004 QR code detected in this image. Ensure quiet zone margins are intact.'
          );
        }
      };
      img.onerror = () => {
        setErrorMessage('Could not load selected image file for QR decoding.');
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-scanner-modal-title"
    >
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-xl p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-emerald-400" />
            <h2 id="qr-scanner-modal-title" className="text-base font-bold text-slate-100">
              Live ISO-18004 QR Camera & Image Decoder
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            aria-label="Close QR scanner"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">{statusMessage}</p>

        {/* Webcam Stream Preview */}
        <div className="relative bg-slate-950 border border-slate-800 rounded-lg overflow-hidden aspect-video flex items-center justify-center">
          <video
            ref={videoRef}
            muted
            playsInline
            className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
          />
          {!cameraActive && (
            <div className="text-center p-6 space-y-3">
              <Camera className="w-8 h-8 text-slate-500 mx-auto" />
              <div className="text-xs text-slate-400">
                Real-time <code className="text-emerald-300 font-mono">jsQR</code> Reed-Solomon
                scanner ready
              </div>
              <button
                type="button"
                onClick={handleStartCamera}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-semibold rounded-lg transition-colors"
              >
                Start Webcam Scanner
              </button>
            </div>
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />

        {/* Upload QR Image File */}
        <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
          <label
            htmlFor="qr-image-upload"
            className="block text-xs font-semibold text-slate-200"
          >
            Decode Exported Pack QR Image (PNG / JPG / SVG)
          </label>
          <div className="flex items-center gap-3">
            <label
              htmlFor="qr-image-upload"
              className="cursor-pointer inline-flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
            >
              <Upload className="w-3.5 h-3.5 text-emerald-400" />
              Choose QR Image File
            </label>
            <input
              id="qr-image-upload"
              type="file"
              accept="image/*"
              onChange={handleImageFileChange}
              className="sr-only"
            />
            <span className="text-[11px] text-slate-400">
              Supports GS1 Digital Link, JSON, and Colon QR matrices
            </span>
          </div>
        </div>

        {decodedPreview && (
          <div className="p-3 bg-emerald-950/30 border border-emerald-700/60 rounded-lg flex items-center gap-2 text-xs text-emerald-300 font-mono">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="truncate">{decodedPreview}</span>
          </div>
        )}

        {errorMessage && (
          <div className="p-3 bg-rose-950/30 border border-rose-700/60 rounded-lg flex items-center gap-2 text-xs text-rose-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
};
