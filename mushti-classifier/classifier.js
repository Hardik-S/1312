const DEFAULT_CONFIG = {
  bufferMs: 1000,
  minSamples: 20,
  displacementThreshold: 0.08,
  cooldownMs: 2000
};

export function createMotionClassifier(config = {}) {
  const settings = { ...DEFAULT_CONFIG, ...config };
  let samples = [];
  let lastFiredAt = 0;
  let lastLabel = null;

  function update(landmarks, nowMs) {
    if (!landmarks || landmarks.length === 0) return null;

    const wristY = landmarks[0].y;
    samples.push({ y: wristY, t: nowMs });
    const cutoff = nowMs - settings.bufferMs;
    samples = samples.filter((sample) => sample.t >= cutoff);

    if (samples.length < settings.minSamples) return null;
    if (nowMs - lastFiredAt < settings.cooldownMs) return null;

    const startY = samples[0].y;
    const endY = samples[samples.length - 1].y;
    const displacement = endY - startY;
    const magnitude = Math.abs(displacement);

    if (magnitude < settings.displacementThreshold) return null;

    const label = displacement > 0 ? "STEADINESS" : "COURAGE";
    if (label === lastLabel && nowMs - lastFiredAt < settings.cooldownMs * 1.5) {
      return null;
    }

    const confidence = Math.min(
      1,
      magnitude / (settings.displacementThreshold * 2)
    );

    lastFiredAt = nowMs;
    lastLabel = label;
    return { label, confidence };
  }

  function getState(nowMs) {
    const hasSamples = samples.length >= settings.minSamples;
    const inCooldown = nowMs - lastFiredAt < settings.cooldownMs;
    return {
      ready: hasSamples && !inCooldown,
      hasSamples,
      inCooldown,
      cooldownRemainingMs: Math.max(0, settings.cooldownMs - (nowMs - lastFiredAt))
    };
  }

  function getDiagnostics(nowMs) {
    const sampleCount = samples.length;
    let displacement = null;
    if (sampleCount >= 2) {
      const startY = samples[0].y;
      const endY = samples[sampleCount - 1].y;
      displacement = endY - startY;
    }
    return {
      sampleCount,
      displacement,
      bufferMs: settings.bufferMs,
      minSamples: settings.minSamples,
      displacementThreshold: settings.displacementThreshold,
      cooldownRemainingMs: Math.max(0, settings.cooldownMs - (nowMs - lastFiredAt))
    };
  }

  function reset() {
    samples = [];
    lastFiredAt = 0;
    lastLabel = null;
  }

  return { update, getState, getDiagnostics, reset };
}
