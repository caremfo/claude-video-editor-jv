import { useState } from "react";
import { Upload } from "./components/Upload";
import { Analysis } from "./components/Analysis";
import { ApiKeyModal } from "./components/ApiKeyModal";
import { Toaster, toast } from "sonner";
import { Film } from "lucide-react";
import "./index.css";

export type AnalysisResult = {
  job_id: string;
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
  stats: {
    total_frames: number;
    total_scenes: number;
    cuts_per_minute: number;
  };
};

const API_BASE = import.meta.env.VITE_API_URL || "";

function App() {
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem("openai_key") || ""
  );
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");

  const handleUpload = async (file: File) => {
    if (!apiKey) {
      setShowKeyModal(true);
      return;
    }

    setLoading(true);
    setProgress("Enviando vídeo...");
    setResult(null);

    const formData = new FormData();
    formData.append("video", file);
    formData.append("openai_key", apiKey);
    formData.append("fps", "3");

    try {
      setProgress("Processando... (pode levar até 1 min)");
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Erro desconhecido" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      const data: AnalysisResult = await res.json();
      setResult(data);
      toast.success("Análise concluída!");
    } catch (err: any) {
      toast.error(err.message || "Erro ao processar vídeo");
    } finally {
      setLoading(false);
      setProgress("");
    }
  };

  const handleSaveKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem("openai_key", key);
    setShowKeyModal(false);
    toast.success("Chave salva!");
  };

  return (
    <div className="min-h-screen bg-care-dark">
      <Toaster theme="dark" position="top-right" />

      {/* Header */}
      <header className="border-b border-care-border px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Film className="w-7 h-7 text-care-accent" />
            <h1 className="text-xl font-semibold text-care-light">
              Care Video Analyzer
            </h1>
          </div>
          <button
            onClick={() => setShowKeyModal(true)}
            className="text-sm text-care-muted hover:text-care-light transition px-3 py-1.5 rounded border border-care-border hover:border-care-accent"
          >
            {apiKey ? "Chave configurada" : "Configurar API Key"}
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto p-6">
        {!result && (
          <Upload
            onUpload={handleUpload}
            loading={loading}
            progress={progress}
          />
        )}

        {result && (
          <div>
            <button
              onClick={() => setResult(null)}
              className="mb-6 text-sm text-care-accent hover:underline"
            >
              &larr; Analisar outro vídeo
            </button>
            <Analysis result={result} apiBase={API_BASE} />
          </div>
        )}
      </main>

      {/* API Key Modal */}
      {showKeyModal && (
        <ApiKeyModal
          currentKey={apiKey}
          onSave={handleSaveKey}
          onClose={() => setShowKeyModal(false)}
        />
      )}
    </div>
  );
}

export default App;
