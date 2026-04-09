import { useEffect, useState } from "react";
import type { AnalysisResult } from "../App";
import { Analysis } from "./Analysis";
import {
  Trash2,
  Loader2,
  Library as LibraryIcon,
  Tag,
  Save,
  X,
  BookOpen,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

type Props = {
  apiBase: string;
  onBibleCreated?: () => void;
};

type LibraryItem = {
  _id: string;
  filename: string;
  uploaded_at: string;
  category: string;
  tags: string[];
  creator: string | null;
  topic: string | null;
  notes: string | null;
  job_id: string;
  metadata: {
    duration_seconds: number;
    width?: number;
    height?: number;
  };
  stats: {
    total_frames: number;
    total_scenes: number;
    cuts_per_minute: number;
    sound_effects_count?: number;
    has_music?: boolean;
  };
};

export function Library({ apiBase, onBibleCreated }: Props) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AnalysisResult | null>(null);
  const [selectedItem, setSelectedItem] = useState<LibraryItem | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ creator: "", topic: "", tags: "", notes: "" });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBibleModal, setShowBibleModal] = useState(false);
  const [bibleName, setBibleName] = useState("");
  const [generatingBible, setGeneratingBible] = useState(false);

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const generateBible = async () => {
    const videoIds = Array.from(selectedIds);
    if (videoIds.length < 2) return;
    if (!bibleName.trim()) {
      toast.error("Dê um nome ao bible");
      return;
    }
    setGeneratingBible(true);
    try {
      const res = await fetch(`${apiBase}/api/style-bibles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: bibleName.trim(), video_ids: videoIds }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Erro" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      toast.success("Style Bible gerado!");
      setShowBibleModal(false);
      setBibleName("");
      setSelectedIds(new Set());
      onBibleCreated?.();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setGeneratingBible(false);
    }
  };

  const loadLibrary = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/library`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items || []);
    } catch (err: any) {
      toast.error(`Erro ao carregar biblioteca: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLibrary();
  }, []);

  const openItem = async (item: LibraryItem) => {
    try {
      const res = await fetch(`${apiBase}/api/library/${item._id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AnalysisResult = await res.json();
      setSelected(data);
      setSelectedItem(item);
      setEditForm({
        creator: item.creator || "",
        topic: item.topic || "",
        tags: (item.tags || []).join(", "),
        notes: item.notes || "",
      });
    } catch (err: any) {
      toast.error(`Erro ao abrir: ${err.message}`);
    }
  };

  const deleteItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Remover esse vídeo da biblioteca?")) return;
    try {
      const res = await fetch(`${apiBase}/api/library/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Removido");
      loadLibrary();
    } catch (err: any) {
      toast.error(`Erro ao remover: ${err.message}`);
    }
  };

  const saveMetadata = async () => {
    if (!selectedItem) return;
    try {
      const res = await fetch(`${apiBase}/api/library/${selectedItem._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creator: editForm.creator.trim() || null,
          topic: editForm.topic.trim() || null,
          tags: editForm.tags.split(",").map((t) => t.trim()).filter(Boolean),
          notes: editForm.notes.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Metadados atualizados");
      setEditing(false);
      await loadLibrary();
      // Refresh selected item data
      const updatedRes = await fetch(`${apiBase}/api/library/${selectedItem._id}`);
      const updated = await updatedRes.json();
      setSelectedItem({ ...selectedItem, ...updated });
    } catch (err: any) {
      toast.error(`Erro ao salvar: ${err.message}`);
    }
  };

  // Detail view
  if (selected && selectedItem) {
    return (
      <div>
        <button
          onClick={() => {
            setSelected(null);
            setSelectedItem(null);
            setEditing(false);
          }}
          className="mb-6 text-sm text-care-accent hover:underline"
        >
          &larr; Voltar para biblioteca
        </button>

        <div className="bg-care-surface border border-care-border rounded-2xl p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-care-light">
                {selectedItem.filename}
              </h2>
              <p className="text-care-muted text-xs mt-1">
                Adicionado em {new Date(selectedItem.uploaded_at).toLocaleString("pt-BR")}
              </p>
            </div>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-sm text-care-accent hover:underline flex items-center gap-1"
              >
                <Tag className="w-4 h-4" />
                Editar metadados
              </button>
            )}
          </div>

          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-care-muted text-xs">Creator</label>
                  <input
                    type="text"
                    value={editForm.creator}
                    onChange={(e) => setEditForm({ ...editForm, creator: e.target.value })}
                    placeholder="ex: Diego Duarte"
                    className="w-full bg-care-dark border border-care-border rounded-lg px-3 py-2 text-care-light text-sm mt-1 focus:outline-none focus:border-care-accent"
                  />
                </div>
                <div>
                  <label className="text-care-muted text-xs">Tema</label>
                  <input
                    type="text"
                    value={editForm.topic}
                    onChange={(e) => setEditForm({ ...editForm, topic: e.target.value })}
                    placeholder="ex: investimentos"
                    className="w-full bg-care-dark border border-care-border rounded-lg px-3 py-2 text-care-light text-sm mt-1 focus:outline-none focus:border-care-accent"
                  />
                </div>
              </div>
              <div>
                <label className="text-care-muted text-xs">Tags (separadas por vírgula)</label>
                <input
                  type="text"
                  value={editForm.tags}
                  onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
                  placeholder="hook-rápido, b-roll-pesado, viral"
                  className="w-full bg-care-dark border border-care-border rounded-lg px-3 py-2 text-care-light text-sm mt-1 focus:outline-none focus:border-care-accent"
                />
              </div>
              <div>
                <label className="text-care-muted text-xs">Notas</label>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  rows={2}
                  className="w-full bg-care-dark border border-care-border rounded-lg px-3 py-2 text-care-light text-sm mt-1 focus:outline-none focus:border-care-accent resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={saveMetadata}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-care-accent hover:bg-care-accent-hover text-white text-sm font-medium"
                >
                  <Save className="w-4 h-4" />
                  Salvar
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-care-border text-care-muted text-sm"
                >
                  <X className="w-4 h-4" />
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <span className="text-care-muted text-xs block">Creator</span>
                <span className="text-care-light">{selectedItem.creator || "—"}</span>
              </div>
              <div>
                <span className="text-care-muted text-xs block">Tema</span>
                <span className="text-care-light">{selectedItem.topic || "—"}</span>
              </div>
              <div className="md:col-span-2">
                <span className="text-care-muted text-xs block">Tags</span>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {selectedItem.tags?.length ? (
                    selectedItem.tags.map((t) => (
                      <span
                        key={t}
                        className="bg-care-accent/20 text-care-accent text-xs px-2 py-0.5 rounded"
                      >
                        {t}
                      </span>
                    ))
                  ) : (
                    <span className="text-care-light">—</span>
                  )}
                </div>
              </div>
              {selectedItem.notes && (
                <div className="col-span-full">
                  <span className="text-care-muted text-xs block">Notas</span>
                  <span className="text-care-light">{selectedItem.notes}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <Analysis result={selected} apiBase={apiBase} />
      </div>
    );
  }

  // List view
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-care-light flex items-center gap-2">
          <LibraryIcon className="w-7 h-7 text-care-accent" />
          Biblioteca ({items.length})
        </h2>
        <div className="flex items-center gap-3">
          {selectedIds.size >= 2 && (
            <button
              onClick={() => setShowBibleModal(true)}
              className="flex items-center gap-2 text-sm bg-care-accent hover:bg-care-accent-hover text-white px-4 py-2 rounded-lg transition"
            >
              <BookOpen className="w-4 h-4" />
              Gerar Style Bible ({selectedIds.size})
            </button>
          )}
          {selectedIds.size > 0 && (
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-care-muted hover:text-care-light"
            >
              Limpar seleção
            </button>
          )}
          <button
            onClick={loadLibrary}
            className="text-sm text-care-muted hover:text-care-light"
          >
            Recarregar
          </button>
        </div>
      </div>

      {selectedIds.size > 0 && selectedIds.size < 2 && (
        <div className="bg-care-accent/10 border border-care-accent/30 rounded-lg px-4 py-2 mb-4 text-sm text-care-light">
          Selecione pelo menos mais 1 vídeo para gerar um Style Bible
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-care-accent animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-care-muted">
          <LibraryIcon className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p>Nenhum vídeo salvo ainda. Faça upload de um vídeo para começar.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <div
              key={item._id}
              onClick={() => openItem(item)}
              className={`bg-care-surface border rounded-xl p-4 cursor-pointer transition ${
                selectedIds.has(item._id)
                  ? "border-care-accent bg-care-accent/5"
                  : "border-care-border hover:border-care-accent"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  onClick={(e) => toggleSelect(item._id, e)}
                  className="mt-1 flex-shrink-0 cursor-pointer"
                >
                  <div
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition ${
                      selectedIds.has(item._id)
                        ? "bg-care-accent border-care-accent"
                        : "border-care-border hover:border-care-accent"
                    }`}
                  >
                    {selectedIds.has(item._id) && (
                      <svg
                        className="w-3 h-3 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </div>
                </div>
              <div className="flex items-start justify-between gap-4 flex-1 min-w-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-care-light font-medium truncate">
                      {item.filename}
                    </h3>
                    {item.creator && (
                      <span className="text-care-muted text-xs">
                        · {item.creator}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-care-muted">
                    <span>{new Date(item.uploaded_at).toLocaleDateString("pt-BR")}</span>
                    <span>·</span>
                    <span>{item.metadata?.duration_seconds}s</span>
                    <span>·</span>
                    <span>{item.stats?.total_scenes} cortes</span>
                    <span>·</span>
                    <span>{item.stats?.sound_effects_count || 0} SFX</span>
                    {item.stats?.has_music && (
                      <>
                        <span>·</span>
                        <span className="text-care-accent">música</span>
                      </>
                    )}
                  </div>
                  {item.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {item.tags.map((t) => (
                        <span
                          key={t}
                          className="bg-care-accent/20 text-care-accent text-xs px-2 py-0.5 rounded"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={(e) => deleteItem(item._id, e)}
                  className="text-care-muted hover:text-red-400 transition p-1"
                  title="Remover"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Generate Bible Modal */}
      {showBibleModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-care-surface border border-care-border rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-care-light flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-care-accent" />
                Gerar Style Bible
              </h3>
              <button
                onClick={() => setShowBibleModal(false)}
                disabled={generatingBible}
                className="text-care-muted hover:text-care-light disabled:opacity-40"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-care-muted text-sm mb-4">
              O Claude vai analisar os {selectedIds.size} vídeos selecionados e
              extrair padrões contextuais de edição, composição e ritmo.
              Custa ~$0.20-0.40.
            </p>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-200 mb-4">
              ⚠️ Todos os vídeos selecionados precisam ter{" "}
              <strong>descrições visuais</strong> geradas antes. Se algum não
              tiver, o bible falha.
            </div>

            <label className="text-care-muted text-xs block mb-1">
              Nome do bible
            </label>
            <input
              type="text"
              value={bibleName}
              onChange={(e) => setBibleName(e.target.value)}
              placeholder="ex: Diego Duarte - Reels de mercado"
              disabled={generatingBible}
              className="w-full bg-care-dark border border-care-border rounded-lg px-4 py-2.5 text-care-light text-sm mb-4 focus:outline-none focus:border-care-accent disabled:opacity-50"
              autoFocus
            />

            <div className="flex gap-3">
              <button
                onClick={() => setShowBibleModal(false)}
                disabled={generatingBible}
                className="flex-1 px-4 py-2.5 rounded-lg border border-care-border text-care-muted hover:text-care-light text-sm transition disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                onClick={generateBible}
                disabled={generatingBible || !bibleName.trim()}
                className="flex-1 px-4 py-2.5 rounded-lg bg-care-accent hover:bg-care-accent-hover text-white text-sm font-medium transition disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {generatingBible ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Gerando...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Gerar Bible
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
