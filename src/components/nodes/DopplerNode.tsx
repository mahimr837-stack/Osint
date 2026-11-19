import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { type NodeProps } from 'reactflow';
import { Activity, Download, Loader2, Upload } from 'lucide-react';
import type { DopplerNodeData } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import {
  buildDopplerCsv,
  computeDopplerSpectrogram,
  DOPPLER_GUIDANCE_NOTE,
  DOPPLER_MAX_FREQUENCY_HZ,
  extractPeakFrequencySeries,
  isAcceptedDopplerFile,
  mixChannelsToMono,
  type DopplerSpectrogramData,
} from '../../utils/dopplerAudio';

function mapSpectrogramHeatColor(normalized: number): [number, number, number] {
  // Deep slate -> indigo -> coral red -> bright gold peak
  const t = Math.max(0, Math.min(1, normalized));
  if (t < 0.35) {
    const k = t / 0.35;
    return [
      Math.round(15 + k * 45),
      Math.round(23 + k * 20),
      Math.round(42 + k * 85),
    ];
  }
  if (t < 0.72) {
    const k = (t - 0.35) / 0.37;
    return [
      Math.round(60 + k * 195),
      Math.round(43 + k * 34),
      Math.round(127 - k * 50),
    ];
  }
  const k = (t - 0.72) / 0.28;
  return [
    255,
    Math.round(77 + k * 165),
    Math.round(77 + k * 45),
  ];
}

