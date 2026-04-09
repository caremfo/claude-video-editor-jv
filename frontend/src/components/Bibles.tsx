import { useEffect, useState } from "react";
import {
  BookOpen,
  Loader2,
  Trash2,
  Scissors,
  Film,
  Music,
  Image as ImageIcon,
  Type,
  ListChecks,
} from "lucide-react";
import { toast } from "sonner";

type Props = {
  apiBase: string;
};

type BibleListItem = {
  _id: string;
  name: string;
  created_at: string;
  source_count: number;
  source_filenames: string[];
};

type BibleSection = {
  description?: string;
  patterns?: string[];
};

type BibleContent = {
  overview?: string;
  cuts_and_rhythm?: BibleSection;
  b_roll_patterns?: BibleSection;
  audio_patterns?: BibleSection;
  visual_composition?: BibleSection;
  text_on_screen?: BibleSection;
  contextual_rules?: string[];
  summary?: string;
  error?: string;
  raw_response?: string;
};

type BibleFull = BibleListItem & {
  source_video_ids: string[];
  content: BibleContent;
};

export function Bibles({ apiBase }: Props) {
  const [items, setItems] = useState<BibleListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<BibleFull | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/style-bibles`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items || []);
    } catch (err: any) {
      toast.error(`Erro ao carregar bibles: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openBible = async (id: string) => {
    setSelectedLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/style-bibles/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSelected(data);
    } catch (err: any) {
      toast.error(`Erro ao abrir: ${err.message}`);
    } finally {
      setSelectedLoading(false);
    }
  };

  const deleteBible = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Remover esse bible?")) return;
    try {
      const res = await fetch(`${apiBase}/api/style-bibles/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Removido");
      load();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    }
  };

  // Detail view
  if (selected) {
    return <BibleDetail bible={selected} onBack={() => setSelected(null)} />;
  }

  if (selectedLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-care-accent animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-care-light flex items-center gap-2">
          <BookOpen className="w-7 h-7 text-care-accent" />
          Style Bibles ({items.length})
        </h2>
        <button
          onClick={load}
          className="text-sm text-care-muted hover:text-care-light"
        >
          Recarregar
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-care-accent animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-care-muted">
          <BookOpen className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p>Nenhum bible gerado ainda.</p>
          <p className="text-sm mt-2">
            Vá na Biblioteca, selecione 2+ vídeos e clique em "Gerar Style Bible".
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((b) => (
            <div
              key={b._id}
              onClick={() => openBible(b._id)}
              className="bg-care-surface border border-care-border rounded-xl p-4 cursor-pointer hover:border-care-accent transition"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="text-care-light font-semibold">{b.name}</h3>
                  <div className="flex items-center gap-3 text-xs text-care-muted mt-1">
                    <span>
                      {new Date(b.created_at).toLocaleString("pt-BR")}
                    </span>
                    <span>·</span>
                    <span>
                      {b.source_count} vídeo{b.source_count !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {b.source_filenames?.length > 0 && (
                    <p className="text-xs text-care-muted mt-2 truncate">
                      {b.source_filenames.join(", ")}
                    </p>
                  )}
                </div>
                <button
                  onClick={(e) => deleteBible(b._id, e)}
                  className="text-care-muted hover:text-red-400 transition p-1"
                  title="Remover"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BibleDetail({
  bible,
  onBack,
}: {
  bible: BibleFull;
  onBack: () => void;
}) {
  const { content } = bible;

  if (content?.error) {
    return (
      <div>
        <button
          onClick={onBack}
          className="mb-6 text-sm text-care-accent hover:underline"
        >
          &larr; Voltar
        </button>
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6">
          <p className="text-red-400 font-medium mb-2">Erro: {content.error}</p>
          {content.raw_response && (
            <pre className="text-care-muted text-xs mt-2 overflow-x-auto whitespace-pre-wrap max-h-96">
              {content.raw_response}
            </pre>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-6 text-sm text-care-accent hover:underline"
      >
        &larr; Voltar
      </button>

      <div className="mb-6">
        <h2 className="text-3xl font-bold text-care-light mb-2">{bible.name}</h2>
        <p className="text-care-muted text-sm">
          Gerado em {new Date(bible.created_at).toLocaleString("pt-BR")} ·{" "}
          {bible.source_count} vídeos de referência
        </p>
      </div>

      {content?.overview && (
        <div className="bg-care-accent/10 border border-care-accent/30 rounded-2xl p-6 mb-6">
          <p className="text-care-light leading-relaxed">{content.overview}</p>
        </div>
      )}

      <SectionCard
        icon={<Scissors className="w-5 h-5 text-care-accent" />}
        title="Cortes e ritmo"
        section={content?.cuts_and_rhythm}
      />
      <SectionCard
        icon={<Film className="w-5 h-5 text-care-accent" />}
        title="Uso de b-rolls"
        section={content?.b_roll_patterns}
      />
      <SectionCard
        icon={<Music className="w-5 h-5 text-care-accent" />}
        title="Áudio (música e SFX)"
        section={content?.audio_patterns}
      />
      <SectionCard
        icon={<ImageIcon className="w-5 h-5 text-care-accent" />}
        title="Composição visual"
        section={content?.visual_composition}
      />
      <SectionCard
        icon={<Type className="w-5 h-5 text-care-accent" />}
        title="Texto na tela"
        section={content?.text_on_screen}
      />

      {content?.contextual_rules && content.contextual_rules.length > 0 && (
        <div className="bg-care-surface border border-care-border rounded-2xl p-6 mb-6">
          <h3 className="text-lg font-semibold text-care-light mb-4 flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-care-accent" />
            Regras contextuais (acionáveis)
          </h3>
          <ul className="space-y-2">
            {content.contextual_rules.map((rule, i) => (
              <li
                key={i}
                className="flex gap-3 bg-care-dark rounded-lg px-4 py-3 text-care-light text-sm"
              >
                <span className="text-care-accent font-mono text-xs mt-0.5">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {content?.summary && (
        <div className="bg-care-surface border border-care-accent/40 rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-care-light mb-3">
            Síntese
          </h3>
          <p className="text-care-light leading-relaxed">{content.summary}</p>
        </div>
      )}
    </div>
  );
}

function SectionCard({
  icon,
  title,
  section,
}: {
  icon: React.ReactNode;
  title: string;
  section?: BibleSection;
}) {
  if (!section || (!section.description && !section.patterns?.length)) {
    return null;
  }

  return (
    <div className="bg-care-surface border border-care-border rounded-2xl p-6 mb-4">
      <h3 className="text-lg font-semibold text-care-light mb-3 flex items-center gap-2">
        {icon}
        {title}
      </h3>
      {section.description && (
        <p className="text-care-muted text-sm mb-4 italic">
          {section.description}
        </p>
      )}
      {section.patterns && section.patterns.length > 0 && (
        <ul className="space-y-2">
          {section.patterns.map((p, i) => (
            <li
              key={i}
              className="text-care-light text-sm flex gap-3 border-l-2 border-care-accent/40 pl-3"
            >
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
