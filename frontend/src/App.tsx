import { useState } from "react";
import { Upload } from "./components/Upload";
import { Analysis } from "./components/Analysis";
import { Library } from "./components/Library";
import { Bibles } from "./components/Bibles";
import { Toaster, toast } from "sonner";
import {
  Film,
  Library as LibraryIcon,
  Upload as UploadIcon,
  BookOpen,
} from "lucide-react";
import "./index.css";

export type AnalysisResult = {
  job_id: string;
  fileName: string;
  metadata: {
    duration_seconds: number;
    width: number;
    height: number;
    fps: number;
    codec: string;
    has_audio: boolean;
    file_size_mb: number;
  };
  transcription: {
    text: string;
    language: string;
    segments: { start: number; end: number; text: string }[];
    error?: string;
  } | null;
  scenes: { scene: number; start: number; end: number; duration: number }[];
  frames: string[];
  audio_events: {
    has_music: boolean;
    music_confidence: number;
    speech_confidence: number;
    timeline: { start: number; events: { label: string; score: number }[] }[];
    sound_effects: { time: number; label: string; score: number }[];
    error?: string;
  } | null;
  stats: {
    total_frames: number;
    total_scenes: number;
    cuts_per_minute: number;
    sound_effects_count: number;
    has_music: boolean;
  };
  visual_descriptions?: VisualDescription[] | null;
  _id?: string;
};

export type VisualDescription = {
  scene: number;
  shot_type?: string;
  subject_type?: string;
  subject?: string;
  visual_elements?: string[];
  composition?: string;
  script_alignment?: string;
  purpose?: string;
  error?: string;
  raw_response?: string;
};

type QueueItem = {
  file: File;
  status: "pending" | "processing" | "done" | "error";
  result?: AnalysisResult;
  error?: string;
};

const API_BASE = import.meta.env.VITE_API_URL || "";

type View = "upload" | "library" | "bibles";

