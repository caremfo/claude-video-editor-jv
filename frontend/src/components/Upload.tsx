import { useCallback, useRef } from "react";
import { Upload as UploadIcon, Loader2 } from "lucide-react";

type Props = {
  onUpload: (files: File[]) => void;
  loading: boolean;
  progress: string;
};

export function Upload({ onUpload, loading, progress }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (fileList: FileList) => {
      const valid: File[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        if (!f.type.startsWith("video/")) continue;
        if (f.size > 100 * 1024 * 1024) {
          alert(`${f.name} muito grande (máximo 100MB). Ignorado.`);
          continue;
        }
        valid.push(f);
      }
      if (valid.length > 0) onUpload(valid);
    },
    [onUpload]
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh]">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-care-light mb-2">
          Analise seus vídeos
        </h2>
        <p className="text-care-muted max-w-md">
          Envie um ou vários Reels/Shorts e descubra o que funciona — roteiro,
          cortes, composição visual e textos na tela.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add("border-care-accent", "bg-care-accent/10");
        }}
        onDragLeave={(e) => {
          e.currentTarget.classList.remove("border-care-accent", "bg-care-accent/10");
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove("border-care-accent", "bg-care-accent/10");
          if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
        }}
        onClick={() => !loading && inputRef.current?.click()}
        className={`
          w-full max-w-lg border-2 border-dashed rounded-2xl p-12
          flex flex-col items-center gap-4 cursor-pointer transition-all
          border-care-border hover:border-care-accent/50 hover:bg-care-surface
          ${loading ? "pointer-events-none opacity-60" : ""}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {loading ? (
          <>
            <Loader2 className="w-12 h-12 text-care-accent animate-spin" />
            <p className="text-care-muted text-sm">{progress}</p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-care-surface flex items-center justify-center">
              <UploadIcon className="w-8 h-8 text-care-muted" />
            </div>
            <div className="text-center">
              <p className="text-care-light font-medium">
                Arraste vídeos ou clique para selecionar
              </p>
              <p className="text-care-muted text-sm mt-1">
                MP4, MOV, WebM — até 100MB cada — selecione vários de uma vez
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
