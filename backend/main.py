import json
import os
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from bson import ObjectId
from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from motor.motor_asyncio import AsyncIOMotorClient

app = FastAPI(title="Care Video Analyzer API")

# ─── MongoDB ──────────────────────────────────────────────────────────

MONGODB_URI = os.environ.get("MONGODB_URI", "")
DB_NAME = os.environ.get("DB_NAME", "care_video_analyzer")

mongo_client: Optional[AsyncIOMotorClient] = None
db = None


@app.on_event("startup")
async def startup_db():
    global mongo_client, db
    if MONGODB_URI:
        mongo_client = AsyncIOMotorClient(MONGODB_URI)
        db = mongo_client[DB_NAME]
        # Create indexes
        try:
            await db.videos.create_index("uploaded_at")
            await db.videos.create_index("category")
            await db.videos.create_index("tags")
            await db.videos.create_index("creator")
        except Exception:
            pass


@app.on_event("shutdown")
async def shutdown_db():
    if mongo_client:
        mongo_client.close()


def _serialize_doc(doc: dict) -> dict:
    """Convert BSON ObjectId and datetimes to JSON-safe values recursively."""
    if not doc:
        return doc
    if "_id" in doc:
        doc["_id"] = str(doc["_id"])
    for key, value in list(doc.items()):
        if isinstance(value, datetime):
            doc[key] = value.isoformat()
    return doc


ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS", "http://localhost:5173"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("/tmp/video-analyzer")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB


# ─── Helpers ──────────────────────────────────────────────────────────

def get_video_metadata(video_path: str) -> dict:
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", video_path,
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

    fps_str = video_stream.get("r_frame_rate", "30/1")
    parts = fps_str.split("/")
    fps = int(parts[0]) / int(parts[1]) if len(parts) == 2 and int(parts[1]) != 0 else 30

    return {
        "duration_seconds": round(duration, 2),
        "width": int(video_stream.get("width", 0)),
        "height": int(video_stream.get("height", 0)),
        "fps": round(fps, 2),
        "codec": video_stream.get("codec_name", "unknown"),
        "has_audio": audio_stream is not None,
        "file_size_mb": round(int(fmt.get("size", 0)) / 1024 / 1024, 2),
    }


