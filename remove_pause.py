import re

with open('E:/MIlitary_Prototype_IA/components/gotham/dashboard/CameraWall.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove pause logic from DecoupledStream
content = re.sub(
    r'// Pause when hidden to save CPU.*?useEffect\(\(\) => \{.*?if \(isHidden\).*?\}\}, \[isHidden\]\);',
    '',
    content,
    flags=re.DOTALL
)

# Remove pause logic from Tile
content = re.sub(
    r'// Pause when hidden to save CPU.*?useEffect\(\(\) => \{.*?if \(isHidden\).*?\}\}, \[isHidden.*?\]\);',
    '',
    content,
    flags=re.DOTALL
)

with open('E:/MIlitary_Prototype_IA/components/gotham/dashboard/CameraWall.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("Removed pause logic!")
