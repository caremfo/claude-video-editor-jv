import { useCallback, useRef, useState } from "react";
import { Upload as UploadIcon, FileVideo, Loader2 } from "lucide-react";

type Props = {
  onUpload: (file: File) => void;
  loading: boolean;
  progress: string;
};

export function Upload({ onUpload, loading, progress }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("video/")) {
        alert("Envie um arquivo de vídeo (.mp4, .mov, .webm)");
        return;
      }
      if (file.size > 100 * 1024 * 1024) {
        alert("Arquivo muito grande (máximo 100MB)");
        return;
      }
      setFileName(file.name);
      onUpload(file);
    },
    [onUpload]
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-care-light mb-2">
          Analise seus vídeos
        </h2>
        <p className="text-care-muted max-w-md">
          Envie um Reel ou Short e descubra o que funciona — roteiro, cortes,
          composição visual e textos na tela.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
        onClick={() => !loading && inputRef.current?.click()}
        className={`
          w-full max-w-lg border-2 border-dashed rounded-2xl p-12
          flex flex-col items-center gap-4 cursor-pointer transition-all
          ${dragOver
            ? "border-care-accent bg-care-accent/10"
            : "border-care-border hover:border-care-accent/50 hover:bg-care-surface"
          }
          ${loading ? "pointer-events-none opacity-60" : ""}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />

        {loading ? (
          <>
            <Loader2 className="w-12 h-12 text-care-accent animate-spin" />
            <p className="text-care-muted text-sm">{progress}</p>
            {fileName && (
              <p className="text-care-muted text-xs">{fileName}</p>
            )}
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-care-surface flex items-center justify-center">
              {fileName ? (
                <FileVideo className="w-8 h-8 text-care-accent" />
              ) : (
                <UploadIcon className="w-8 h-8 text-care-muted" />
              )}
            </div>
            <div className="text-center">
              <p className="text-care-light font-medium">
                {fileName || "Arraste um vídeo ou clique para selecionar"}
              </p>
              <p className="text-care-muted text-sm mt-1">
                MP4, MOV, WebM — até 100MB
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