def extract_frames(video_path: str, output_dir: str, fps: int = 3) -> list[str]:
    frames_dir = os.path.join(output_dir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    cmd = [
        "ffmpeg", "-i", video_path, "-vf", f"fps={fps}",
        "-q:v", "2", os.path.join(frames_dir, "frame_%04d.jpg"),
        "-y", "-loglevel", "warning",
    ]
    subprocess.run(cmd, check=True)
    frames = sorted(Path(frames_dir).glob("frame_*.jpg"))
    return [f.name for f in frames]


def transcribe_audio(video_path: str, output_dir: str, openai_key: str) -> dict | None:
    from openai import OpenAI

    audio_path = os.path.join(output_dir, "audio.mp3")
    cmd = [
        "ffmpeg", "-i", video_path, "-vn", "-acodec", "libmp3lame",
        "-q:a", "4", audio_path, "-y", "-loglevel", "warning",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not os.path.exists(audio_path):
        return None

    client = OpenAI(api_key=openai_key)
    with open(audio_path, "rb") as f:
        transcript = client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            response_format="verbose_json",
            timestamp_granularities=["segment"],
            language="pt",
        )

    return {
        "text": transcript.text,
        "language": transcript.language,
        "segments": [
            {"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
            for s in (transcript.segments or [])
        ],
    }


def detect_scenes(video_path: str) -> list[dict]:
    try:
        from scenedetect import SceneManager, open_video
        from scenedetect.detectors import ContentDetector
    except ImportError:
        return []

    video = open_video(video_path)
    sm = SceneManager()
    sm.add_detector(ContentDetector(threshold=27.0))
    sm.detect_scenes(video)

    return [
        {
            "scene": i + 1,
            "start": round(start.get_seconds(), 2),
            "end": round(end.get_seconds(), 2),
            "duration": round(end.get_seconds() - start.get_seconds(), 2),
        }
        for i, (start, end) in enumerate(sm.get_scene_list())
    ]


# ─── Endpoints ────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/analyze")
async def analyze_video(
    video: UploadFile = File(...),
    fps: int = Form(3),
):
    """
    Recebe um vídeo, extrai frames e áudio, transcreve via Whisper,
    detecta cortes de cena e persiste no Mongo.

    Sem PANNs (audio events) — a detecção de música/SFX foi removida
    porque consome ~1 GB de RAM e estourava o B1.
    """
    if video.size and video.size > MAX_FILE_SIZE:
        raise HTTPException(413, "Arquivo muito grande (max 100MB)")

    job_id = str(uuid.uuid4())[:8]
    job_dir = UPLOAD_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    video_path = str(job_dir / video.filename)
    with open(video_path, "wb") as f:
        content = await video.read()
        f.write(content)

    try:
        # 1. Metadata
        metadata = get_video_metadata(video_path)

        # 2. Extract frames
        frame_names = extract_frames(video_path, str(job_dir), fps=fps)

        # 3. Transcribe via Whisper API
        transcription = None
        openai_key = os.environ.get("OPENAI_API_KEY", "")
        if metadata.get("has_audio") and openai_key:
            try:
                transcription = transcribe_audio(video_path, str(job_dir), openai_key)
            except Exception as e:
                transcription = {"error": str(e)}

        # 4. Scene detection
        scenes = detect_scenes(video_path)

        # Build result
        duration = metadata["duration_seconds"]
        cuts_per_min = (len(scenes) / (duration / 60)) if duration > 0 and scenes else 0

        result = {
            "job_id": job_id,
            "metadata": metadata,
            "transcription": transcription,
            "scenes": scenes,
            "frames": frame_names,
            "audio_events": None,  # removido — consumia muita RAM
            "stats": {
                "total_frames": len(frame_names),
                "total_scenes": len(scenes),
                "cuts_per_minute": round(cuts_per_min, 1),
                "sound_effects_count": 0,
                "has_music": False,
            },
        }

        with open(job_dir / "result.json", "w") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        # Persist to MongoDB
        if db is not None:
            doc = {
                **result,
                "filename": video.filename,
                "uploaded_at": datetime.utcnow(),
                "category": "reference",
                "tags": [],
                "creator": None,
                "topic": None,
                "notes": None,
            }
            try:
                insert_res = await db.videos.insert_one(doc)
                result["_id"] = str(insert_res.inserted_id)
                result["persisted"] = True
            except Exception as e:
                result["persisted"] = False
                result["persist_error"] = str(e)
        else:
            result["persisted"] = False

        return result

    except Exception as e:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(500, f"Erro ao processar vídeo: {str(e)}")


@app.get("/api/frames/{job_id}/{frame_name}")
async def get_frame(job_id: str, frame_name: str):
    frame_path = UPLOAD_DIR / job_id / "frames" / frame_name
    if not frame_path.exists():
        raise HTTPException(404, "Frame não encontrado")
    return FileResponse(frame_path, media_type="image/jpeg")


@app.get("/api/result/{job_id}")
async def get_result(job_id: str):
    result_path = UPLOAD_DIR / job_id / "result.json"
    if not result_path.exists():
        raise HTTPException(404, "Análise não encontrada")
    with open(result_path) as f:
        return json.load(f)


@app.delete("/api/cleanup/{job_id}")
async def cleanup(job_id: str):
    job_dir = UPLOAD_DIR / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir)
    return {"status": "cleaned"}


# ─── Library endpoints (MongoDB-backed) ───────────────────────────────

@app.get("/api/library")
async def list_library(category: str | None = None, creator: str | None = None):
    """Lista todas as análises persistidas, mais recentes primeiro."""
    if db is None:
        raise HTTPException(503, "MongoDB não configurado")

    query: dict = {}
    if category:
        query["category"] = category
    if creator:
        query["creator"] = creator

    projection = {
        "filename": 1,
        "uploaded_at": 1,
        "category": 1,
        "tags": 1,
        "creator": 1,
        "topic": 1,
        "notes": 1,
        "job_id": 1,
        "metadata.duration_seconds": 1,
        "metadata.width": 1,
        "metadata.height": 1,
        "stats": 1,
    }

    cursor = db.videos.find(query, projection).sort("uploaded_at", -1).limit(500)
    items = []
    async for doc in cursor:
        items.append(_serialize_doc(doc))
    return {"items": items, "count": len(items)}


@app.get("/api/library/{item_id}")
async def get_library_item(item_id: str):
    """Retorna a análise completa de um item da biblioteca."""
    if db is None:
        raise HTTPException(503, "MongoDB não configurado")

    try:
        oid = ObjectId(item_id)
    except Exception:
        raise HTTPException(400, "ID inválido")

    doc = await db.videos.find_one({"_id": oid})
    if not doc:
        raise HTTPException(404, "Não encontrado")

    return _serialize_doc(doc)


@app.patch("/api/library/{item_id}")
async def update_library_item(item_id: str, updates: dict = Body(...)):
    """Atualiza metadados editáveis (tags, creator, topic, notes, category)."""
    if db is None:
        raise HTTPException(503, "MongoDB não configurado")

    try:
        oid = ObjectId(item_id)
    except Exception:
        raise HTTPException(400, "ID inválido")

    allowed = {"tags", "creator", "topic", "notes", "category"}
    filtered = {k: v for k, v in updates.items() if k in allowed}

    if not filtered:
        raise HTTPException(400, "Nenhum campo válido para atualizar")

    result = await db.videos.update_one({"_id": oid}, {"$set": filtered})
    if result.matched_count == 0:
        raise HTTPException(404, "Não encontrado")

    return {"updated": True, "fields": list(filtered.keys())}


# ─── Visual frame description (Claude Vision) ────────────────────────

def _select_representative_frames(
    scenes: list[dict], frames: list[str], fps: int = 3
) -> list[tuple[int, str]]:
    """
    Para cada cena, escolhe o frame do meio como representativo.
    Se não há cenas, amostra 6 frames uniformemente.
    Retorna lista de (scene_num, frame_filename).
    """
    total = len(frames)
    if total == 0:
        return []

    if not scenes:
        sample_count = min(6, total)
        step = max(1, total // sample_count)
        return [
            (i + 1, frames[min(i * step, total - 1)])
            for i in range(sample_count)
        ]

    result = []
    for s in scenes:
        middle_time = (s["start"] + s["end"]) / 2
        # frames are extracted at `fps` fps, numbered starting at 1
        frame_idx = min(int(middle_time * fps), total - 1)
        result.append((s["scene"], frames[frame_idx]))
    return result


async def describe_frames_with_claude(
    job_dir: Path,
    scenes: list,
    frames: list[str],
    transcription: dict | None,
    api_key: str,
) -> list[dict]:
    """Chama Claude Vision para descrever frames-chave em contexto."""
    import base64
    from anthropic import AsyncAnthropic

    representatives = _select_representative_frames(scenes, frames, fps=3)
    if not representatives:
        return []

    # Build transcript text
    transcript_text = ""
    if transcription and transcription.get("segments"):
        transcript_text = "\n".join(
            f"[{s['start']:.1f}s - {s['end']:.1f}s] {s['text']}"
            for s in transcription["segments"]
        )
    else:
        transcript_text = "Sem transcrição disponível."

    # Build content blocks
    content_blocks: list[dict] = [
        {
            "type": "text",
            "text": (
                "Você é um analista de vídeos curtos (Reels/Shorts) especialista em identificar "
                "padrões de edição e composição visual que fazem conteúdo performar.\n\n"
                "Vou te enviar frames representativos de um vídeo, um por cena (o frame do meio de "
                "cada cena detectada). Junto com cada imagem, você tem a transcrição completa do "
                "áudio com timestamps, para você correlacionar o visual com o que está sendo dito.\n\n"
                "Sua tarefa: para cada frame, descrever de forma específica e concreta o que está "
                "sendo mostrado e POR QUE faz sentido naquele ponto do roteiro. Evite descrições "
                "genéricas — seja direto sobre os elementos visuais concretos.\n\n"
                f"Transcrição completa:\n{transcript_text}\n\n"
                "Retorne APENAS um array JSON válido (sem markdown, sem comentários, sem texto "
                "antes ou depois), com um objeto por frame, nesta estrutura exata:\n\n"
                "[\n"
                "  {\n"
                '    "scene": 1,\n'
                '    "shot_type": "close-up | medium | wide | extreme-wide",\n'
                '    "subject_type": "talking_head | b_roll | text_card | graphic | mixed",\n'
                '    "subject": "descrição específica do que aparece (pessoa, objeto, cena, gráfico)",\n'
                '    "visual_elements": ["texto na tela: \'FRASE EXATA\'", "seta amarela apontando", "logo no canto"],\n'
                '    "composition": "enquadramento, iluminação, paleta de cores, mood geral",\n'
                '    "script_alignment": "como este visual reforça ou ilustra o que está sendo dito neste momento",\n'
                '    "purpose": "hook | explanation | example | emphasis | b_roll_illustrative | cta | transition"\n'
                "  }\n"
                "]"
            ),
        }
    ]

    for scene_num, frame_file in representatives:
        frame_path = job_dir / "frames" / frame_file
        if not frame_path.exists():
            continue
        with open(frame_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode()

        content_blocks.append({
            "type": "text",
            "text": f"\n=== Cena {scene_num} ===",
        })
        content_blocks.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": img_b64,
            },
        })

    client = AsyncAnthropic(api_key=api_key)
    message = await client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=16384,
        messages=[{"role": "user", "content": content_blocks}],
    )

    text = message.content[0].text.strip()
    # Strip markdown fences if Claude added them
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[-1].strip().startswith("```"):
            lines = lines[1:-1]
        else:
            lines = lines[1:]
        text = "\n".join(lines).strip()

    # Try full parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Fallback: attempt to recover complete objects from a truncated JSON array
    recovered = _recover_partial_json_array(text)
    if recovered is not None:
        return recovered

    return [
        {
            "error": "Falha ao parsear JSON da resposta",
            "raw_response": text[:3000],
        }
    ]


