import logging
import sys
import time
from pathlib import Path
import yaml

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from src.output.server import FrameStore, EventStore, AIConfigStore, run_server

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("mock_backend")

def load_config(project_root: Path):
    proto_root = project_root / "backend"
    with open(proto_root / "configs" / "streams.yaml", "r", encoding="utf-8") as f:
        streams_cfg = yaml.safe_load(f)
    with open(proto_root / "configs" / "pipeline.yaml", "r", encoding="utf-8") as f:
        pipeline_cfg = yaml.safe_load(f)
    return streams_cfg, pipeline_cfg

def main():
    logger.info("=" * 60)
    logger.info("  AI SURVEILLANCE PIPELINE — MOCK MODE")
    logger.info("=" * 60)

    streams_cfg, pipeline_cfg = load_config(PROJECT_ROOT)
    stream_list = streams_cfg["streams"]

    frame_store = FrameStore()
    event_store = EventStore(max_events=1000)
    ai_config = AIConfigStore(stream_list)

    server_cfg = pipeline_cfg["server"]
    
    logger.info("Starting mock server on http://%s:%d", server_cfg["host"], server_cfg["port"])
    run_server(
        frame_store, 
        event_store, 
        ai_config, 
        stream_list, 
        host=server_cfg["host"], 
        port=server_cfg["port"], 
        mode="mock"
    )

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Shutting down mock server.")

if __name__ == "__main__":
    main()
