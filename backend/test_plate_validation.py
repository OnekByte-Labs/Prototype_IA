import json
import re

# Comprehensive Indian & tactical vehicle plate regex
# Format 1: Standard Indian (e.g., DL14CC5025, MH12NP6480, DL7CN1702, UP16BT4321, JK01AB1234, HR26DQ5555)
RE_STANDARD_INDIA = re.compile(r'^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{3,4}$')

# Format 2: Standard Indian short/legacy (e.g., MH01EB5211, DL12CJ9123, MH03EB1234)
RE_LEGACY_INDIA = re.compile(r'^[A-Z]{2}[0-9]{1,2}[A-Z]{1,2}[0-9]{1,4}$')

# Format 3: Bharat Series (e.g., 22BH1234AA)
RE_BH_SERIES = re.compile(r'^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$')

# Format 4: Military vehicle (e.g., 21D123456H, 18A000123B)
RE_MILITARY = re.compile(r'^[0-9]{2}[A-Z][0-9]{5,6}[A-Z]?$')

KNOWN_STATE_CODES = {
    'AN', 'AP', 'AR', 'AS', 'BR', 'CH', 'CG', 'DD', 'DL', 'DN',
    'GA', 'GJ', 'HR', 'HP', 'JH', 'JK', 'KA', 'KL', 'LA', 'LD',
    'MP', 'MH', 'MN', 'ML', 'MZ', 'NL', 'OD', 'PB', 'PY', 'RJ',
    'SK', 'TN', 'TS', 'TR', 'UP', 'UK', 'UA', 'WB'
}

def clean_plate(s):
    if not s:
        return ""
    # Strip spaces, dashes, dots
    cleaned = re.sub(r'[^A-Za-z0-9]', '', str(s)).upper()
    return cleaned

def is_valid_plate(raw_plate):
    c = clean_plate(raw_plate)
    if len(c) < 6 or len(c) > 10:
        return False
    # Cannot be all digits (e.g. 1111111, 1411101)
    if c.isdigit():
        return False
    # Cannot be all letters (e.g. ABCDEF)
    if c.isalpha():
        return False
    # Cannot have repeating character >= 4 times
    if re.search(r'(.)\1{3,}', c):
        return False
    
    # Check if first 2 characters are a known Indian state code
    prefix2 = c[:2]
    has_valid_state_prefix = prefix2 in KNOWN_STATE_CODES
    
    # Check standard regexes
    if RE_STANDARD_INDIA.match(c) or RE_LEGACY_INDIA.match(c):
        return True
    if RE_BH_SERIES.match(c) or RE_MILITARY.match(c):
        return True
    
    # If it starts with state code and has at least 2 digits at the end
    if has_valid_state_prefix and re.match(r'^[A-Z]{2}[0-9A-Z]{2,4}[0-9]{2,4}$', c):
        return True
        
    return False

# Test on cam_01 and cam_02
for cam in ['cam_01', 'cam_02']:
    with open(f'backend/outputs/precomputed/{cam}.json', 'r') as f:
        frames = json.load(f)
    
    valid_plates = set()
    invalid_plates = set()
    
    for fr in frames:
        for d in fr.get('detections', []):
            p = d.get('plate')
            if p:
                if is_valid_plate(p):
                    valid_plates.add(clean_plate(p))
                else:
                    invalid_plates.add(clean_plate(p))
                    
    print(f"=== {cam.upper()} ===")
    print(f"Valid plates ({len(valid_plates)}):", list(sorted(valid_plates))[:15])
    print(f"Invalid rejected ({len(invalid_plates)}):", list(sorted(invalid_plates))[:15])
