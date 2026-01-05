import {
  HandLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

import { createMotionClassifier } from "./classifier.js";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

const statusEl = document.getElementById("status");
const videoEl = document.getElementById("webcam");
const canvasEl = document.getElementById("overlay");
const logEl = document.getElementById("action-log");
const clearButton = document.getElementById("clear-log");
const mushtiIndicator = document.getElementById("mushti-indicator");
const metricsEl = document.getElementById("mushti-metrics");

const ctx = canvasEl.getContext("2d");
const classifier = createMotionClassifier();

let handLandmarker = null;
let lastVideoTime = -1;
let displayWidth = 0;
let displayHeight = 0;
let mushtiRequirements = null;

const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17]
];

async function initHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: "GPU"
    },
    numHands: 1,
    runningMode: "VIDEO"
  });
}

async function startWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 }
  });
  videoEl.srcObject = stream;

  await new Promise((resolve) => {
    videoEl.onloadeddata = () => resolve();
  });

  resizeCanvasToVideo();
}

function resizeCanvasToVideo() {
  const rect = videoEl.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  displayWidth = rect.width;
  displayHeight = rect.height;
  const dpr = window.devicePixelRatio || 1;
  canvasEl.width = Math.round(displayWidth * dpr);
  canvasEl.height = Math.round(displayHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

async function loadMushtiRequirements() {
  const response = await fetch("./mushti-requirements.json");
  if (!response.ok) {
    throw new Error("Failed to load mushti-requirements.json");
  }
  mushtiRequirements = await response.json();
}

function drawLandmarks(landmarks) {
  ctx.clearRect(0, 0, displayWidth, displayHeight);

  ctx.strokeStyle = "#1f8077";
  ctx.lineWidth = 2;
  HAND_CONNECTIONS.forEach(([start, end]) => {
    const startLm = landmarks[start];
    const endLm = landmarks[end];
    ctx.beginPath();
    ctx.moveTo(startLm.x * displayWidth, startLm.y * displayHeight);
    ctx.lineTo(endLm.x * displayWidth, endLm.y * displayHeight);
    ctx.stroke();
  });

  ctx.fillStyle = "#d93737";
  landmarks.forEach((lm) => {
    ctx.beginPath();
    ctx.arc(lm.x * displayWidth, lm.y * displayHeight, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function evaluateMushti(landmarks) {
  if (!mushtiRequirements) {
    return {
      isFist: false,
      metrics: [],
      threshold: null,
      requiredCurled: null,
      thumbMetric: null
    };
  }

  const wrist = landmarks[0];
  const threshold = mushtiRequirements.fingerThreshold ?? 0.92;
  const fingerPairs = mushtiRequirements.fingers || [];
  let curled = 0;
  const metrics = fingerPairs.map(({ name, tipIndex, mcpIndex }) => {
    const tipDist = distance(landmarks[tipIndex], wrist);
    const mcpDist = distance(landmarks[mcpIndex], wrist);
    const ratio = tipDist / mcpDist;
    const delta = ratio - threshold;
    const curledFinger = ratio < threshold;
    if (curledFinger) {
      curled += 1;
    }
    return {
      name,
      ratio,
      delta,
      curled: curledFinger
    };
  });

  const thumbConfig = mushtiRequirements.thumb;
  let thumbMetric = null;
  if (thumbConfig) {
    const thumbThreshold = thumbConfig.threshold ?? threshold;
    const tipDist = distance(landmarks[thumbConfig.tipIndex], wrist);
    const mcpDist = distance(landmarks[thumbConfig.mcpIndex], wrist);
    const ratio = tipDist / mcpDist;
    const delta = ratio - thumbThreshold;
    const curledThumb = ratio < thumbThreshold;
    if (curledThumb) {
      curled += 1;
    }
    thumbMetric = {
      name: "Thumb",
      ratio,
      delta,
      curled: curledThumb,
      threshold: thumbThreshold
    };
  }

  const requiredCurled = mushtiRequirements.requiredCurledFingers ?? 4;
  return {
    isFist: curled >= requiredCurled,
    metrics,
    threshold,
    requiredCurled,
    thumbMetric
  };
}

function renderMetrics(
  isFist,
  mushtiMetrics,
  motionMetrics,
  mushtiThreshold,
  requiredCurled,
  thumbMetric
) {
  mushtiIndicator.textContent = isFist ? "Yes" : "No";
  mushtiIndicator.classList.toggle("yes", isFist);
  mushtiIndicator.classList.toggle("no", !isFist);

  const mushtiLines = mushtiMetrics
    ? mushtiMetrics.map((metric) => {
        const offBy = Math.max(0, metric.delta);
        const offText = offBy === 0 ? "ok" : `off by +${offBy.toFixed(2)}`;
        return `<div class="metric"><span>${metric.name}</span><span>${offText} (${metric.ratio.toFixed(
          2
        )})</span></div>`;
      })
    : [`<div class="metric"><span>Mushti</span><span>no data</span></div>`];
  if (thumbMetric) {
    const offBy = Math.max(0, thumbMetric.delta);
    const offText = offBy === 0 ? "ok" : `off by +${offBy.toFixed(2)}`;
    mushtiLines.unshift(
      `<div class="metric"><span>${thumbMetric.name}</span><span>${offText} (${thumbMetric.ratio.toFixed(
        2
      )} / ${thumbMetric.threshold.toFixed(2)})</span></div>`
    );
  }

  const displacement =
    motionMetrics && motionMetrics.displacement !== null
      ? motionMetrics.displacement
      : null;
  const direction =
    displacement === null
      ? "n/a"
      : displacement > 0
        ? "down"
        : "up";
  const displacementText =
    displacement === null ? "n/a" : displacement.toFixed(3);
  const motionLines = motionMetrics
    ? [
        `<div class="metric"><span>Samples</span><span>${motionMetrics.sampleCount}/${motionMetrics.minSamples}</span></div>`,
        `<div class="metric"><span>Displacement</span><span>${displacementText} (${direction})</span></div>`,
        `<div class="metric"><span>Threshold</span><span>${motionMetrics.displacementThreshold.toFixed(
          3
        )}</span></div>`,
        `<div class="metric"><span>Cooldown</span><span>${Math.ceil(
          motionMetrics.cooldownRemainingMs / 100
        ) / 10}s</span></div>`
      ]
    : [`<div class="metric"><span>Motion</span><span>no data</span></div>`];

  metricsEl.innerHTML = [
    `<div class="metric"><span>Mushti Threshold</span><span>${
      mushtiThreshold !== null && mushtiThreshold !== undefined
        ? mushtiThreshold.toFixed(2)
        : "n/a"
    }</span></div>`,
    `<div class="metric"><span>Required Curled</span><span>${
      requiredCurled !== null && requiredCurled !== undefined
        ? requiredCurled
        : "n/a"
    }</span></div>`,
    ...mushtiLines,
    `<div class="metric"><span>Motion Window</span><span>${motionMetrics ? motionMetrics.bufferMs : "n/a"}ms</span></div>`,
    ...motionLines
  ].join("");
}

function logAction({ label, confidence }) {
  const entry = document.createElement("div");
  const timestamp = new Date().toLocaleTimeString();
  entry.className = `log-entry ${label.toLowerCase()}`;
  entry.textContent = `[${timestamp}] ${label} (${confidence.toFixed(2)})`;
  logEl.prepend(entry);
}

function detectHands() {
  if (!handLandmarker) return;

  if (videoEl.currentTime !== lastVideoTime) {
    lastVideoTime = videoEl.currentTime;
    resizeCanvasToVideo();
    const results = handLandmarker.detectForVideo(videoEl, performance.now());

    if (results.landmarks && results.landmarks.length > 0) {
      const landmarks = results.landmarks[0];
      drawLandmarks(landmarks);

      const nowMs = Date.now();
      const mushtiEval = evaluateMushti(landmarks);
      const fist = mushtiEval.isFist;
      let motion = null;

      if (fist) {
        motion = classifier.update(landmarks, nowMs);
        if (motion) {
          logAction(motion);
        }
      } else {
        classifier.reset();
      }

      renderMetrics(
        fist,
        mushtiEval.metrics,
        classifier.getDiagnostics(nowMs),
        mushtiEval.threshold,
        mushtiEval.requiredCurled,
        mushtiEval.thumbMetric
      );
    } else {
      ctx.clearRect(0, 0, displayWidth, displayHeight);
      classifier.reset();
      renderMetrics(
        false,
        null,
        classifier.getDiagnostics(Date.now()),
        null,
        null,
        null
      );
    }
  }

  requestAnimationFrame(detectHands);
}

async function init() {
  try {
    statusEl.textContent = "Loading model...";
    await loadMushtiRequirements();
    await initHandLandmarker();

    statusEl.textContent = "Starting camera...";
    await startWebcam();

    statusEl.textContent = "Ready";
    window.addEventListener("resize", resizeCanvasToVideo);
    detectHands();
  } catch (error) {
    console.error(error);
    statusEl.textContent = "Failed to initialize camera.";
  }
}

clearButton.addEventListener("click", () => {
  logEl.innerHTML = "";
});

init();
