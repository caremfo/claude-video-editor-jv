#!/usr/bin/env python3
"""
Care Video Analyzer
Extrai frames, transcrição, cortes de cena e metadados de vídeos curtos (Reels/Shorts).
Gera uma pasta de output pronta para análise pelo Claude Code.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def get_video_metadata(video_path: str) -> dict:
    """Extrai metadados do vídeo com ffprobe."""
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", video_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    data = json.loads(result.stdout)

    video_stream = next(
        (s for s in data.get("streams", []) if s["codec_type"] == "video"), {}
    )
    audio_stream = next(
        (s for s in data.get("streams", []) if s["codec_type"] == "audio"), None
    )
    fmt = data.get("format", {})

    duration = float(fmt.get("duration", 0))
    return {
        "duration_seconds": round(duration, 2),
        "width": int(video_stream.get("width", 0)),
        "height": int(video_stream.get("height", 0)),
        "fps": eval(video_stream.get("r_frame_rate", "30/1")),
        "codec": video_stream.get("codec_name", "unknown"),
        "has_audio": audio_stream is not None,
        "file_size_mb": round(int(fmt.get("size", 0)) / 1024 / 1024, 2),
        "aspect_ratio": f"{video_stream.get('width', 0)}:{video_stream.get('height', 0)}",
    }


def extract_frames(video_path: str, output_dir: str, fps: int = 3) -> list[str]:
    """Extrai frames do vídeo. Para Reels/Shorts, 3 fps captura bem os cortes."""
    frames_dir = os.path.join(output_dir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    cmd = [
        "ffmpeg", "-i", video_path, "-vf", f"fps={fps}",
        "-q:v", "2",  # alta qualidade JPEG
        os.path.join(frames_dir, "frame_%04d.jpg"),
        "-y", "-loglevel", "warning"
    ]
    subprocess.run(cmd, check=True)

    frames = sorted(Path(frames_dir).glob("frame_*.jpg"))
    print(f"  -> {len(frames)} frames extraídos ({fps} fps)")
    return [str(f) for f in frames]


def extract_and_transcribe(video_path: str, output_dir: str) -> dict | None:
    """Extrai áudio e transcreve com Whisper API da OpenAI."""
    from openai import OpenAI

    audio_path = os.path.join(output_dir, "audio.mp3")

    # Extrai áudio
    cmd = [
        "ffmpeg", "-i", video_path, "-vn", "-acodec", "libmp3lame",
        "-q:a", "4", audio_path, "-y", "-loglevel", "warning"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not os.path.exists(audio_path):
        print("  -> Vídeo sem áudio, pulando transcrição")
        return None

    # Transcreve com Whisper API
    print("  -> Transcrevendo com Whisper API...")
    client = OpenAI()

    with open(audio_path, "rb") as f:
        transcript = client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            response_format="verbose_json",
            timestamp_granularities=["segment", "word"],
            language="pt",
        )

    result = {
        "text": transcript.text,
        "language": transcript.language,
        "segments": [
            {
                "start": round(s.start, 2),
                "end": round(s.end, 2),
                "text": s.text.strip(),
            }
            for s in (transcript.segments or [])
        ],
    }

    # Salva transcrição
    transcript_path = os.path.join(output_dir, "transcription.json")
    with open(transcript_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    transcript_txt = os.path.join(output_dir, "transcription.txt")
    with open(transcript_txt, "w", encoding="utf-8") as f:
        for seg in result["segments"]:
            f.write(f"[{seg['start']:.1f}s - {seg['end']:.1f}s] {seg['text']}\n")

    print(f"  -> Transcrição: {len(result['segments'])} segmentos")
    return result


def detect_scenes(video_path: str, output_dir: str) -> list[dict]:
    """Detecta cortes de cena usando PySceneDetect."""
    try:
        from scenedetect import open_video, SceneManager
        from scenedetect.detectors import ContentDetector
    except ImportError:
        print("  -> scenedetect não instalado, pulando detecção de cenas")
        return []

    video = open_video(video_path)
    scene_manager = SceneManager()
    scene_manager.add_detector(ContentDetector(threshold=27.0))
    scene_manager.detect_scenes(video)

    scenes = []
    for i, (start, end) in enumerate(scene_manager.get_scene_list()):
        scenes.append({
            "scene": i + 1,
            "start": round(start.get_seconds(), 2),
            "end": round(end.get_seconds(), 2),
            "duration": round(end.get_seconds() - start.get_seconds(), 2),
        })

    scenes_path = os.path.join(output_dir, "scenes.json")
    with open(scenes_path, "w", encoding="utf-8") as f:
        json.dump(scenes, f, ensure_ascii=False, indent=2)

    print(f"  -> {len(scenes)} cenas detectadas")
    return scenes


def generate_summary(output_dir: str, metadata: dict, transcription: dict | None,
                     scenes: list[dict], frames: list[str]) -> str:
    """Gera o arquivo de resumo para o Claude analisar."""
    summary_path = os.path.join(output_dir, "analysis_prompt.md")

    duration = metadata["duration_seconds"]
    cuts_per_min = (len(scenes) / (duration / 60)) if duration > 0 and scenes else 0

    lines = [
        "# Análise de Vídeo — Dados Extraídos",
        "",
        "## Metadados",
        f"- Duração: {duration}s",
        f"- Resolução: {metadata['width']}x{metadata['height']} ({metadata['aspect_ratio']})",
        f"- FPS: {metadata['fps']}",
        f"- Codec: {metadata['codec']}",
        f"- Tamanho: {metadata['file_size_mb']} MB",
        "",
        "## Cortes de Cena",
        f"- Total de cenas: {len(scenes)}",
        f"- Ritmo: {cuts_per_min:.1f} cortes/minuto",
        "",
    ]

    if scenes:
        lines.append("| Cena | Início | Fim | Duração |")
        lines.append("|------|--------|-----|---------|")
        for s in scenes:
            lines.append(f"| {s['scene']} | {s['start']}s | {s['end']}s | {s['duration']}s |")
        lines.append("")

    lines.append("## Transcrição")
    if transcription:
        lines.append(f"- Idioma: {transcription.get('language', 'N/A')}")
        lines.append(f"- Segmentos: {len(transcription.get('segments', []))}")
        lines.append("")
        lines.append("```")
        for seg in transcription.get("segments", []):
            lines.append(f"[{seg['start']:.1f}s - {seg['end']:.1f}s] {seg['text']}")
        lines.append("```")
    else:
        lines.append("- Sem áudio / transcrição não disponível")
    lines.append("")

    lines.append("## Frames Extraídos")
    lines.append(f"- Total: {len(frames)} frames")
    lines.append(f"- Pasta: {os.path.join(output_dir, 'frames')}")
    lines.append("")

    lines.extend([
        "---",
        "",
        "## O que analisar nos frames (peça ao Claude Code):",
        "",
        "Abra este diretório no Claude Code e peça:",
        "",
        "```",
        f"Analise o vídeo extraído em {output_dir}.",
        "Leia o analysis_prompt.md e depois analise os frames na pasta frames/.",
        "Para cada aspecto, me diga:",
        "",
        "1. ROTEIRO: Estrutura do texto falado (hook, desenvolvimento, CTA). O que prende atenção?",
        "2. EDIÇÃO: Ritmo dos cortes, tipo de transições entre cenas, zooms/movimentos de câmera.",
        "3. TEXTO NA TELA: Que textos aparecem? Onde ficam posicionados? Qual fonte/estilo?",
        "4. COMPOSIÇÃO VISUAL: Enquadramento (close, meio corpo), cores dominantes, iluminação, cenário.",
        "5. ELEMENTOS REPLICÁVEIS: Lista prática do que posso aplicar nos meus vídeos.",
        "```",
    ])

    content = "\n".join(lines)
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(content)

    return summary_path


def main():
    parser = argparse.ArgumentParser(description="Analisa vídeo para o Claude Code")
    parser.add_argument("video", help="Caminho do arquivo de vídeo")
    parser.add_argument("-o", "--output", help="Pasta de output (default: auto)", default=None)
    parser.add_argument("--fps", type=int, default=3, help="Frames por segundo a extrair (default: 3)")
    parser.add_argument("--no-transcribe", action="store_true", help="Pula transcrição de áudio")
    args = parser.parse_args()

    video_path = os.path.abspath(args.video)
    if not os.path.exists(video_path):
        print(f"Erro: arquivo não encontrado: {video_path}")
        sys.exit(1)

    # Pasta de output
    video_name = Path(video_path).stem
    output_dir = args.output or os.path.join(
        os.path.dirname(video_path), f"analysis_{video_name}"
    )
    os.makedirs(output_dir, exist_ok=True)

    print(f"\n🎬 Analisando: {video_path}")
    print(f"📁 Output: {output_dir}\n")

    # 1. Metadados
    print("[1/4] Extraindo metadados...")
    metadata = get_video_metadata(video_path)
    meta_path = os.path.join(output_dir, "metadata.json")
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"  -> {metadata['duration_seconds']}s, {metadata['width']}x{metadata['height']}, {metadata['fps']} fps")

    # 2. Frames
    print("[2/4] Extraindo frames...")
    frames = extract_frames(video_path, output_dir, fps=args.fps)

    # 3. Transcrição
    print("[3/4] Processando áudio...")
    transcription = None
    if not args.no_transcribe and metadata.get("has_audio"):
        transcription = extract_and_transcribe(video_path, output_dir)
    elif not metadata.get("has_audio"):
        print("  -> Vídeo sem trilha de áudio")
    else:
        print("  -> Transcrição desabilitada (--no-transcribe)")

    # 4. Detecção de cenas
    print("[4/4] Detectando cortes de cena...")
    scenes = detect_scenes(video_path, output_dir)

    # Resumo
    print("\nGerando resumo...")
    summary_path = generate_summary(output_dir, metadata, transcription, scenes, frames)

    print(f"\n✅ Análise completa!")
    print(f"📄 Resumo: {summary_path}")
    print(f"🖼️  Frames: {os.path.join(output_dir, 'frames')} ({len(frames)} imagens)")
    if transcription:
        print(f"🎙️  Transcrição: {os.path.join(output_dir, 'transcription.txt')}")
    print(f"\n💡 Agora abra o Claude Code nesta pasta e peça para analisar!")
    print(f"   Exemplo: 'Leia {summary_path} e analise os frames em {output_dir}/frames/'")


if __name__ == "__main__":
    main()
