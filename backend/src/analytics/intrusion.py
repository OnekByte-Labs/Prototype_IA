import cv2
import numpy as np
from shapely.geometry import Point, Polygon
from typing import Dict, List, Tuple
from .base import BaseAnalytics

class IntrusionDetector(BaseAnalytics):
    def __init__(self, stream_id: str, config: dict):
        super().__init__(stream_id, config)
        
        self.zone_coords = config.get("zone", [])
        if len(self.zone_coords) < 3:
            raise ValueError(f"IntrusionDetector for {stream_id} requires at least 3 points for the zone polygon.")
            
        self.intrusion_zone = Polygon(self.zone_coords)
        
        # Apply inward buffer to avoid near-miss false triggers
        buffer_px = config.get("buffer_px", 0)
        if buffer_px > 0:
            self.detection_zone = self.intrusion_zone.buffer(-buffer_px)
            if self.detection_zone.is_empty:
                self.detection_zone = self.intrusion_zone
        else:
            self.detection_zone = self.intrusion_zone
            
        self.required_consecutive_frames = config.get("required_consecutive_frames", 5)
        
        # Track how many consecutive frames an object has been in the zone
        self.frames_in_zone: Dict[int, int] = {}
        
        # Keep track of objects we've already alerted on to prevent alert spam
        self.alerted_ids = set()

    def reset(self):
        self.frames_in_zone.clear()
        self.alerted_ids.clear()

    def process_frame(self, frame: np.ndarray, tracks: list, frame_id: int) -> list:
        events = []
        current_track_ids = set()

        for track in tracks:
            tid = int(track.track_id)
            current_track_ids.add(tid)
            
            x1, y1, x2, y2 = track.bbox
            # Use center of bounding box for zone containment check
            # (foot point is often below the zone boundary in overhead cameras)
            center_x = (x1 + x2) / 2.0
            center_y = (y1 + y2) / 2.0
            
            check_point = Point(center_x, center_y)
            
            if self.detection_zone.contains(check_point):
                # Object is inside zone
                self.frames_in_zone[tid] = self.frames_in_zone.get(tid, 0) + 1
                
                if self.frames_in_zone[tid] >= self.required_consecutive_frames and tid not in self.alerted_ids:
                    self.alerted_ids.add(tid)
                    events.append({
                        "type": "intrusion",
                        "stream_id": self.stream_id,
                        "frame_id": frame_id,
                        "object_id": tid,
                        "class_id": int(track.class_id),
                        "location": [center_x, center_y]
                    })
            else:
                # Object stepped out of the zone
                if tid in self.frames_in_zone:
                    del self.frames_in_zone[tid]
                    # We can also optionally clear alerted_ids here if we want them to re-trigger
                    # if they step out and step back in.
                    if tid in self.alerted_ids:
                        self.alerted_ids.remove(tid)

        # Cleanup tracks that disappeared completely
        dead_tracks = set(self.frames_in_zone.keys()) - current_track_ids
        for dt in dead_tracks:
            del self.frames_in_zone[dt]
            if dt in self.alerted_ids:
                self.alerted_ids.remove(dt)

        return events