def _recover_partial_json_array(text: str) -> list[dict] | None:
    """
    Se a resposta foi cortada no meio de um objeto, tenta recuperar os
    objetos completos já recebidos fechando o array no último `}` válido
    no topo do array.
    """
    depth = 0
    in_string = False
    escape = False
    last_complete = -1

    for i, ch in enumerate(text):
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 1:  # fechou um objeto dentro do array
                last_complete = i

    if last_complete <= 0:
        return None

    candidate = text[: last_complete + 1] + "]"
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        return None


@app.post("/api/library/{item_id}/describe-visuals")
async def describe_visuals(item_id: str):
    """Gera descrições visuais via Claude Vision e salva no documento."""
    if db is None:
        raise HTTPException(503, "MongoDB não configurado")

    try:
        oid = ObjectId(item_id)
    except Exception:
        raise HTTPException(400, "ID inválido")

    doc = await db.videos.find_one({"_id": oid})
    if not doc:
        raise HTTPException(404, "Não encontrado")

    job_dir = UPLOAD_DIR / doc["job_id"]
    if not job_dir.exists() or not (job_dir / "frames").exists():
        raise HTTPException(
            410,
            "Frames não estão mais disponíveis no container. "
            "Re-faça upload do vídeo para gerar descrições visuais.",
        )

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY não configurada")

    try:
        descriptions = await describe_frames_with_claude(
            job_dir=job_dir,
            scenes=doc.get("scenes", []),
            frames=doc.get("frames", []),
            transcription=doc.get("transcription"),
            api_key=api_key,
        )
    except Exception as e:
        raise HTTPException(500, f"Erro ao chamar Claude: {str(e)}")

    await db.videos.update_one(
        {"_id": oid},
        {
            "$set": {
                "visual_descriptions": descriptions,
                "visual_described_at": datetime.utcnow(),
            }
        },
    )

    return {
        "descriptions": descriptions,
        "count": len(descriptions),
    }


