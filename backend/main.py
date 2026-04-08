import json
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Care Video Analyzer API")

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
    openai_key: str = Form(...),
    fps: int = Form(3),
):
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

        # Build analysis
        duration = metadata["duration_seconds"]
        cuts_per_min = (len(scenes) / (duration / 60)) if duration > 0 and scenes else 0

        result = {
            "job_id": job_id,
            "metadata": metadata,
            "transcription": transcription,
            "scenes": scenes,
            "frames": frame_names,
            "stats": {
                "total_frames": len(frame_names),
                "total_scenes": len(scenes),
                "cuts_per_minute": round(cuts_per_min, 1),
            },
        }

        # Save result
        with open(job_dir / "result.json", "w") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

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
