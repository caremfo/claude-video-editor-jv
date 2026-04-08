import { useState } from "react";
import type { AnalysisResult } from "../App";
import {
  Clock,
  Scissors,
  FileText,
  Image,
  Monitor,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

type Props = {
  result: AnalysisResult;
  apiBase: string;
};

export function Analysis({ result, apiBase }: Props) {
  const { metadata, transcription, scenes, frames, stats } = result;
  const [currentFrame, setCurrentFrame] = useState(0);

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
