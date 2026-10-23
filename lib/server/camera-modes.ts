// Persistent in-memory storage for camera detection mode overrides

const modeOverrides: Record<string, string> = {};

export function getCameraDetectionMode(id: string): string | undefined {
  return modeOverrides[id.toUpperCase()];
}

export function setCameraDetectionMode(id: string, mode: string): void {
  modeOverrides[id.toUpperCase()] = mode;
}

export function getAllCameraDetectionModes(): Record<string, string> {
  return { ...modeOverrides };
}
