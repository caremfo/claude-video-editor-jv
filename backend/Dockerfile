FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install torch CPU-only first to avoid pulling the CUDA version (~2GB)
RUN pip install --no-cache-dir torch==2.2.0 --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# PANNs expects both the labels CSV and the model checkpoint to ALREADY
# EXIST when imported — it won't auto-download reliably. Download both
# manually to /root/panns_data (default cache dir).
RUN mkdir -p /root/panns_data && \
    curl -sSL --fail -L \
        "https://raw.githubusercontent.com/qiuqiangkong/audioset_tagging_cnn/master/metadata/class_labels_indices.csv" \
        -o /root/panns_data/class_labels_indices.csv && \
    test -s /root/panns_data/class_labels_indices.csv && \
    curl -sSL --fail -L \
        "https://zenodo.org/record/3987831/files/Cnn14_DecisionLevelMax_mAP%3D0.385.pth?download=1" \
        -o /root/panns_data/Cnn14_DecisionLevelMax.pth && \
    test -s /root/panns_data/Cnn14_DecisionLevelMax.pth

# Validate by running a dummy inference (warms up the model + catches errors)
RUN python -c "import numpy as np; from panns_inference import SoundEventDetection, labels; print(f'Labels loaded: {len(labels)}'); sed = SoundEventDetection(device='cpu'); sed.inference(np.zeros((1, 32000), dtype=np.float32)); print('PANNs pre-download complete')"

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