# ─── Style Bible (cross-video pattern extraction) ────────────────────

def _format_video_for_bible(doc: dict, idx: int) -> str:
    """Serializa um vídeo em texto estruturado para o prompt do bible."""
    parts = [f"\n=== VÍDEO {idx}: {doc.get('filename', 'sem nome')} ==="]

    if doc.get("creator"):
        parts.append(f"Creator: {doc['creator']}")
    if doc.get("topic"):
        parts.append(f"Tema: {doc['topic']}")
    if doc.get("tags"):
        parts.append(f"Tags: {', '.join(doc['tags'])}")
    if doc.get("notes"):
        parts.append(f"Notas: {doc['notes']}")

    meta = doc.get("metadata", {})
    parts.append(
        f"Duração: {meta.get('duration_seconds', 0)}s | "
        f"Resolução: {meta.get('width', 0)}x{meta.get('height', 0)}"
    )

    scenes = doc.get("scenes", [])
    if scenes:
        parts.append(f"\nCortes detectados ({len(scenes)} cenas):")
        for s in scenes:
            parts.append(
                f"  Cena {s['scene']}: {s['start']}s → {s['end']}s (duração {s['duration']}s)"
            )

    transcription = doc.get("transcription")
    if transcription and transcription.get("segments"):
        parts.append("\nTranscrição (com timestamps):")
        for seg in transcription["segments"]:
            parts.append(f"  [{seg['start']:.1f}s-{seg['end']:.1f}s] {seg['text']}")

    audio = doc.get("audio_events")
    if audio and not audio.get("error"):
        parts.append(
            f"\nÁudio: música={'sim' if audio.get('has_music') else 'não'} "
            f"(confiança {audio.get('music_confidence', 0)})"
        )
        sfx = audio.get("sound_effects", [])
        if sfx:
            parts.append("Efeitos sonoros detectados:")
            for e in sfx:
                parts.append(f"  {e['time']}s: {e['label']} ({e['score']})")

    visuals = doc.get("visual_descriptions", [])
    if visuals:
        parts.append("\nAnálise visual cena a cena:")
        for v in visuals:
            if v.get("error"):
                continue
            header = f"  Cena {v.get('scene', '?')}"
            tags_info = []
            if v.get("shot_type"):
                tags_info.append(v["shot_type"])
            if v.get("subject_type"):
                tags_info.append(v["subject_type"])
            if v.get("purpose"):
                tags_info.append(v["purpose"])
            if tags_info:
                header += f" ({', '.join(tags_info)})"
            parts.append(header + ":")
            if v.get("subject"):
                parts.append(f"    • O que aparece: {v['subject']}")
            if v.get("visual_elements"):
                parts.append(
                    f"    • Elementos na tela: {'; '.join(v['visual_elements'])}"
                )
            if v.get("composition"):
                parts.append(f"    • Composição: {v['composition']}")
            if v.get("script_alignment"):
                parts.append(
                    f"    • Alinhamento com roteiro: {v['script_alignment']}"
                )

    return "\n".join(parts)


