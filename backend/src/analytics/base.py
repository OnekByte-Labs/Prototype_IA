import cv2
import numpy as np
from shapely.geometry import Point, Polygon
from typing import Dict, List, Set, Tuple

class BaseAnalytics:
    def __init__(self, stream_id: str, config: dict):
        self.stream_id = stream_id
        self.config = config

    def process_frame(self, frame: np.ndarray, tracks: list, frame_id: int) -> list:
        """
        Process the frame and tracks, draw annotations on the frame if any, 
        and return a list of triggered event dictionaries.
        """
        return []

    def reset(self):
        """
        Reset internal state (e.g. when video loops)
        """
        pass
