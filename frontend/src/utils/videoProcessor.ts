import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

export type ProcessedFrame = {
  name: string;
  blob: Blob;
};

export type ProcessedVideo = {
  metadata: {
    duration_seconds: number;
    width: number;
    height: number;
    fps: number;
    codec: string;
    has_audio: boolean;
    file_size_mb: number;
  };
  frames: ProcessedFrame[];
  audio: Blob | null;
  scenes: {
    scene: number;
    start: number;
    end: number;
    duration: number;
  }[];
};

const FFMPEG_VERSION = "0.12.10";
const FFMPEG_BASE = `https://unpkg.com/@ffmpeg/core@${FFMPEG_VERSION}/dist/umd`;
const EXTRACT_FPS = 3;
const SCENE_THRESHOLD = 0.32; // empirical — tune if too sensitive/insensitive

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadingPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(
  onLog?: (msg: string) => void
): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoadingPromise) return ffmpegLoadingPromise;

  ffmpegLoadingPromise = (async () => {
    const ffmpeg = new FFmpeg();
    if (onLog) {
      ffmpeg.on("log", ({ message }) => onLog(message));
    }
    await ffmpeg.load({
      coreURL: await toBlobURL(`${FFMPEG_BASE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${FFMPEG_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return ffmpegLoadingPromise;
}

function getVideoMetadata(
  file: File
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const url = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      const result = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      };
      URL.revokeObjectURL(url);
      resolve(result);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Falha ao ler metadados do vídeo"));
    };
    video.src = url;
  });
}

async function computeColorHistogram(blob: Blob): Promise<number[]> {
  const img = await createImageBitmap(blob);
  const targetSize = 64;
  const canvas = document.createElement("canvas");
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, targetSize, targetSize);
  const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
  img.close?.();

  const bins = 8;
  const hist = new Array(bins * 3).fill(0);
  const pixels = imageData.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = Math.min(bins - 1, Math.floor((pixels[i] / 256) * bins));
    const g = Math.min(bins - 1, Math.floor((pixels[i + 1] / 256) * bins));
    const b = Math.min(bins - 1, Math.floor((pixels[i + 2] / 256) * bins));
    hist[r]++;
    hist[bins + g]++;
    hist[bins * 2 + b]++;
  }

  const total = targetSize * targetSize;
  return hist.map((v) => v / total);
}

function histogramDistance(a: number[], b: number[]): number {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff += Math.abs(a[i] - b[i]);
  }
  return diff;
}

async function detectScenesFromFrames(
  frames: ProcessedFrame[]
): Promise<ProcessedVideo["scenes"]> {
  if (frames.length === 0) return [];

  const histograms: number[][] = [];
  for (const frame of frames) {
    histograms.push(await computeColorHistogram(frame.blob));
  }

  const scenes: ProcessedVideo["scenes"] = [];
  let sceneStartFrame = 0;

  for (let i = 1; i < histograms.length; i++) {
    const distance = histogramDistance(histograms[i - 1], histograms[i]);
    if (distance > SCENE_THRESHOLD) {
      scenes.push({
        scene: scenes.length + 1,
        start: round(sceneStartFrame / EXTRACT_FPS),
        end: round(i / EXTRACT_FPS),
        duration: round((i - sceneStartFrame) / EXTRACT_FPS),
      });
      sceneStartFrame = i;
    }
  }

  // Last scene
  scenes.push({
    scene: scenes.length + 1,
    start: round(sceneStartFrame / EXTRACT_FPS),
    end: round(histograms.length / EXTRACT_FPS),
    duration: round((histograms.length - sceneStartFrame) / EXTRACT_FPS),
  });

  return scenes;
}

function round(n: number, digits = 2): number {
  const factor = Math.pow(10, digits);
  return Math.round(n * factor) / factor;
}

export async function preloadFFmpeg(
  onLog?: (msg: string) => void
): Promise<void> {
  await getFFmpeg(onLog);
}

export async function processVideoLocally(
  file: File,
  onProgress?: (msg: string) => void
): Promise<ProcessedVideo> {
  onProgress?.("Carregando ffmpeg...");
  const ffmpeg = await getFFmpeg();

  onProgress?.("Lendo metadados do vídeo...");
  const meta = await getVideoMetadata(file);

  onProgress?.("Carregando vídeo no ffmpeg...");
  const inputName = "input." + (file.name.split(".").pop() || "mp4");
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  // Extract frames at EXTRACT_FPS
  onProgress?.("Extraindo frames...");
  await ffmpeg.exec([
    "-i", inputName,
    "-vf", `fps=${EXTRACT_FPS}`,
    "-q:v", "3",
    "frame_%04d.jpg",
  ]);

  // List and read frames
  const dirContents = (await ffmpeg.listDir("/")) as Array<{
    name: string;
    isDir: boolean;
  }>;
  const frameNames = dirContents
    .filter((e) => !e.isDir && /^frame_\d+\.jpg$/.test(e.name))
    .map((e) => e.name)
    .sort();

  const frames: ProcessedFrame[] = [];
  for (const name of frameNames) {
    const data = (await ffmpeg.readFile(name)) as Uint8Array;
    // Copy into a fresh Uint8Array to detach from any SharedArrayBuffer
    const safeData = new Uint8Array(data.byteLength);
    safeData.set(data);
    frames.push({
      name,
      blob: new Blob([safeData], { type: "image/jpeg" }),
    });
    await ffmpeg.deleteFile(name);
  }

  // Extract audio (best-effort — videos without audio just skip this)
  onProgress?.("Extraindo áudio...");
  let audio: Blob | null = null;
  try {
    await ffmpeg.exec([
      "-i", inputName,
      "-vn",
      "-acodec", "libmp3lame",
      "-q:a", "4",
      "audio.mp3",
    ]);
    const audioData = (await ffmpeg.readFile("audio.mp3")) as Uint8Array;
    const safeAudio = new Uint8Array(audioData.byteLength);
    safeAudio.set(audioData);
    audio = new Blob([safeAudio], { type: "audio/mpeg" });
    await ffmpeg.deleteFile("audio.mp3");
  } catch (e) {
    console.warn("No audio track or extraction failed:", e);
  }

  await ffmpeg.deleteFile(inputName);

  // Scene detection via canvas diff
  onProgress?.(`Detectando cortes em ${frames.length} frames...`);
  const scenes = await detectScenesFromFrames(frames);

  return {
    metadata: {
      duration_seconds: round(meta.duration),
      width: meta.width,
      height: meta.height,
      fps: EXTRACT_FPS,
      codec: "h264",
      has_audio: audio !== null,
      file_size_mb: round(file.size / 1024 / 1024),
    },
    frames,
    audio,
    scenes,
  };
}

export async function uploadProcessedVideo(
  apiBase: string,
  file: File,
  processed: ProcessedVideo
): Promise<any> {
  const formData = new FormData();
  formData.append("filename", file.name);
  formData.append("metadata", JSON.stringify(processed.metadata));
  formData.append("scenes", JSON.stringify(processed.scenes));

  if (processed.audio) {
    formData.append("audio", processed.audio, "audio.mp3");
  }

  for (const frame of processed.frames) {
    formData.append("frames", frame.blob, frame.name);
  }

  const res = await fetch(`${apiBase}/api/analyze`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Erro desconhecido" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.json();
}
