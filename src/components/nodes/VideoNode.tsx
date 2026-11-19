import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import type { NodeProps } from 'reactflow';
import { Camera, Film, Loader2, Send, Upload } from 'lucide-react';
import type { VideoExtractedFrame, VideoNodeData } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import {
  captureVideoFrameWithCanvas,
  clampTimestamp,
  computeIntervalTimestamps,
  extractVideoFrameGrid,
  formatVideoTimestamp,
  isAcceptedVideoFile,
  mergeExtractedFrame,
  transcodeVideoToPlayableMp4,
  VIDEO_INTERVAL_OPTIONS,
} from '../../utils/videoFrames';

export function VideoNode({ id, data, selected }: NodeProps<VideoNodeData>) {
  const updateVideoNodeData = useCanvasStore((state) => state.updateVideoNodeData);
  const spawnImageNodeFromVideoFrame = useCanvasStore(
    (state) => state.spawnImageNodeFromVideoFrame,
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeFileRef = useRef<File | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const extractionRunRef = useRef(0);
  const fallbackAttemptedRef = useRef(false);

  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractStatus, setExtractStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sentFeedback, setSentFeedback] = useState<string | null>(null);

  const intervalSeconds = data.intervalSeconds || 1;
  const duration = data.duration ?? 0;
  const selectedTimestamp = data.selectedTimestamp ?? 0;
  const frames = data.frames ?? [];

  const revokeCurrentObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      extractionRunRef.current += 1;
      revokeCurrentObjectUrl();
    };
  }, [revokeCurrentObjectUrl]);

  const runBatchExtraction = useCallback(
    async (stepSeconds: number) => {
      const video = videoRef.current;
      if (!video || !video.videoWidth || !Number.isFinite(video.duration)) {
        return;
      }

      const runId = ++extractionRunRef.current;
      const vidDuration = video.duration;
      const timestamps = computeIntervalTimestamps(vidDuration, stepSeconds);

      setIsExtracting(true);
      setExtractStatus(`Extracting ${timestamps.length} frame${timestamps.length === 1 ? '' : 's'}...`);
      setError(null);

      try {
        const extracted = await extractVideoFrameGrid(
          video,
          timestamps,
          captureCanvasRef.current,
          () => extractionRunRef.current !== runId,
        );
        if (extractionRunRef.current !== runId) return;

        updateVideoNodeData(id, {
          duration: vidDuration,
          intervalSeconds: stepSeconds,
          frames: extracted,
        });

        // Seek preview back to user's selected slider timestamp
        const restoreTime = clampTimestamp(selectedTimestamp, vidDuration);
        if (Math.abs(video.currentTime - restoreTime) > 0.05) {
          video.currentTime = restoreTime;
        }
      } catch (err) {
        if (extractionRunRef.current !== runId) return;
        setError(
          err instanceof Error ? err.message : 'Failed to extract video frames.',
        );
      } finally {
        if (extractionRunRef.current === runId) {
          setIsExtracting(false);
          setExtractStatus('');
        }
      }
    },
    [id, selectedTimestamp, updateVideoNodeData],
  );

  const handleFileSelected = (file: File) => {
    if (!isAcceptedVideoFile(file)) {
      setError('Please select a valid .mp4 or .mov video file.');
      return;
    }

    extractionRunRef.current += 1;
    fallbackAttemptedRef.current = false;
    activeFileRef.current = file;
    revokeCurrentObjectUrl();

    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setVideoSrc(url);
    setError(null);
    setSentFeedback(null);
    setIsExtracting(true);
    setExtractStatus('Loading video metadata...');

    updateVideoNodeData(id, {
      fileName: file.name,
      duration: null,
      selectedTimestamp: 0,
      frames: [],
    });
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
    event.target.value = '';
  };

  const handleVideoLoadedData = () => {
    const video = videoRef.current;
    if (!video) return;
    const vidDuration = Number.isFinite(video.duration) ? video.duration : 0;
    updateVideoNodeData(id, {
      duration: vidDuration,
      selectedTimestamp: 0,
    });
    void runBatchExtraction(intervalSeconds);
  };

  const handleVideoError = async () => {
    const file = activeFileRef.current;
    if (!file || fallbackAttemptedRef.current) {
      setIsExtracting(false);
      setExtractStatus('');
      setError(
        'Browser could not decode this video file. Try an H.264 MP4 or standard QuickTime MOV.',
      );
      return;
    }

    fallbackAttemptedRef.current = true;
    setIsExtracting(true);
    setExtractStatus('Transcoding video via FFmpeg WASM fallback...');
    setError(null);

    try {
      const transcodedUrl = await transcodeVideoToPlayableMp4(file);
      revokeCurrentObjectUrl();
      objectUrlRef.current = transcodedUrl;
      setVideoSrc(transcodedUrl);
    } catch (err) {
      setIsExtracting(false);
      setExtractStatus('');
      setError(
        err instanceof Error
          ? `Video decode failed: ${err.message}`
          : 'Could not decode uploaded video file.',
      );
    }
  };

  const handleIntervalChange = (nextInterval: number) => {
    updateVideoNodeData(id, { intervalSeconds: nextInterval });
    if (videoSrc && videoRef.current && videoRef.current.readyState >= 2) {
      void runBatchExtraction(nextInterval);
    }
  };

  const handleSliderChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = Number(event.target.value);
    const clamped = clampTimestamp(raw, duration);
    updateVideoNodeData(id, { selectedTimestamp: clamped });
    if (videoRef.current && videoRef.current.readyState >= 1) {
      videoRef.current.currentTime = clamped;
    }
  };

  const handleCaptureSelectedTimestamp = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const runId = ++extractionRunRef.current;
    setIsExtracting(true);
    setExtractStatus(`Capturing frame at ${formatVideoTimestamp(selectedTimestamp)}...`);
    setError(null);

    try {
      const captured = await captureVideoFrameWithCanvas(
        video,
        selectedTimestamp,
        captureCanvasRef.current,
      );
      if (extractionRunRef.current !== runId) return;

      const nextFrames = mergeExtractedFrame(frames, captured);
      updateVideoNodeData(id, { frames: nextFrames });
    } catch (err) {
      if (extractionRunRef.current !== runId) return;
      setError(
        err instanceof Error ? err.message : 'Failed to capture selected frame.',
      );
    } finally {
      if (extractionRunRef.current === runId) {
        setIsExtracting(false);
        setExtractStatus('');
      }
    }
  };

  const handleSendToCanvas = (frame: VideoExtractedFrame) => {
    spawnImageNodeFromVideoFrame(id, frame);
    setSentFeedback(`Sent ${frame.label} to Canvas`);
  };

  return (
    <div
      data-testid={`video-node-${id}`}
      data-has-video={videoSrc ? 'true' : 'false'}
      data-frame-count={String(frames.length)}
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
            <Film className="h-4 w-4 shrink-0 text-[#ff4d4d]" />
            <h3 className="truncate text-sm font-semibold text-neutral-900">
              {data.title}
            </h3>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            data-testid={`video-upload-btn-${id}`}
            aria-label={`Upload video for ${data.title}`}
            className="nodrag inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-800 transition-colors hover:border-neutral-300 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>{data.fileName ? 'Replace' : 'Upload Video'}</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            onChange={handleFileInputChange}
            data-testid={`video-file-input-${id}`}
            className="hidden"
            aria-hidden="true"
          />
        </div>

        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-neutral-500">
          <span className="truncate">
            {data.fileName ? data.fileName : 'Accepts .mp4 and .mov files'}
          </span>
          {duration > 0 && (
            <span className="font-mono-tabular shrink-0 text-[11px] text-neutral-500">
              {formatVideoTimestamp(duration)} · {frames.length} frame
              {frames.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      {/* Offscreen HTML <canvas> used for base64 frame capture */}
      <canvas
        ref={captureCanvasRef}
        data-testid={`video-capture-canvas-${id}`}
        className="hidden"
      />

      {/* Body */}
      <div className="space-y-3 p-3.5">
        {!videoSrc && frames.length === 0 ? (
          <div
            data-testid={`video-empty-${id}`}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-4 py-7 text-center"
          >
            <Film className="h-6 w-6 stroke-[1.5] text-neutral-400" />
            <p className="text-xs text-neutral-500">
              Upload an MP4 or MOV video to seek timestamps and extract frames locally.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="nodrag mt-1 inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Select Video File</span>
            </button>
          </div>
        ) : (
          <>
            {videoSrc && (
              <div className="nodrag overflow-hidden rounded-lg border border-neutral-200/80 bg-black">
                <video
                  ref={videoRef}
                  src={videoSrc}
                  controls
                  muted
                  playsInline
                  preload="auto"
                  onLoadedData={handleVideoLoadedData}
                  onError={() => {
                    void handleVideoError();
                  }}
                  data-testid={`video-player-${id}`}
                  className="block max-h-44 w-full object-contain"
                />
              </div>
            )}

            {/* Interval & Timestamp Slider Controls */}
            {videoSrc && duration > 0 && (
              <div className="nodrag space-y-2.5 border-t border-neutral-100 pt-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-neutral-500">
                    Interval Step
                  </span>
                  <div
                    role="group"
                    aria-label="Timestamp step interval"
                    className="flex items-center gap-1 rounded-lg bg-neutral-100 p-0.5"
                  >
                    {VIDEO_INTERVAL_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => handleIntervalChange(opt)}
                        data-testid={`video-interval-${opt}s-${id}`}
                        className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                          intervalSeconds === opt
                            ? 'bg-white text-neutral-900 shadow-xs'
                            : 'text-neutral-600 hover:text-neutral-900'
                        }`}
                      >
                        {opt}s
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <label
                      htmlFor={`video-slider-${id}`}
                      className="text-[11px] font-medium text-neutral-600"
                    >
                      Timestamp
                    </label>
                    <span
                      data-testid={`video-timestamp-readout-${id}`}
                      className="font-mono-tabular text-[11px] font-semibold text-neutral-900"
                    >
                      {formatVideoTimestamp(selectedTimestamp)} /{' '}
                      {formatVideoTimestamp(duration)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      id={`video-slider-${id}`}
                      type="range"
                      min={0}
                      max={duration}
                      step={intervalSeconds}
                      value={Math.min(selectedTimestamp, duration)}
                      onChange={handleSliderChange}
                      data-testid={`video-timestamp-slider-${id}`}
                      className="h-1.5 w-full cursor-pointer accent-[#ff4d4d]"
                    />
                    <button
                      type="button"
                      disabled={isExtracting}
                      onClick={() => {
                        void handleCaptureSelectedTimestamp();
                      }}
                      data-testid={`video-capture-btn-${id}`}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-neutral-900 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                    >
                      <Camera className="h-3 w-3" />
                      <span>Capture</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isExtracting && (
              <div
                data-testid={`video-loading-${id}`}
                className="flex items-center gap-2 rounded-lg border border-neutral-200/80 bg-neutral-50 px-3 py-2 text-xs text-neutral-600"
              >
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#ff4d4d]" />
                <span>{extractStatus || 'Extracting frames...'}</span>
              </div>
            )}

            {error && (
              <div
                data-testid={`video-error-${id}`}
                className="rounded-lg border border-red-200 bg-red-50/50 px-3 py-2 text-xs text-red-700"
              >
                {error}
              </div>
            )}

            {!videoSrc && frames.length > 0 && (
              <p className="text-[11px] text-neutral-500">
                Restored {frames.length} extracted thumbnail
                {frames.length === 1 ? '' : 's'}. Upload the video again to seek new timestamps.
              </p>
            )}

            {sentFeedback && (
              <p
                data-testid={`video-sent-feedback-${id}`}
                className="text-[11px] font-medium text-neutral-700"
              >
                {sentFeedback}
              </p>
            )}

            {/* Extracted Frame Thumbnails Grid */}
            {frames.length > 0 && (
              <div
                data-testid={`video-frames-grid-${id}`}
                className="nodrag nowheel grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pr-0.5"
              >
                {frames.map((frame, index) => (
                  <div
                    key={frame.id}
                    data-testid={`video-frame-card-${id}-${index}`}
                    className="overflow-hidden rounded-lg border border-neutral-200/90 bg-[#fafafa]"
                  >
                    <img
                      src={frame.dataUrl}
                      alt={`Extracted video frame at ${frame.label}`}
                      referrerPolicy="no-referrer"
                      className="aspect-video w-full object-cover"
                      draggable={false}
                    />
                    <div className="space-y-1.5 p-2">
                      <div className="flex items-center justify-between gap-1 text-[11px] text-neutral-500">
                        <span className="font-mono-tabular font-semibold text-neutral-900">
                          {frame.label}
                        </span>
                        <span className="font-mono-tabular truncate">
                          {frame.width}×{frame.height}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSendToCanvas(frame)}
                        data-testid={`send-frame-btn-${id}-${index}`}
                        className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium text-neutral-800 transition-colors hover:border-neutral-300 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                      >
                        <Send className="h-3 w-3 text-[#ff4d4d]" />
                        <span>Send to Canvas</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
