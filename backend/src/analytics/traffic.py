import cv2
import numpy as np
from shapely.geometry import LineString, Point
from typing import Dict, List, Tuple
from .base import BaseAnalytics

class TrafficCounter(BaseAnalytics):
    def __init__(self, stream_id: str, config: dict):
        super().__init__(stream_id, config)
        
        # Load line from config
        self.line_coords = config.get("line", [])
        if len(self.line_coords) < 2:
            raise ValueError(f"TrafficCounter for {stream_id} requires at least 2 points for the line.")
            
        self.counting_line = LineString(self.line_coords)
        
        # Tracking history: track_id -> list of foot points (x, y)
        self.history: Dict[int, List[Tuple[float, float]]] = {}
        
        # Set of counted track IDs
        self.counted_ids = set()
        
        self.total_count = 0

    def process_frame(self, frame: np.ndarray, tracks: list, frame_id: int) -> list:
        events = []
        
        # Draw the counting line on the frame (red)
        pts = np.array(self.line_coords, np.int32)
        pts = pts.reshape((-1, 1, 2))
        cv2.polylines(frame, [pts], False, (0, 0, 255), 4)
        
        # Draw total count
        cv2.putText(frame, f"Traffic Count: {self.total_count}", (50, 100), 
                    cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 255, 255), 4)

        current_track_ids = set()

        for track in tracks:
            # We assume track is an object with track_id, class_id, bbox (x1, y1, x2, y2)
            # as returned by ByteTracker
            tid = int(track.track_id)
            current_track_ids.add(tid)
            
            x1, y1, x2, y2 = track.bbox
            foot_x = (x1 + x2) / 2.0
            foot_y = float(y2)
            
            current_point = (foot_x, foot_y)
            
            if tid not in self.history:
                self.history[tid] = []
            
            self.history[tid].append(current_point)
            
            # Keep only the last 10 points to avoid memory bloat
            if len(self.history[tid]) > 10:
                self.history[tid].pop(0)

            # Check for crossing
            if len(self.history[tid]) >= 2 and tid not in self.counted_ids:
                # Segment from previous frame to this frame
                prev_point = self.history[tid][-2]
                movement_line = LineString([prev_point, current_point])
                
                if movement_line.intersects(self.counting_line):
                    self.counted_ids.add(tid)
                    self.total_count += 1
                    
                    events.append({
                        "type": "traffic_count",
                        "stream_id": self.stream_id,
                        "frame_id": frame_id,
                        "object_id": tid,
                        "class_id": int(track.class_id),
                        "total_count": self.total_count,
                        "location": [foot_x, foot_y]
                    })
                    
                    # Optional visual feedback: brief flash or marker
                    cv2.circle(frame, (int(foot_x), int(foot_y)), 20, (0, 255, 0), -1)

        # Cleanup old tracks
        dead_tracks = set(self.history.keys()) - current_track_ids
        for dt in dead_tracks:
            del self.history[dt]
            # We don't remove from counted_ids yet to prevent double counting if it briefly drops,
            # but in a real system we'd expire counted_ids after some time.

        return events
