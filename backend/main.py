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
    """Convert BSON ObjectId to string for JSON response."""
    if doc and "_id" in doc:
        doc["_id"] = str(doc["_id"])
    if doc and "uploaded_at" in doc and isinstance(doc["uploaded_at"], datetime):
        doc["uploaded_at"] = doc["uploaded_at"].isoformat()
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


# ─── Audio event detection (PANNs) ────────────────────────────────────

_sed_model = None


def get_sed_model():
    """Lazy-load the PANNs sound event detection model."""
    global _sed_model
    if _sed_model is None:
        from panns_inference import SoundEventDetection
        _sed_model = SoundEventDetection(checkpoint_path=None, device="cpu")
    return _sed_model


SPEECH_TERMS = [
    "speech", "conversation", "narration", "monologue",
    "male speech", "female speech", "child speech",
]
MUSIC_TERMS = [
    "music", "soundtrack", "song", "singing", "instrument",
    "guitar", "piano", "drum", "bass", "synthesizer",
    "orchestra", "choir", "rapping",
]


def _is_speech_or_music(label: str) -> bool:
    ll = label.lower()
    return any(t in ll for t in SPEECH_TERMS + MUSIC_TERMS)


def detect_audio_events(video_path: str, output_dir: str) -> dict | None:
    """Detecta música e efeitos sonoros nomeados via PANNs (AudioSet 527 classes)."""
    try:
        import numpy as np
        import librosa
        from panns_inference import labels
    except ImportError as e:
        return {"error": f"panns-inference não disponível: {e}"}

    wav_path = os.path.join(output_dir, "audio_32k.wav")
    cmd = [
        "ffmpeg", "-i", video_path, "-vn", "-ac", "1", "-ar", "32000",
        "-acodec", "pcm_s16le", wav_path, "-y", "-loglevel", "warning",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not os.path.exists(wav_path):
        return None

    try:
        audio, _ = librosa.load(wav_path, sr=32000, mono=True)
    except Exception as e:
        return {"error": f"falha ao carregar áudio: {e}"}

    if len(audio) == 0:
        return None

    try:
        sed = get_sed_model()
        framewise = sed.inference(audio[None, :])[0]  # (time_steps, 527)
    except Exception as e:
        return {"error": f"inferência PANNs falhou: {e}"}

    duration = len(audio) / 32000
    if framewise.shape[0] == 0:
        return None

    time_per_step = duration / framewise.shape[0]
    steps_per_second = max(1, int(round(1.0 / time_per_step)))

    # Aggregate framewise predictions into 1-second windows
    windows = []
    num_windows = max(1, int(np.ceil(duration)))
    for sec in range(num_windows):
        start_step = sec * steps_per_second
        end_step = min((sec + 1) * steps_per_second, framewise.shape[0])
        if end_step <= start_step:
            continue
        window_avg = framewise[start_step:end_step].mean(axis=0)

        top_idx = np.argsort(window_avg)[-5:][::-1]
        events = [
            {"label": labels[i], "score": round(float(window_avg[i]), 3)}
            for i in top_idx
            if window_avg[i] > 0.1
        ]
        windows.append({"start": sec, "events": events})

    # Overall music presence
    music_indices = [i for i, l in enumerate(labels) if "music" in l.lower()]
    music_score = (
        float(framewise[:, music_indices].mean()) if music_indices else 0.0
    )

    # Speech presence
    speech_indices = [
        i for i, l in enumerate(labels) if "speech" in l.lower() or l.lower() == "narration"
    ]
    speech_score = (
        float(framewise[:, speech_indices].mean()) if speech_indices else 0.0
    )

    # Sound effects timeline (exclude speech/music)
    sound_effects = []
    seen = set()
    for w in windows:
        for e in w["events"]:
            if e["score"] > 0.25 and not _is_speech_or_music(e["label"]):
                key = (w["start"], e["label"])
                if key not in seen:
                    seen.add(key)
                    sound_effects.append({
                        "time": w["start"],
                        "label": e["label"],
                        "score": e["score"],
                    })

    # Cleanup temp wav
    try:
        os.remove(wav_path)
    except Exception:
        pass

    return {
        "has_music": music_score > 0.15,
        "music_confidence": round(music_score, 3),
        "speech_confidence": round(speech_score, 3),
        "timeline": windows,
        "sound_effects": sound_effects,
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
    openai_key: str = Form(""),
    fps: int = Form(3),
):
    # Usa env var como fallback
    openai_key = openai_key or os.environ.get("OPENAI_API_KEY", "")
    if video.size and video.size > MAX_FILE_SIZE:
        raise HTTPException(413, "Arquivo muito grande (max 100MB)")

    job_id = str(uuid.uuid4())[:8]
    job_dir = UPLOAD_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    # Save uploaded file
    video_path = str(job_dir / video.filename)
    with open(video_path, "wb") as f:
        content = await video.read()
        f.write(content)

    try:
        # 1. Metadata
        metadata = get_video_metadata(video_path)

        # 2. Extract frames
        frame_names = extract_frames(video_path, str(job_dir), fps=fps)

        # 3. Transcribe
        transcription = None
        if metadata.get("has_audio") and openai_key:
            try:
                transcription = transcribe_audio(video_path, str(job_dir), openai_key)
            except Exception as e:
                transcription = {"error": str(e)}

        # 4. Scene detection
        scenes = detect_scenes(video_path)

        # 5. Audio event detection (music + named SFX)
        audio_events = None
        if metadata.get("has_audio"):
            try:
                audio_events = detect_audio_events(video_path, str(job_dir))
            except Exception as e:
                audio_events = {"error": str(e)}

        # Build analysis
        duration = metadata["duration_seconds"]
        cuts_per_min = (len(scenes) / (duration / 60)) if duration > 0 and scenes else 0
        sfx_count = len(audio_events.get("sound_effects", [])) if audio_events and "error" not in audio_events else 0

        result = {
            "job_id": job_id,
            "metadata": metadata,
            "transcription": transcription,
            "scenes": scenes,
            "frames": frame_names,
            "audio_events": audio_events,
            "stats": {
                "total_frames": len(frame_names),
                "total_scenes": len(scenes),
                "cuts_per_minute": round(cuts_per_min, 1),
                "sound_effects_count": sfx_count,
                "has_music": bool(audio_events and audio_events.get("has_music")),
            },
        }

        # Save result to filesystem (for frame serving)
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