function App() {
  const [view, setView] = useState<View>("upload");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [selectedResult, setSelectedResult] = useState<number | null>(null);

  const processQueue = async (items: QueueItem[]) => {
    setProcessing(true);

    for (let i = 0; i < items.length; i++) {
      setCurrentIndex(i);
      setQueue((prev) =>
        prev.map((q, idx) => (idx === i ? { ...q, status: "processing" } : q))
      );

      const formData = new FormData();
      formData.append("video", items[i].file);
      formData.append("fps", "3");

      try {
        const res = await fetch(`${API_BASE}/api/analyze`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: "Erro desconhecido" }));
          throw new Error(err.detail || `HTTP ${res.status}`);
        }

        const data: AnalysisResult = await res.json();
        data.fileName = items[i].file.name;

        setQueue((prev) =>
          prev.map((q, idx) =>
            idx === i ? { ...q, status: "done", result: data } : q
          )
        );
        toast.success(`${items[i].file.name} concluído!`);
      } catch (err: any) {
        setQueue((prev) =>
          prev.map((q, idx) =>
            idx === i ? { ...q, status: "error", error: err.message } : q
          )
        );
        toast.error(`${items[i].file.name}: ${err.message}`);
      }
    }

    setProcessing(false);
    setCurrentIndex(-1);
  };

  const handleUpload = (files: File[]) => {
    const newItems: QueueItem[] = files.map((f) => ({
      file: f,
      status: "pending",
    }));
    const allItems = [...queue, ...newItems];
    setQueue(allItems);

    // Processa apenas os novos (os antigos já foram processados)
    if (!processing) {
      processQueue(newItems);
    }
  };

  const handleReset = () => {
    setQueue([]);
    setSelectedResult(null);
  };

  const doneCount = queue.filter((q) => q.status === "done").length;
  const errorCount = queue.filter((q) => q.status === "error").length;

  // Se um resultado está selecionado, mostra a análise
  if (selectedResult !== null && queue[selectedResult]?.result) {
    return (
      <div className="min-h-screen bg-care-dark">
        <Toaster theme="dark" position="top-right" />
        <header className="border-b border-care-border px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center gap-3">
            <Film className="w-7 h-7 text-care-accent" />
            <h1 className="text-xl font-semibold text-care-light">
              Care Video Analyzer
            </h1>
          </div>
        </header>
        <main className="max-w-6xl mx-auto p-6">
          <button
            onClick={() => setSelectedResult(null)}
            className="mb-6 text-sm text-care-accent hover:underline"
          >
            &larr; Voltar para lista
          </button>
          <h2 className="text-xl font-semibold text-care-light mb-4">
            {queue[selectedResult].file.name}
          </h2>
          <Analysis
            result={queue[selectedResult].result!}
            apiBase={API_BASE}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-care-dark">
      <Toaster theme="dark" position="top-right" />

      <header className="border-b border-care-border px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Film className="w-7 h-7 text-care-accent" />
            <h1 className="text-xl font-semibold text-care-light">
              Care Video Analyzer
            </h1>
          </div>
          <nav className="flex items-center gap-2">
            <button
              onClick={() => setView("upload")}
              className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded border transition ${
                view === "upload"
                  ? "border-care-accent text-care-accent"
                  : "border-care-border text-care-muted hover:text-care-light"
              }`}
            >
              <UploadIcon className="w-4 h-4" />
              Upload
            </button>
            <button
              onClick={() => setView("library")}
              className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded border transition ${
                view === "library"
                  ? "border-care-accent text-care-accent"
                  : "border-care-border text-care-muted hover:text-care-light"
              }`}
            >
              <LibraryIcon className="w-4 h-4" />
              Biblioteca
            </button>
            <button
              onClick={() => setView("bibles")}
              className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded border transition ${
                view === "bibles"
                  ? "border-care-accent text-care-accent"
                  : "border-care-border text-care-muted hover:text-care-light"
              }`}
            >
              <BookOpen className="w-4 h-4" />
              Style Bibles
            </button>
            {view === "upload" && queue.length > 0 && !processing && (
              <button
                onClick={handleReset}
                className="text-sm text-care-muted hover:text-care-light transition px-3 py-1.5 rounded border border-care-border hover:border-care-accent"
              >
                Limpar
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {view === "library" && (
          <Library
            apiBase={API_BASE}
            onBibleCreated={() => setView("bibles")}
          />
        )}

        {view === "bibles" && <Bibles apiBase={API_BASE} />}

        {/* Upload area - sempre visível quando não processando */}
        {view === "upload" && !processing && (
          <Upload onUpload={handleUpload} loading={false} progress="" />
        )}

        {/* Processing indicator */}
        {view === "upload" && processing && (
          <div className="text-center py-8">
            <div className="inline-flex items-center gap-3 bg-care-surface border border-care-border rounded-xl px-6 py-4">
              <div className="w-5 h-5 border-2 border-care-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-care-light">
                Processando {currentIndex + 1} de {queue.length}...
              </span>
              <span className="text-care-muted text-sm">
                {queue[currentIndex]?.file.name}
              </span>
            </div>
          </div>
        )}

        {/* Queue list */}
        {view === "upload" && queue.length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-care-light mb-4">
              Vídeos ({doneCount}/{queue.length} concluídos
              {errorCount > 0 ? `, ${errorCount} com erro` : ""})
            </h3>
            <div className="space-y-2">
              {queue.map((item, i) => (
                <div
                  key={i}
                  onClick={() => item.status === "done" && setSelectedResult(i)}
                  className={`
                    flex items-center justify-between bg-care-surface border border-care-border rounded-xl px-4 py-3 transition
                    ${item.status === "done" ? "cursor-pointer hover:border-care-accent" : ""}
                  `}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <StatusBadge status={item.status} />
                    <span className="text-care-light text-sm truncate">
                      {item.file.name}
                    </span>
                    <span className="text-care-muted text-xs">
                      {(item.file.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.result && (
                      <span className="text-care-muted text-xs">
                        {item.result.metadata.duration_seconds}s &middot;{" "}
                        {item.result.stats.total_scenes} cortes &middot;{" "}
                        {item.result.stats.total_frames} frames
                      </span>
                    )}
                    {item.error && (
                      <span className="text-red-400 text-xs">{item.error}</span>
                    )}
                    {item.status === "done" && (
                      <span className="text-care-accent text-xs">Ver &rarr;</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: QueueItem["status"] }) {
  switch (status) {
    case "pending":
      return (
        <div className="w-2.5 h-2.5 rounded-full bg-care-muted/50" title="Na fila" />
      );
    case "processing":
      return (
        <div className="w-2.5 h-2.5 rounded-full bg-care-accent animate-pulse" title="Processando" />
      );
    case "done":
      return (
        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" title="Concluído" />
      );
    case "error":
      return (
        <div className="w-2.5 h-2.5 rounded-full bg-red-500" title="Erro" />
      );
  }
}

export default App;
