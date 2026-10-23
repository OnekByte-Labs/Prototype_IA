import json
import os
import re
import cv2
from collections import defaultdict

# 1. Plate validity check
KNOWN_STATE_CODES = {
    'AN', 'AP', 'AR', 'AS', 'BR', 'CH', 'CG', 'DD', 'DL', 'DN',
    'GA', 'GJ', 'HR', 'HP', 'JH', 'JK', 'KA', 'KL', 'LA', 'LD',
    'MP', 'MH', 'MN', 'ML', 'MZ', 'NL', 'OD', 'PB', 'PY', 'RJ',
    'SK', 'TN', 'TS', 'TR', 'UP', 'UK', 'UA', 'WB'
}

RE_STANDARD_INDIA = re.compile(r'^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{3,4}$')
RE_LEGACY_INDIA = re.compile(r'^[A-Z]{2}[0-9]{1,2}[A-Z]{1,2}[0-9]{1,4}$')
RE_BH_SERIES = re.compile(r'^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$')
RE_MILITARY = re.compile(r'^[0-9]{2}[A-Z][0-9]{4,6}[A-Z]?$')

def clean_plate(s):
    if not s:
        return ""
    return re.sub(r'[^A-Za-z0-9]', '', str(s)).upper()

def is_valid_plate(raw_plate):
    c = clean_plate(raw_plate)
    if len(c) < 5 or len(c) > 10:
        return False
    if c.isdigit() or c.isalpha():
        return False
    # Reject 3 or more repeated identical characters
    if re.search(r'(.)\1{2,}', c):
        return False
    
    # Must have at least 2 letters and at least 2 digits
    num_letters = sum(1 for ch in c if ch.isalpha())
    num_digits = sum(1 for ch in c if ch.isdigit())
    if num_letters < 2 or num_digits < 2:
        return False

    prefix2 = c[:2]
    # Check Indian state code
    if prefix2 in KNOWN_STATE_CODES:
        return True
    
    # Check regex
    if RE_STANDARD_INDIA.match(c) or RE_LEGACY_INDIA.match(c) or RE_BH_SERIES.match(c) or RE_MILITARY.match(c):
        return True
    
    # General valid format (2 letters + digits + letters/digits)
    if re.match(r'^[A-Z]{2}[0-9]{1,2}[A-Z0-9]{3,6}$', c):
        return True
        
    return False

# Test for CAM-01
with open('backend/outputs/precomputed/cam_01.json', 'r') as f:
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
                'bbox': [d.get('x'), d.get('y'), d.get('w'), d.get('h')],
                'timestamp': fr.get('timestamp')
            })

valid_cars = []
for tid, det_list in tracks.items():
    # Filter detections to only those with valid plates
    valid_dets = [d for d in det_list if d.get('plate') and is_valid_plate(d['plate'])]
    if not valid_dets:
        continue
    # Pick the detection with highest confidence for that car
    best = max(valid_dets, key=lambda x: x['conf'])
    valid_cars.append({
        'track_id': tid,
        'plate': clean_plate(best['plate']),
        'conf': best['conf'],
        'model': best['model'],
        'cls': best['cls'],
        'frame_idx': best['frame_idx'],
        'bbox': best['bbox'],
        'occurrences': len(det_list),
        'valid_readings': len(valid_dets)
    })

print(f"CAM-01 total tracks: {len(tracks)}, Tracks with VALID plates: {len(valid_cars)}")
for vc in sorted(valid_cars, key=lambda x: x['conf'], reverse=True)[:10]:
    print(" ", vc)
