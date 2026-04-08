import { useState } from "react";
import { X, Key, Eye, EyeOff } from "lucide-react";

type Props = {
  currentKey: string;
  onSave: (key: string) => void;
  onClose: () => void;
};

export function ApiKeyModal({ currentKey, onSave, onClose }: Props) {
  const [key, setKey] = useState(currentKey);
  const [show, setShow] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-care-surface border border-care-border rounded-2xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-care-accent" />
            <h3 className="text-lg font-semibold text-care-light">
              OpenAI API Key
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-care-muted hover:text-care-light"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-care-muted text-sm mb-4">
          Necessária para transcrição de áudio via Whisper. A chave fica salva
          apenas no seu navegador (localStorage).
        </p>

        <div className="relative mb-4">
          <input
            type={show ? "text" : "password"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-..."
            className="w-full bg-care-dark border border-care-border rounded-lg px-4 py-3 pr-10 text-care-light text-sm placeholder:text-care-muted/50 focus:outline-none focus:border-care-accent"
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-care-muted hover:text-care-light"
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg border border-care-border text-care-muted hover:text-care-light text-sm transition"
          >
            Cancelar
          </button>
          <button
            onClick={() => key.trim() && onSave(key.trim())}
            disabled={!key.trim()}
            className="flex-1 px-4 py-2.5 rounded-lg bg-care-accent hover:bg-care-accent-hover text-white text-sm font-medium transition disabled:opacity-40"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