async def build_style_bible(
    video_docs: list[dict],
    api_key: str,
) -> dict:
    """Gera o style bible cruzando N vídeos via Claude Sonnet 4.5."""
    from anthropic import AsyncAnthropic

    videos_formatted = "\n\n".join(
        _format_video_for_bible(doc, idx)
        for idx, doc in enumerate(video_docs, 1)
    )

    prompt = f"""Você é um analista de vídeos curtos (Reels/Shorts) especialista em identificar padrões de edição, composição visual e ritmo. Vou te mostrar {len(video_docs)} vídeos de referência e sua tarefa é extrair a "receita" VISUAL E RÍTMICA que o creator usa de forma consistente.

REGRAS CRÍTICAS:
1. NÃO faça análise de estrutura de roteiro. O usuário escreve seus próprios roteiros e o conhecimento do negócio dele não está aqui. Foque em FORMA, não em conteúdo.
2. Busque padrões CONTEXTUAIS, nunca métricas mecânicas. RUIM: "cortes a cada 4 segundos". BOM: "cortes secos entram imediatamente após uma afirmação forte".
3. Seja CONCRETO e ACIONÁVEL. Cada padrão deve ser aplicável de forma consciente na edição de um novo vídeo.
4. Se um padrão aparece em pelo menos 60% dos vídeos, inclua. Se aparece em menos, ignore — é ruído.
5. Se uma categoria não tem padrões claros nesses vídeos, deixe o array `patterns` vazio. Não invente.

Aqui estão os {len(video_docs)} vídeos com todos os dados extraídos (cortes, transcrição, áudio, análise visual frame-a-frame correlacionada com a fala):

{videos_formatted}

Analise o conjunto e retorne APENAS um objeto JSON válido (sem markdown, sem comentários antes ou depois, sem ```json) com este schema exato:

{{
  "overview": "Parágrafo curto (2-3 frases) caracterizando o estilo visual e rítmico geral desse pacote de vídeos.",
  "cuts_and_rhythm": {{
    "description": "Como os cortes se comportam em relação ao que está sendo dito (nunca em segundos absolutos).",
    "patterns": [
      "Padrão 1 observado consistentemente",
      "Padrão 2"
    ]
  }},
  "b_roll_patterns": {{
    "description": "Como e quando b-rolls entram em relação ao roteiro.",
    "patterns": ["..."]
  }},
  "audio_patterns": {{
    "description": "Como música e efeitos sonoros são usados — onde entram SFX, se música é contínua ou pontual, quais tipos de SFX recorrem.",
    "patterns": ["..."]
  }},
  "visual_composition": {{
    "description": "Estilo visual predominante — tipos de plano, paleta de cores, iluminação, mood geral.",
    "patterns": ["..."]
  }},
  "text_on_screen": {{
    "description": "Como texto aparece na tela e se relaciona com a fala.",
    "patterns": ["..."]
  }},
  "contextual_rules": [
    "Regra acionável 1 no formato 'faça X quando Y acontecer'",
    "Regra acionável 2",
    "..."
  ],
  "summary": "Parágrafo final sintetizando os 3-5 insights mais úteis para replicar esse estilo de forma consciente em novos vídeos."
}}"""

    client = AsyncAnthropic(api_key=api_key)
    message = await client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=8192,
        messages=[{"role": "user", "content": prompt}],
    )

    text = message.content[0].text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[-1].strip().startswith("```"):
            lines = lines[1:-1]
        else:
            lines = lines[1:]
        text = "\n".join(lines).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        return {
            "error": "Falha ao parsear JSON da resposta",
            "detail": str(e),
            "raw_response": text[:5000],
        }


