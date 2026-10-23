import json
from collections import defaultdict

def analyze_cam(path, cam_name):
    with open(path, 'r') as f:
        frames = json.load(f)

    tracks = defaultdict(list)
    for idx, fr in enumerate(frames):
        for d in fr.get('detections', []):
            tid = d.get('id')
            if tid is not None:
                tracks[tid].append({
                    'frame_idx': idx,
                    'plate': d.get('plate'),
                    'conf': d.get('confidence', 0),
                    'model': d.get('model'),
                    'cls': d.get('class'),
                    'bbox': [d.get('x'), d.get('y'), d.get('w'), d.get('h')]
                })

    print(f'=== {cam_name}: {len(tracks)} tracks ===')
    for tid in sorted(tracks.keys())[:10]:
        plates = [t for t in tracks[tid] if t.get('plate')]
        if not plates:
            continue
        sorted_plates = sorted(plates, key=lambda x: x['conf'], reverse=True)
        unique_plates = list(set(x['plate'] for x in sorted_plates))
        best = sorted_plates[0]
        print(f"Track #{tid} ({best['cls']} - {best['model']}): {len(tracks[tid])} frames, {len(plates)} plate detections")
        print(f"  All read plates: {unique_plates[:6]}")
        print(f"  Highest Conf: '{best['plate']}' (conf: {best['conf']:.3f}, frame: {best['frame_idx']})")

analyze_cam('backend/outputs/precomputed/cam_01.json', 'CAM-01')
analyze_cam('backend/outputs/precomputed/cam_02.json', 'CAM-02')
