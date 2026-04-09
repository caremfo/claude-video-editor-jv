import { useState } from "react";
import { toast } from "sonner";
import type { AnalysisResult, VisualDescription } from "../App";
import {
  Clock,
  Scissors,
  FileText,
  Image,
  Monitor,
  ChevronLeft,
  ChevronRight,
  Music,
  Volume2,
  Eye,
  Sparkles,
  Loader2,
} from "lucide-react";

type Props = {
  result: AnalysisResult;
  apiBase: string;
};

export function Analysis({ result, apiBase }: Props) {
  const { metadata, transcription, scenes, frames, stats, audio_events } = result;
  const [currentFrame, setCurrentFrame] = useState(0);
  const [descriptions, setDescriptions] = useState<VisualDescription[] | null>(
    result.visual_descriptions || null
  );
  const [describing, setDescribing] = useState(false);

  const generateDescriptions = async () => {
    if (!result._id) {
      toast.error("Este vídeo precisa estar salvo na biblioteca para gerar descrições");
      return;
    }
    setDescribing(true);
    try {
      const res = await fetch(
        `${apiBase}/api/library/${result._id}/describe-visuals`,
        { method: "POST" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Erro" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setDescriptions(data.descriptions);
      toast.success(`${data.count} cenas descritas`);
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setDescribing(false);
    }
  };

  const frameSrc = (name: string) =>
    `${apiBase}/api/frames/${result.job_id}/${name}`;

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<Clock className="w-5 h-5" />}
          label="Duração"
          value={`${metadata.duration_seconds}s`}
        />
        <StatCard
          icon={<Monitor className="w-5 h-5" />}
          label="Resolução"
          value={`${metadata.width}x${metadata.height}`}
        />
        <StatCard
          icon={<Scissors className="w-5 h-5" />}
          label="Cortes"
          value={`${stats.total_scenes} (${stats.cuts_per_minute}/min)`}
        />
        <StatCard
          icon={<Image className="w-5 h-5" />}
          label="Frames"
          value={`${stats.total_frames}`}
        />
      </div>

      {/* Frame viewer */}
      <div className="bg-care-surface border border-care-border rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-care-light mb-4 flex items-center gap-2">
          <Image className="w-5 h-5 text-care-accent" />
          Frames Extraídos
        </h3>

        {frames.length > 0 && (
          <div>
            <div className="relative flex items-center justify-center bg-care-dark rounded-xl overflow-hidden mb-4">
              <img
                src={frameSrc(frames[currentFrame])}
                alt={`Frame ${currentFrame + 1}`}
                className="max-h-[500px] object-contain"
              />
              <div className="absolute bottom-3 right-3 bg-black/70 text-care-light text-xs px-2 py-1 rounded">
                {currentFrame + 1} / {frames.length}
              </div>
            </div>

            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => setCurrentFrame(Math.max(0, currentFrame - 1))}
                disabled={currentFrame === 0}
                className="p-2 rounded-lg bg-care-dark border border-care-border hover:border-care-accent disabled:opacity-30 transition"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              {/* Thumbnails */}
              <div className="flex gap-1.5 overflow-x-auto max-w-[400px] py-1">
                {frames.map((name, i) => (
                  <button
                    key={name}
                    onClick={() => setCurrentFrame(i)}
                    className={`flex-shrink-0 w-12 h-12 rounded overflow-hidden border-2 transition ${
                      i === currentFrame
                        ? "border-care-accent"
                        : "border-transparent opacity-50 hover:opacity-80"
                    }`}
                  >
                    <img
                      src={frameSrc(name)}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>

              <button
                onClick={() =>
                  setCurrentFrame(Math.min(frames.length - 1, currentFrame + 1))
                }
                disabled={currentFrame === frames.length - 1}
                className="p-2 rounded-lg bg-care-dark border border-care-border hover:border-care-accent disabled:opacity-30 transition"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Scenes timeline */}
      {scenes.length > 0 && (
        <div className="bg-care-surface border border-care-border rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-care-light mb-4 flex items-center gap-2">
            <Scissors className="w-5 h-5 text-care-accent" />
            Cortes de Cena
          </h3>

          {/* Visual timeline */}
          <div className="flex gap-0.5 h-8 rounded-lg overflow-hidden mb-4">
            {scenes.map((s, i) => {
              const pct = (s.duration / metadata.duration_seconds) * 100;
              const colors = [
                "bg-indigo-500",
                "bg-purple-500",
                "bg-pink-500",
                "bg-blue-500",
                "bg-teal-500",
                "bg-amber-500",
                "bg-rose-500",
                "bg-emerald-500",
              ];
              return (
                <div
                  key={i}
                  className={`${colors[i % colors.length]} relative group cursor-default`}
                  style={{ width: `${Math.max(pct, 2)}%` }}
                  title={`Cena ${s.scene}: ${s.start}s - ${s.end}s (${s.duration}s)`}
                >
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-care-dark text-care-light text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap pointer-events-none">
                    {s.duration}s
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {scenes.map((s) => (
              <div
                key={s.scene}
                className="bg-care-dark rounded-lg px-3 py-2 text-sm"
              >
                <span className="text-care-accent font-mono">
                  Cena {s.scene}
                </span>
                <span className="text-care-muted ml-2">
                  {s.start}s → {s.end}s ({s.duration}s)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Visual Descriptions */}
      <div className="bg-care-surface border border-care-border rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-care-light flex items-center gap-2">
            <Eye className="w-5 h-5 text-care-accent" />
            Descrição visual por cena
          </h3>
          {!descriptions && (
            <button
              onClick={generateDescriptions}
              disabled={describing || !result._id}
              className="flex items-center gap-2 text-sm bg-care-accent hover:bg-care-accent-hover text-white px-4 py-2 rounded-lg disabled:opacity-40 transition"
            >
              {describing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analisando cenas...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Gerar descrições (Claude)
                </>
              )}
            </button>
          )}
          {descriptions && (
            <button
              onClick={generateDescriptions}
              disabled={describing}
              className="text-xs text-care-muted hover:text-care-light"
            >
              {describing ? "Regenerando..." : "Regenerar"}
            </button>
          )}
        </div>

        {!descriptions && !describing && (
          <p className="text-care-muted text-sm">
            Clique em "Gerar descrições" para o Claude analisar cada cena e
            identificar: tipo de plano, o que aparece, elementos na tela,
            composição e como isso serve o roteiro.
            {!result._id && (
              <span className="text-amber-400 block mt-2">
                ⚠️ Este vídeo ainda não está salvo na biblioteca.
              </span>
            )}
          </p>
        )}

        {describing && !descriptions && (
          <div className="flex items-center gap-3 text-care-muted text-sm">
            <Loader2 className="w-4 h-4 animate-spin text-care-accent" />
            Claude está olhando cada frame e correlacionando com a transcrição... (pode levar até 30s)
          </div>
        )}

        {descriptions && descriptions.length > 0 && (
          <div className="space-y-4">
            {descriptions.map((d, i) => {
              if (d.error) {
                return (
                  <div
                    key={i}
                    className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm"
                  >
                    <p className="text-red-400 font-medium">Erro: {d.error}</p>
                    {d.raw_response && (
                      <pre className="text-care-muted text-xs mt-2 overflow-x-auto whitespace-pre-wrap">
                        {d.raw_response}
                      </pre>
                    )}
                  </div>
                );
              }
              return (
                <div
                  key={i}
                  className="bg-care-dark border border-care-border rounded-xl p-4"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="bg-care-accent/20 text-care-accent text-xs font-mono px-2 py-0.5 rounded">
                      Cena {d.scene}
                    </span>
                    {d.shot_type && (
                      <span className="text-care-muted text-xs bg-care-surface px-2 py-0.5 rounded">
                        {d.shot_type}
                      </span>
                    )}
                    {d.subject_type && (
                      <span className="text-care-muted text-xs bg-care-surface px-2 py-0.5 rounded">
                        {d.subject_type}
                      </span>
                    )}
                    {d.purpose && (
                      <span className="text-care-accent text-xs bg-care-accent/10 px-2 py-0.5 rounded">
                        {d.purpose}
                      </span>
                    )}
                  </div>

                  {d.subject && (
                    <p className="text-care-light text-sm mb-2">
                      <span className="text-care-muted text-xs block mb-0.5">O que aparece</span>
                      {d.subject}
                    </p>
                  )}

                  {d.visual_elements && d.visual_elements.length > 0 && (
                    <div className="mb-2">
                      <span className="text-care-muted text-xs block mb-1">Elementos na tela</span>
                      <ul className="text-care-light text-sm list-disc list-inside space-y-0.5">
                        {d.visual_elements.map((el, j) => (
                          <li key={j}>{el}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {d.composition && (
                    <p className="text-care-light text-sm mb-2">
                      <span className="text-care-muted text-xs block mb-0.5">Composição</span>
                      {d.composition}
                    </p>
                  )}

                  {d.script_alignment && (
                    <p className="text-care-light text-sm border-l-2 border-care-accent/40 pl-3 mt-3">
                      <span className="text-care-muted text-xs block mb-0.5">Como serve o roteiro</span>
                      {d.script_alignment}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Transcription */}
      {transcription && !transcription.error && (
        <div className="bg-care-surface border border-care-border rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-care-light mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-care-accent" />
            Transcrição
          </h3>

          <div className="space-y-2">
            {transcription.segments.map((seg, i) => (
              <div key={i} className="flex gap-3 text-sm">
                <span className="text-care-accent font-mono whitespace-nowrap min-w-[80px]">
                  {seg.start.toFixed(1)}s
                </span>
                <span className="text-care-light">{seg.text}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-care-border">
            <p className="text-care-muted text-sm font-medium mb-2">
              Texto completo:
            </p>
            <p className="text-care-light text-sm leading-relaxed">
              {transcription.text}
            </p>
          </div>
        </div>
      )}

      {transcription?.error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4">
          <p className="text-red-400 text-sm">
            Erro na transcrição: {transcription.error}
          </p>
        </div>
      )}

      {/* Audio Events */}
      {audio_events && !audio_events.error && (
        <div className="bg-care-surface border border-care-border rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-care-light mb-4 flex items-center gap-2">
            <Music className="w-5 h-5 text-care-accent" />
            Áudio (música e efeitos sonoros)
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
            <div className="bg-care-dark rounded-lg px-4 py-3">
              <p className="text-care-muted text-xs mb-1">Música</p>
              <p className="text-care-light font-semibold">
                {audio_events.has_music ? "Sim" : "Não"}
                <span className="text-care-muted text-xs ml-2">
                  ({(audio_events.music_confidence * 100).toFixed(0)}%)
                </span>
              </p>
            </div>
            <div className="bg-care-dark rounded-lg px-4 py-3">
              <p className="text-care-muted text-xs mb-1">Fala</p>
              <p className="text-care-light font-semibold">
                {(audio_events.speech_confidence * 100).toFixed(0)}%
              </p>
            </div>
            <div className="bg-care-dark rounded-lg px-4 py-3">
              <p className="text-care-muted text-xs mb-1">Efeitos sonoros</p>
              <p className="text-care-light font-semibold">
                {audio_events.sound_effects.length}
              </p>
            </div>
          </div>

          {audio_events.sound_effects.length > 0 && (
            <div className="mb-6">
              <h4 className="text-care-muted text-sm font-medium mb-3 flex items-center gap-2">
                <Volume2 className="w-4 h-4" />
                Timeline de SFX detectados
              </h4>
              <div className="space-y-1 max-h-64 overflow-y-auto pr-2">
                {audio_events.sound_effects.map((sfx, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 bg-care-dark rounded-lg px-3 py-2"
                  >
                    <span className="text-care-accent font-mono text-sm min-w-[50px]">
                      {sfx.time}s
                    </span>
                    <span className="text-care-light text-sm flex-1">
                      {sfx.label}
                    </span>
                    <span className="text-care-muted text-xs">
                      {(sfx.score * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {audio_events.sound_effects.length === 0 && (
            <p className="text-care-muted text-sm">
              Nenhum efeito sonoro destacado detectado (só fala/música).
            </p>
          )}
        </div>
      )}

      {audio_events?.error && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
          <p className="text-amber-400 text-sm">
            Análise de áudio: {audio_events.error}
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-care-surface border border-care-border rounded-xl px-4 py-3 flex items-center gap-3">
      <div className="text-care-accent">{icon}</div>
      <div>
        <p className="text-care-muted text-xs">{label}</p>
        <p className="text-care-light font-semibold text-sm">{value}</p>
      </div>
    </div>
  );
}
