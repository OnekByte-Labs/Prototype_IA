"""
Indian registration plate validation for ANPR.

The plate recogniser is a generic character model and confuses look-alike
characters (O/0, I/1, S/5, B/8 ...). Indian plates follow a fixed layout, so a
raw read is snapped to that layout *by position* (a digit where the layout needs
a digit, a letter where it needs a letter) and rejected when it cannot be made
to fit with few corrections — reads that are not real plates never become events.

Layouts:  SS DD[D] L{1,3} DDDD    state code · district · series · number
          DD BH DDDD L{1,2}       Bharat series
"""

import itertools
import re
from typing import Optional, Tuple

STATES = frozenset(
    "AN AP AR AS BR CG CH DD DL DN GA GJ HP HR JH JK KA KL LA LD MH ML MN MP MZ NL OD OR PB PY RJ SK TG TN TR TS UK UP WB".split()
)

# Characters a recogniser mistakes for each other, by what the position needs
_TO_DIGIT = {"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "Z": "2", "S": "5", "G": "6", "B": "8", "T": "7"}
_TO_LETTER = {"0": "O", "1": "I", "2": "Z", "5": "S", "6": "G", "8": "B", "7": "T"}

# Position templates: D = digit, L = letter
_TEMPLATES = [
    "LL" + "D" * d + "L" * s + "DDDD" for d, s in itertools.product((1, 2), (1, 2, 3))
]
_BH = ["DDLLDDDDL", "DDLLDDDDLL"]
MAX_CORRECTIONS = 1


def _fit(raw: str, template: str) -> Optional[Tuple[str, int]]:
    """Snap ``raw`` to ``template``; returns (text, number of corrected chars)."""
    out, changes = [], 0
    for ch, kind in zip(raw, template):
        if kind == "D":
            if ch.isdigit():
                out.append(ch)
            elif ch in _TO_DIGIT:
                out.append(_TO_DIGIT[ch])
                changes += 1
            else:
                return None
        else:
            if ch.isalpha():
                out.append(ch)
            elif ch in _TO_LETTER:
                out.append(_TO_LETTER[ch])
                changes += 1
            else:
                return None
    return "".join(out), changes


def normalize_indian_plate(raw: str) -> Optional[Tuple[str, int]]:
    """Best valid Indian plate for a raw read, or None. Returns (text, corrections)."""
    s = re.sub(r"[^A-Z0-9]", "", raw.upper())
    best: Optional[Tuple[str, int]] = None
    for t in _TEMPLATES + _BH:
        if len(s) != len(t):
            continue
        fit = _fit(s, t)
        if fit is None or fit[1] > MAX_CORRECTIONS:
            continue
        text = fit[0]
        if t in _BH:
            if text[2:4] != "BH":
                continue
        elif text[:2] not in STATES or not int(re.match(r"\d+", text[2:]).group()):
            continue        # unknown state code / district 0
        if best is None or fit[1] < best[1]:
            best = fit
    return best