@app.post("/api/style-bibles")
async def create_style_bible(payload: dict = Body(...)):
    """Gera um style bible cruzando N vídeos selecionados."""
    if db is None:
        raise HTTPException(503, "MongoDB não configurado")

    name = (payload.get("name") or "").strip()
    video_ids = payload.get("video_ids") or []

    if not name:
        raise HTTPException(400, "Nome obrigatório")
    if len(video_ids) < 2:
        raise HTTPException(400, "Selecione pelo menos 2 vídeos")

    try:
        oids = [ObjectId(vid) for vid in video_ids]
    except Exception:
        raise HTTPException(400, "ID(s) inválido(s)")

    video_docs = []
    async for doc in db.videos.find({"_id": {"$in": oids}}):
        video_docs.append(doc)

    if len(video_docs) != len(video_ids):
        raise HTTPException(
            404, f"Apenas {len(video_docs)} de {len(video_ids)} vídeos encontrados"
        )

    missing = [
        doc.get("filename", "?")
        for doc in video_docs
        if not doc.get("visual_descriptions")
        or (
            isinstance(doc.get("visual_descriptions"), list)
            and len(doc["visual_descriptions"]) > 0
            and doc["visual_descriptions"][0].get("error")
        )
    ]
    if missing:
        raise HTTPException(
            400,
            "Os seguintes vídeos não têm descrições visuais válidas: "
            + ", ".join(missing)
            + ". Gere as descrições visuais antes de criar o bible.",
        )

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY não configurada")

    try:
        bible_content = await build_style_bible(video_docs, api_key)
    except Exception as e:
        raise HTTPException(500, f"Erro ao gerar bible: {str(e)}")

    bible_doc = {
        "name": name,
        "created_at": datetime.utcnow(),
        "source_video_ids": oids,
        "source_count": len(video_docs),
        "source_filenames": [d.get("filename") for d in video_docs],
        "content": bible_content,
    }

    result = await db.style_bibles.insert_one(bible_doc)
    bible_doc["_id"] = str(result.inserted_id)
    bible_doc["source_video_ids"] = [str(oid) for oid in oids]
    _serialize_doc(bible_doc)

    return bible_doc