function drawSpectrogramToCanvas(
  canvas: HTMLCanvasElement,
  spectrogram: DopplerSpectrogramData,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);

  const cols = spectrogram.columns;
  if (cols.length === 0) return;

  const colWidth = width / cols.length;
  const maxBins = spectrogram.freqBinCount;
  const binHeight = height / maxBins;
  const logScaleDenom = Math.log1p(spectrogram.maxMagnitude * 18);

  for (let c = 0; c < cols.length; c += 1) {
    const col = cols[c];
    const x = Math.floor(c * colWidth);
    const w = Math.max(1, Math.ceil((c + 1) * colWidth) - x);

    for (let b = 0; b < maxBins; b += 1) {
      const mag = col.bins[b] ?? 0;
      const norm =
        logScaleDenom > 0 ? Math.log1p(mag * 18) / logScaleDenom : 0;
      const [r, g, bl] = mapSpectrogramHeatColor(norm);
      ctx.fillStyle = `rgb(${r}, ${g}, ${bl})`;
      // 0 Hz at bottom, 1000 Hz at top
      const yBottom = height - (b * binHeight);
      const yTop = height - ((b + 1) * binHeight);
      const h = Math.max(1, Math.ceil(yBottom - yTop));
      ctx.fillRect(x, Math.floor(yTop), w, h);
    }
  }

  // Highlight 50-600 Hz airplane Doppler band boundaries subtly
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  for (const hz of [50, 500, 600]) {
    const y = height - (hz / spectrogram.maxFreqHz) * height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

export function DopplerNode({
  id,
  data,
  selected,
}: NodeProps<DopplerNodeData>) {
  const updateDopplerNodeData = useCanvasStore(
    (state) => state.updateDopplerNodeData,
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isDecoding, setIsDecoding] = useState(false);
  const [spectrogram, setSpectrogram] =
    useState<DopplerSpectrogramData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!spectrogram || !canvasRef.current) return;
    drawSpectrogramToCanvas(canvasRef.current, spectrogram);
  }, [spectrogram]);

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!isAcceptedDopplerFile({ name: file.name, type: file.type })) {
      setError('Unsupported format. Upload an .mp4, .wav, or .mp3 recording.');
      return;
    }

    setError(null);
    setExportStatus(null);
    setIsDecoding(true);

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioCtx) {
      setIsDecoding(false);
      setError('Web Audio API AudioContext is unavailable in this browser.');
      return;
    }

    const audioCtx = new AudioCtx();
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      const channels: Float32Array[] = [];
      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch += 1) {
        channels.push(audioBuffer.getChannelData(ch));
      }
      const monoSamples = mixChannelsToMono(channels);

      const computed = computeDopplerSpectrogram({
        samples: monoSamples,
        sampleRate: audioBuffer.sampleRate,
        maxFreqHz: DOPPLER_MAX_FREQUENCY_HZ,
      });
      const peakSeries = extractPeakFrequencySeries(computed);

      setSpectrogram(computed);
      updateDopplerNodeData(id, {
        fileName: file.name,
        durationSec: Number(computed.durationSec.toFixed(2)),
        sampleRate: computed.sampleRate,
        peakPointCount: peakSeries.length,
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to decode audio stream from file.';
      setError(`Audio decode failed: ${msg}`);
    } finally {
      setIsDecoding(false);
      await audioCtx.close().catch(() => undefined);
    }
  };

  const handleExportFrequencies = () => {
    if (!spectrogram) return;
    const series = extractPeakFrequencySeries(spectrogram);
    const csv = buildDopplerCsv({
      utcStartTime: data.utcStartTime,
      fileName: data.fileName ?? null,
      series,
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `doppler_${(data.fileName || id).replace(/[^a-zA-Z0-9._-]/g, '_')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    setExportStatus(`Exported ${series.length} peak points (UTC header included).`);
  };

  return (
    <div
      data-testid={`doppler-node-${id}`}
      data-has-spectrogram={spectrogram ? 'true' : 'false'}
      data-peak-count={String(data.peakPointCount ?? 0)}
      className={`relative w-96 rounded-xl border bg-white transition-shadow duration-150 ${
        selected
          ? 'border-neutral-900 shadow-md'
          : 'border-neutral-200/90 shadow-sm'
      }`}
    >
      {/* Header */}
      <div className="border-b border-neutral-100 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Activity className="h-4 w-4 shrink-0 text-[#ff4d4d]" />
            <h3 className="truncate text-sm font-semibold text-neutral-900">
              {data.title}
            </h3>
          </div>
          {typeof data.durationSec === 'number' && !isDecoding && (
            <span className="font-mono-tabular shrink-0 text-[11px] font-medium text-neutral-500">
              {data.durationSec.toFixed(1)}s ·{' '}
              {data.sampleRate ? `${(data.sampleRate / 1000).toFixed(1)}kHz` : ''}
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-xs text-neutral-500">
          {data.fileName
            ? `Recording: ${data.fileName}`
            : 'Upload MP4, WAV, or MP3 acoustic flyover recording'}
        </p>
      </div>

      {/* Body */}
      <div className="space-y-3 p-3.5">
        {/* Audio / Video Upload + UTC Recording Time */}
        <div className="nodrag space-y-2.5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,.wav,.mp3,audio/wav,audio/mpeg,audio/mp3,video/mp4,audio/*,video/mp4"
            onChange={(e) => {
              void handleFileUpload(e);
            }}
            data-testid={`doppler-file-input-${id}`}
            className="hidden"
            aria-hidden="true"
          />

          <button
            type="button"
            disabled={isDecoding}
            onClick={() => fileInputRef.current?.click()}
            data-testid={`doppler-upload-btn-${id}`}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50/70 px-3 py-2 text-xs font-medium text-neutral-800 transition-colors hover:border-neutral-300 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            {isDecoding ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#ff4d4d]" />
                <span>Decoding PCM & Running FFT...</span>
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5 text-[#ff4d4d]" />
                <span>
                  {data.fileName ? 'Replace Audio / Video File' : 'Upload Audio / Video (.mp4, .wav, .mp3)'}
                </span>
              </>
            )}
          </button>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label
                htmlFor={`doppler-utc-${id}`}
                className="text-[11px] font-medium text-neutral-600"
              >
                Recording Start Date & Time (UTC)
              </label>
              <span className="font-mono-tabular text-[11px] text-neutral-400">
                ADS-B Sync
              </span>
            </div>
            <input
              id={`doppler-utc-${id}`}
              type="datetime-local"
              step="1"
              value={data.utcStartTime}
              onChange={(e) => {
                setExportStatus(null);
                updateDopplerNodeData(id, { utcStartTime: e.target.value });
              }}
              data-testid={`doppler-utc-input-${id}`}
              className="font-mono-tabular w-full rounded-lg border border-neutral-200 bg-neutral-50/70 px-2.5 py-1.5 text-xs text-neutral-900 focus:border-neutral-400 focus:bg-white focus:outline-none"
            />
          </div>
        </div>

        {/* Inline Error */}
        {error && (
          <div
            data-testid={`doppler-error-${id}`}
            className="rounded-lg border border-red-200 bg-red-50/50 px-3 py-2 text-xs text-red-700"
          >
            {error}
          </div>
        )}

        {/* Spectrogram Canvas (0-1000 Hz vs Time) */}
        {spectrogram ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-500">
              <span className="whitespace-nowrap">Spectrogram (0–1000 Hz)</span>
              <span className="font-mono-tabular whitespace-nowrap text-neutral-400">
                FFT {spectrogram.fftSize} · 50–600 Hz
              </span>
            </div>
            <div className="relative overflow-hidden rounded-lg border border-neutral-200 bg-slate-900">
              <canvas
                ref={canvasRef}
                width={336}
                height={156}
                data-testid={`doppler-spectrogram-canvas-${id}`}
                aria-label="Acoustic Doppler spectrogram from 0 to 1000 Hz over time"
                className="block h-[156px] w-full"
              />
              {/* Axis overlays */}
              <div className="pointer-events-none absolute inset-y-1 left-1.5 flex flex-col justify-between font-mono-tabular text-[10px] font-medium text-white/80 drop-shadow">
                <span>1000 Hz</span>
                <span>500 Hz</span>
                <span>0 Hz</span>
              </div>
              <div className="pointer-events-none absolute bottom-1 right-1.5 font-mono-tabular text-[10px] font-medium text-white/80 drop-shadow">
                {spectrogram.durationSec.toFixed(1)}s
              </div>
            </div>
          </div>
        ) : (
          <div
            data-testid={`doppler-empty-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-6 text-center text-xs text-neutral-400"
          >
            Upload an aircraft flyover recording (.mp4, .wav, .mp3) to render its 0–1000 Hz FFT spectrogram.
          </div>
        )}

        {/* Analyst Guidance Note */}
        <p
          data-testid={`doppler-guidance-note-${id}`}
          className="rounded-lg border border-neutral-200/80 bg-[#fafafa] px-3 py-2 text-[11px] leading-relaxed text-neutral-600"
        >
          {DOPPLER_GUIDANCE_NOTE}
        </p>

        {/* Export Frequencies Button */}
        <div className="nodrag space-y-1.5">
          <button
            type="button"
            disabled={!spectrogram || isDecoding}
            onClick={handleExportFrequencies}
            data-testid={`doppler-export-btn-${id}`}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            <Download className="h-3.5 w-3.5 text-[#ff4d4d]" />
            <span>Export Frequencies</span>
          </button>

          {exportStatus && (
            <p
              data-testid={`doppler-export-status-${id}`}
              className="text-center text-[11px] font-medium text-emerald-700"
            >
              {exportStatus}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
