import logging
from .base import BaseAnalytics
from .traffic import TrafficCounter
from .intrusion import IntrusionDetector

logger = logging.getLogger("analytics")

def create_analytics(stream_id: str, config: dict) -> BaseAnalytics:
    """Factory to create the right analytics module based on config type."""
    atype = config.get("type")
    
    if atype == "traffic_count":
        return TrafficCounter(stream_id, config)
    elif atype == "intrusion_zone":
        return IntrusionDetector(stream_id, config)
    else:
        logger.warning(f"Unknown analytics type '{atype}' for stream {stream_id}")
        return None