@app.get("/api/style-bibles")
async def list_style_bibles():
    """Lista todas os style bibles gerados."""
    if db is None:
        raise HTTPException(503, "MongoDB não configurado")

    cursor = db.style_bibles.find(
        {},
        {
            "name": 1,
            "created_at": 1,
            "source_count": 1,
            "source_filenames": 1,
        },
    ).sort("created_at", -1)

    items = []
    async for doc in cursor:
        items.append(_serialize_doc(doc))
    return {"items": items, "count": len(items)}


@app.get("/api/style-bibles/{bible_id}")
async def get_style_bible(bible_id: str):
    """Retorna um style bible completo."""
    if db is None:
        raise HTTPException(503, "MongoDB não configurado")

    try:
        oid = ObjectId(bible_id)
    except Exception:
        raise HTTPException(400, "ID inválido")

    doc = await db.style_bibles.find_one({"_id": oid})
    if not doc:
        raise HTTPException(404, "Não encontrado")

    doc["source_video_ids"] = [
        str(vid) for vid in doc.get("source_video_ids", [])
    ]
    return _serialize_doc(doc)


@app.delete("/api/style-bibles/{bible_id}")
async def delete_style_bible(bible_id: str):
    """Remove um style bible."""
    if db is None:
        raise HTTPException(503, "MongoDB não configurado")

    try:
        oid = ObjectId(bible_id)
    except Exception:
        raise HTTPException(400, "ID inválido")

    result = await db.style_bibles.delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise HTTPException(404, "Não encontrado")
    return {"deleted": True}


@app.delete("/api/library/{item_id}")
async def delete_library_item(item_id: str):
    """Remove item da biblioteca e limpa arquivos associados."""
    if db is None:
        raise HTTPException(503, "MongoDB não configurado")

    try:
        oid = ObjectId(item_id)
    except Exception:
        raise HTTPException(400, "ID inválido")

    doc = await db.videos.find_one({"_id": oid}, {"job_id": 1})
    if not doc:
        raise HTTPException(404, "Não encontrado")

    # Limpa filesystem se ainda existir
    if doc.get("job_id"):
        job_dir = UPLOAD_DIR / doc["job_id"]
        shutil.rmtree(job_dir, ignore_errors=True)

    await db.videos.delete_one({"_id": oid})
    return {"deleted": True}
