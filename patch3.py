import re

with open('E:/MIlitary_Prototype_IA/components/gotham/dashboard/CameraWall.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace number plate threshold
old_plate = "if (plateStr.length < 8 || confidence < 0.40) {"
new_plate = "if (plateStr.length < 5 || confidence < 0.20) {"

content = content.replace(old_plate, new_plate)

with open('E:/MIlitary_Prototype_IA/components/gotham/dashboard/CameraWall.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("Lowered plate thresholds!")
