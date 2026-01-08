import {
  HandLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

import { createMotionClassifier } from "./classifier.js";
import { renderBulletList, statusFromProgress } from "./feedback-render.js";

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
const metricsInfoEl = document.getElementById("metrics-info");
const feedbackEl = document.getElementById("mushti-feedback");
const graceTimerEl = document.getElementById("grace-timer");
const infoPanelToggle = document.getElementById("info-panel-toggle");
const infoPanelShow = document.getElementById("info-panel-show");
const infoCard = document.querySelector(".info-card");
const contentEl = document.querySelector(".content");
const controlsEl = document.getElementById("controls");
const resetControlsButton = document.getElementById("controls-reset");
const cameraToggle = document.getElementById("camera-toggle");
const controlsSavedEl = document.getElementById("controls-saved");
const controlsToggle = document.getElementById("controls-toggle");
const controlsCard = document.querySelector(".controls-card");

const ctx = canvasEl.getContext("2d");
let classifier = null;

let handLandmarker = null;
let lastVideoTime = -1;
let displayWidth = 0;
let displayHeight = 0;
let mushtiRequirements = null;
let requirementsInfo = null;
let movementRequirements = null;
let defaultMushtiRequirements = null;
let defaultMovementRequirements = null;
let cameraStream = null;
let cameraActive = false;
let savedTimeout = null;
let lastFist = false;
let actionLocked = false;
let sliderRanges = null;
let graceStartY = null;
let graceStartMs = null;

const STORAGE_KEY = "mushti-controls-v1";

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
  cameraStream = stream;
  cameraActive = true;
  videoEl.srcObject = stream;

  await new Promise((resolve) => {
    videoEl.onloadeddata = () => resolve();
  });

  resizeCanvasToVideo();
}

function stopWebcam() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
  }
  cameraStream = null;
  cameraActive = false;
  videoEl.srcObject = null;
  ctx.clearRect(0, 0, displayWidth, displayHeight);
  if (classifier) {
    classifier.reset();
  }
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

async function loadRequirementsInfo() {
  const response = await fetch("./requirements-info.json");
  if (!response.ok) {
    throw new Error("Failed to load requirements-info.json");
  }
  requirementsInfo = await response.json();
}

async function loadMovementRequirements() {
  const response = await fetch("./movements.json");
  if (!response.ok) {
    throw new Error("Failed to load movements.json");
  }
  movementRequirements = await response.json();
}

async function loadSliderRanges() {
  const response = await fetch("./slider-min-max.json");
  if (!response.ok) {
    throw new Error("Failed to load slider-min-max.json");
  }
  sliderRanges = await response.json();
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
function getPitchUp(landmarks, threshold) {
  if (!landmarks || landmarks.length === 0) {
    return { pitchUp: false, delta: null };
  }
  const wrist = landmarks[0];
  const mcpIndices = [5, 9, 13, 17];
  const avgMcpZ =
    mcpIndices.reduce((sum, index) => sum + (landmarks[index]?.z || 0), 0) /
    mcpIndices.length;
  const delta = wrist.z - avgMcpZ;
  return {
    pitchUp: delta >= threshold,
    delta
  };
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
  const fingerThresholds = mushtiRequirements.fingerThresholds || {};
  const fingerPairs = mushtiRequirements.fingers || [];
  let curled = 0;
  const metrics = fingerPairs.map(({ name, tipIndex, mcpIndex }) => {
    const tipDist = distance(landmarks[tipIndex], wrist);
    const mcpDist = distance(landmarks[mcpIndex], wrist);
    const ratio = tipDist / mcpDist;
    const fingerThreshold = Number.isFinite(fingerThresholds[name])
      ? fingerThresholds[name]
      : threshold;
    const delta = ratio - fingerThreshold;
    const curledFinger = ratio < fingerThreshold;
    if (curledFinger) {
      curled += 1;
    }
    return {
      name,
      ratio,
      delta,
      curled: curledFinger,
      threshold: fingerThreshold
    };
  });

  const thumbConfig = mushtiRequirements.thumb;
  let thumbMetric = null;
  if (thumbConfig) {
    // Thumb is considered curled when the tip is within a threshold of any finger MCP.
    const thumbThreshold = thumbConfig.threshold ?? 0.08;
    const thumbTip = landmarks[thumbConfig.tipIndex];
    const mcpIndices = fingerPairs.map((finger) => finger.mcpIndex);
    const touchDistance = mcpIndices.length
      ? Math.min(
          ...mcpIndices.map((index) => distance(thumbTip, landmarks[index]))
        )
      : distance(thumbTip, wrist);
    const delta = touchDistance - thumbThreshold;
    const curledThumb = touchDistance <= thumbThreshold;
    if (curledThumb) {
      curled += 1;
    }
    thumbMetric = {
      name: "Thumb",
      touchDistance,
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
    thumbMetric,
    curledCount: curled
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

  const metricLine = (label, value) =>
    `<div class="metric"><span>${label}</span><span>${value}</span></div>`;

  const mushtiLines = mushtiMetrics
    ? mushtiMetrics.map((metric) => {
        const offBy = Math.max(0, metric.delta);
        const offText = offBy === 0 ? "ok" : `off by +${offBy.toFixed(2)}`;
        return metricLine(
          metric.name,
          `${offText} (${metric.ratio.toFixed(2)})`,
          "fingerRatio"
        );
      })
    : [`<div class="metric"><span>Mushti</span><span>no data</span></div>`];
  if (thumbMetric) {
    const offBy = Math.max(0, thumbMetric.delta);
    const offText = offBy === 0 ? "ok" : `off by +${offBy.toFixed(2)}`;
    mushtiLines.unshift(
      metricLine(
        thumbMetric.name,
        `${offText} (${thumbMetric.touchDistance.toFixed(
          3
        )} / ${thumbMetric.threshold.toFixed(3)})`,
        "thumbRatio"
      )
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
        metricLine(
          "Samples",
          `${motionMetrics.sampleCount}/${motionMetrics.minSamples}`,
          "samples"
        ),
        metricLine(
          "Displacement",
          `${displacementText} (${direction})`,
          "displacement"
        ),
        metricLine(
          "Grace Window",
          motionMetrics.graceWindowMs ? `${motionMetrics.graceWindowMs}ms` : "n/a",
          "graceWindow"
        ),
        metricLine(
          "Upward Enough",
          motionMetrics.upwardThreshold
            ? motionMetrics.upwardThreshold.toFixed(3)
            : "n/a",
          "upwardThreshold"
        ),
        metricLine(
          "Downward Enough",
          motionMetrics.downwardThreshold
            ? motionMetrics.downwardThreshold.toFixed(3)
            : "n/a",
          "downwardThreshold"
        ),
        metricLine(
          "Pitch Up",
          motionMetrics.pitchDelta !== null && motionMetrics.pitchDelta !== undefined
            ? `${motionMetrics.pitchUp ? "yes" : "no"} (${motionMetrics.pitchDelta.toFixed(3)})`
            : "n/a",
          "pitchUpThreshold"
        ),
        metricLine(
          "Threshold",
          motionMetrics.displacementThreshold.toFixed(3),
          "motionThreshold"
        ),
        metricLine(
          "Cooldown",
          `${Math.ceil(motionMetrics.cooldownRemainingMs / 100) / 10}s`,
          "cooldown"
        )
      ]
    : [`<div class="metric"><span>Motion</span><span>no data</span></div>`];

  metricsEl.innerHTML = [
    metricLine(
      "Mushti Threshold",
      mushtiThreshold !== null && mushtiThreshold !== undefined
        ? mushtiThreshold.toFixed(2)
        : "n/a",
    ),
    metricLine(
      "Required Curled",
      requiredCurled !== null && requiredCurled !== undefined
        ? requiredCurled
        : "n/a",
    ),
    ...mushtiLines,
    metricLine(
      "Motion Window",
      motionMetrics ? `${motionMetrics.bufferMs}ms` : "n/a",
    ),
    ...motionLines
  ].join("");

  if (graceTimerEl) {
    const baseGraceMs = movementRequirements?.graceWindowMs ?? 0;
    const graceMs = isFist
      ? baseGraceMs
      : motionMetrics && motionMetrics.graceRemainingMs
        ? Math.max(0, Math.round(motionMetrics.graceRemainingMs))
        : 0;
    graceTimerEl.textContent =
      graceMs > 0
        ? `Grace window: ${graceMs}ms (move up for Courage, down for Steadiness)`
        : "";
  }
}

function renderMushtiFeedback(mushtiEval, { graceActive, graceDisplacement } = {}) {
  if (!feedbackEl) return;
  if (!mushtiEval) {
    feedbackEl.innerHTML = renderBulletList([
      { label: "Place your hand in frame to start.", status: "" }
    ]);
    return;
  }

  if (mushtiEval.isFist) {
    const pitchThreshold = movementRequirements?.pitchUpThreshold ?? 0.01;
    const pitch = mushtiEval.pitch || { pitchUp: false, delta: null };
    const upwardThreshold = movementRequirements?.upwardThreshold ?? 0.06;
    const downwardThreshold = movementRequirements?.downwardThreshold ?? 0.06;
    const upwardProgress =
      graceActive && graceDisplacement < 0
        ? Math.min(1, Math.abs(graceDisplacement) / upwardThreshold)
        : 0;
    const downwardProgress =
      graceActive && graceDisplacement > 0
        ? Math.min(1, graceDisplacement / downwardThreshold)
        : 0;

    const courageItems = [
      {
        label: "Tilt wrist toward camera (pitch up).",
        status: statusFromProgress(
          pitch.delta !== null && pitchThreshold
            ? Math.max(0, pitch.delta / pitchThreshold)
            : 0
        )
      },
      {
        label: `Move upward by at least ${upwardThreshold.toFixed(3)}.`,
        status: statusFromProgress(upwardProgress)
      }
    ];

    const steadinessItems = [
      {
        label: `Move downward by at least ${downwardThreshold.toFixed(3)}.`,
        status: statusFromProgress(downwardProgress)
      }
    ];

    feedbackEl.innerHTML = `<div class="feedback-split">
      <div>
        <strong>Courage</strong>
        ${renderBulletList(courageItems, { sort: false })}
      </div>
      <div>
        <strong>Steadiness</strong>
        ${renderBulletList(steadinessItems, { sort: false })}
      </div>
    </div>`;
    return;
  }

  const items = [];

  const addItem = (label, progress) => {
    items.push({ label, status: statusFromProgress(progress) });
  };

  const required = mushtiEval.requiredCurled ?? 0;
  const curledCount = mushtiEval.curledCount ?? 0;
  const countProgress = required > 0 ? curledCount / required : 0;
  addItem(`Curl ${required} fingers (now ${curledCount}).`, countProgress);

  (mushtiEval.metrics || []).forEach((metric) => {
    const progress = metric.ratio > 0 ? metric.threshold / metric.ratio : 0;
    addItem(
      `Curl ${metric.name.toLowerCase()} finger.`,
      metric.curled ? 1 : progress
    );
  });

  if (mushtiEval.thumbMetric) {
    const progress =
      mushtiEval.thumbMetric.touchDistance > 0
        ? mushtiEval.thumbMetric.threshold / mushtiEval.thumbMetric.touchDistance
        : 0;
    addItem(
      "Touch thumb tip to a finger knuckle.",
      mushtiEval.thumbMetric.curled ? 1 : progress
    );
  }

  feedbackEl.innerHTML = renderBulletList(items);
}

function renderMetricsInfo() {
  if (!metricsInfoEl) return;
  if (!requirementsInfo) {
    metricsInfoEl.innerHTML =
      "<div class=\"info-item\"><p>No info available.</p></div>";
    return;
  }

  const items = [
    { label: "Mushti Threshold", key: "mushtiThreshold" },
    { label: "Required Curled", key: "requiredCurled" }
  ];

  if (mushtiRequirements && Array.isArray(mushtiRequirements.fingers)) {
    mushtiRequirements.fingers.forEach((finger) => {
      items.push({
        label: `${finger.name} Ratio`,
        key: "fingerRatio"
      });
    });
  }

  if (mushtiRequirements && mushtiRequirements.thumb) {
    items.push({ label: "Thumb Touch", key: "thumbRatio" });
  }

  items.push(
    { label: "Motion Window", key: "motionWindow" },
    { label: "Grace Window", key: "graceWindow" },
    { label: "Samples", key: "samples" },
    { label: "Displacement", key: "displacement" },
    { label: "Upward Enough", key: "upwardThreshold" },
    { label: "Downward Enough", key: "downwardThreshold" },
    { label: "Pitch Up Threshold", key: "pitchUpThreshold" },
    { label: "Threshold", key: "motionThreshold" },
    { label: "Cooldown", key: "cooldown" }
  );

  metricsInfoEl.innerHTML = items
    .map((item) => {
      const info = requirementsInfo[item.key] || "Info unavailable.";
      return `<div class="info-item" data-key="${item.key}">
        <div class="info-item-header">
          <h3>${item.label}</h3>
          <button class="info-item-toggle" type="button" data-state="on" aria-pressed="true">
            <span class="toggle-dot"></span>
            <span class="toggle-label">On</span>
          </button>
        </div>
        <p>${info}</p>
      </div>`;
    })
    .join("");
}

function formatControlValue(control, rawValue) {
  const value = Number(rawValue);
  if (control.format === "int") return `${Math.round(value)}`;
  if (control.format === "ms") return `${Math.round(value)}ms`;
  if (control.format === "ratio") return value.toFixed(2);
  if (control.format === "threshold") return value.toFixed(3);
  return `${value}`;
}

function getRangeConfig(key, fallback) {
  if (!sliderRanges) return fallback;
  return sliderRanges[key] || fallback;
}

function ensureFingerThresholds() {
  if (!mushtiRequirements) return;
  if (!mushtiRequirements.fingerThresholds) {
    mushtiRequirements.fingerThresholds = {};
  }
  const defaultThreshold = mushtiRequirements.fingerThreshold ?? 0.92;
  (mushtiRequirements.fingers || []).forEach((finger) => {
    if (!Number.isFinite(mushtiRequirements.fingerThresholds[finger.name])) {
      mushtiRequirements.fingerThresholds[finger.name] = defaultThreshold;
    }
  });
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

function showSavedIndicator() {
  if (!controlsSavedEl) return;
  controlsSavedEl.classList.add("is-visible");
  if (savedTimeout) {
    clearTimeout(savedTimeout);
  }
  savedTimeout = setTimeout(() => {
    controlsSavedEl.classList.remove("is-visible");
  }, 1200);
}

function applySavedSettings() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    if (saved.mushti) {
      if (Number.isFinite(saved.mushti.fingerThreshold)) {
        mushtiRequirements.fingerThreshold = saved.mushti.fingerThreshold;
      }
      if (Number.isFinite(saved.mushti.requiredCurledFingers)) {
        mushtiRequirements.requiredCurledFingers =
          saved.mushti.requiredCurledFingers;
      }
      if (Number.isFinite(saved.mushti.thumbThreshold)) {
        if (!mushtiRequirements.thumb) {
          mushtiRequirements.thumb = {
            tipIndex: 4,
            mcpIndex: 2,
            threshold: saved.mushti.thumbThreshold
          };
        } else {
          mushtiRequirements.thumb.threshold = saved.mushti.thumbThreshold;
        }
      }
      if (saved.mushti.fingerThresholds) {
        Object.entries(saved.mushti.fingerThresholds).forEach(
          ([fingerName, value]) => {
            if (!Number.isFinite(value)) return;
            mushtiRequirements.fingerThresholds[fingerName] = value;
          }
        );
      }
    }
    if (saved.movement) {
      if (Number.isFinite(saved.movement.bufferMs)) {
        movementRequirements.bufferMs = saved.movement.bufferMs;
      }
      if (Number.isFinite(saved.movement.minSamples)) {
        movementRequirements.minSamples = saved.movement.minSamples;
      }
      if (Number.isFinite(saved.movement.displacementThreshold)) {
        movementRequirements.displacementThreshold =
          saved.movement.displacementThreshold;
      }
      if (Number.isFinite(saved.movement.cooldownMs)) {
        movementRequirements.cooldownMs = saved.movement.cooldownMs;
      }
      if (Number.isFinite(saved.movement.graceWindowMs)) {
        movementRequirements.graceWindowMs = saved.movement.graceWindowMs;
      }
      if (Number.isFinite(saved.movement.upwardThreshold)) {
        movementRequirements.upwardThreshold = saved.movement.upwardThreshold;
      }
      if (Number.isFinite(saved.movement.downwardThreshold)) {
        movementRequirements.downwardThreshold = saved.movement.downwardThreshold;
      }
      if (Number.isFinite(saved.movement.pitchUpThreshold)) {
        movementRequirements.pitchUpThreshold = saved.movement.pitchUpThreshold;
      }
    }
  } catch (error) {
    console.warn("Failed to load saved controls.", error);
  }
}

function persistControls() {
  const payload = {
    mushti: {
      fingerThreshold: mushtiRequirements.fingerThreshold,
      requiredCurledFingers: mushtiRequirements.requiredCurledFingers,
      thumbThreshold: mushtiRequirements.thumb
        ? mushtiRequirements.thumb.threshold
        : null,
      fingerThresholds: mushtiRequirements.fingerThresholds || {}
    },
    movement: {
      bufferMs: movementRequirements.bufferMs,
      minSamples: movementRequirements.minSamples,
      displacementThreshold: movementRequirements.displacementThreshold,
      cooldownMs: movementRequirements.cooldownMs,
      graceWindowMs: movementRequirements.graceWindowMs,
      upwardThreshold: movementRequirements.upwardThreshold,
      downwardThreshold: movementRequirements.downwardThreshold,
      pitchUpThreshold: movementRequirements.pitchUpThreshold
    }
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  showSavedIndicator();
}

function getControlsConfig() {
  const controls = [
    {
      id: "finger-threshold",
      label: "Finger Curl Threshold",
      group: "mushti",
      key: "fingerThreshold",
      ...getRangeConfig("fingerThreshold", { min: 0.7, max: 1.2, step: 0.01 }),
      format: "ratio",
      value: mushtiRequirements.fingerThreshold ?? 0.92
    }
  ];

  (mushtiRequirements.fingers || []).forEach((finger) => {
    const value =
      mushtiRequirements.fingerThresholds?.[finger.name] ??
      mushtiRequirements.fingerThreshold ??
      0.92;
    controls.push({
      id: `finger-${finger.name.toLowerCase()}`,
      label: `${finger.name} Curl`,
      group: "mushti-finger",
      key: finger.name,
      ...getRangeConfig("fingerThresholds", { min: 0.7, max: 1.2, step: 0.01 }),
      format: "ratio",
      value
    });
  });

  controls.push(
    {
      id: "thumb-threshold",
      label: "Thumb Touch Threshold",
      group: "mushti-thumb",
      key: "threshold",
      ...getRangeConfig("thumbThreshold", { min: 0.01, max: 0.2, step: 0.005 }),
      format: "threshold",
      value:
        (mushtiRequirements.thumb && mushtiRequirements.thumb.threshold) ?? 0.08
    },
    {
      id: "required-curled",
      label: "Required Curled",
      group: "mushti",
      key: "requiredCurledFingers",
      ...getRangeConfig("requiredCurledFingers", { min: 1, max: 5, step: 1 }),
      format: "int",
      value: mushtiRequirements.requiredCurledFingers ?? 4
    },
    {
      id: "buffer-ms",
      label: "Motion Window",
      group: "motion",
      key: "bufferMs",
      ...getRangeConfig("bufferMs", { min: 200, max: 2000, step: 50 }),
      format: "ms",
      value: movementRequirements.bufferMs ?? 1000
    },
    {
      id: "grace-window-ms",
      label: "Grace Window",
      group: "motion",
      key: "graceWindowMs",
      ...getRangeConfig("graceWindowMs", { min: 500, max: 4000, step: 100 }),
      format: "ms",
      value: movementRequirements.graceWindowMs ?? 2000
    },
    {
      id: "min-samples",
      label: "Min Samples",
      group: "motion",
      key: "minSamples",
      ...getRangeConfig("minSamples", { min: 5, max: 60, step: 1 }),
      format: "int",
      value: movementRequirements.minSamples ?? 20
    },
    {
      id: "upward-threshold",
      label: "Upward Enough",
      group: "motion",
      key: "upwardThreshold",
      ...getRangeConfig("upwardThreshold", { min: 0.01, max: 0.2, step: 0.005 }),
      format: "threshold",
      value: movementRequirements.upwardThreshold ?? 0.06
    },
    {
      id: "downward-threshold",
      label: "Downward Enough",
      group: "motion",
      key: "downwardThreshold",
      ...getRangeConfig("downwardThreshold", { min: 0.01, max: 0.2, step: 0.005 }),
      format: "threshold",
      value: movementRequirements.downwardThreshold ?? 0.06
    },
    {
      id: "pitch-up-threshold",
      label: "Pitch Up Threshold",
      group: "motion",
      key: "pitchUpThreshold",
      ...getRangeConfig("pitchUpThreshold", { min: 0.01, max: 0.2, step: 0.005 }),
      format: "threshold",
      value: movementRequirements.pitchUpThreshold ?? 0.04
    },
    {
      id: "displacement-threshold",
      label: "Displacement Threshold",
      group: "motion",
      key: "displacementThreshold",
      ...getRangeConfig("displacementThreshold", { min: 0.01, max: 0.2, step: 0.005 }),
      format: "threshold",
      value: movementRequirements.displacementThreshold ?? 0.08
    },
    {
      id: "cooldown-ms",
      label: "Cooldown",
      group: "motion",
      key: "cooldownMs",
      ...getRangeConfig("cooldownMs", { min: 500, max: 5000, step: 100 }),
      format: "ms",
      value: movementRequirements.cooldownMs ?? 2000
    }
  );

  return controls;
}

function buildClassifierConfig() {
  return {
    ...movementRequirements
  };
}

function renderControls() {
  if (!controlsEl || !mushtiRequirements || !movementRequirements) return;

  const controls = getControlsConfig();

  controlsEl.innerHTML = controls
    .map((control) => {
      const value = formatControlValue(control, control.value);
      const fingerAttr =
        control.group === "mushti-finger" ? ` data-finger="${control.key}"` : "";
      return `<div class="control" data-group="${control.group}" data-key="${control.key}"${fingerAttr}>
        <label for="${control.id}">${control.label}<span>${value}</span></label>
        <input id="${control.id}" type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${control.value}">
      </div>`;
    })
    .join("");
}

function updateControlsUI() {
  const controls = getControlsConfig();
  controls.forEach((control) => {
    const input = document.getElementById(control.id);
    if (!input) return;
    input.value = control.value;
    const label = input.closest(".control")?.querySelector("label span");
    if (label) {
      label.textContent = formatControlValue(control, control.value);
    }
  });
}

function bindControls() {
  if (!controlsEl) return;
  controlsEl.addEventListener("input", (event) => {
    const target = event.target;
    if (!target || target.tagName !== "INPUT") return;
    const control = target.closest(".control");
    if (!control) return;
    const group = control.getAttribute("data-group");
    const key = control.getAttribute("data-key");
    const label = control.querySelector("label span");
    if (!group || !key || !label) return;

    const value = Number(target.value);
    const format =
      key === "displacementThreshold" ||
      key === "upwardThreshold" ||
      key === "downwardThreshold" ||
      key === "pitchUpThreshold"
        ? "threshold"
        : key === "bufferMs" || key === "cooldownMs" || key === "graceWindowMs"
          ? "ms"
          : key === "fingerThreshold" || key === "threshold"
            ? "ratio"
            : "int";
    label.textContent = formatControlValue({ format }, value);

    if (group === "mushti") {
      mushtiRequirements[key] = value;
    } else if (group === "mushti-thumb") {
      if (!mushtiRequirements.thumb) {
        mushtiRequirements.thumb = {
          tipIndex: 4,
          mcpIndex: 2,
          threshold: value
        };
      } else {
        mushtiRequirements.thumb[key] = value;
      }
    } else if (group === "mushti-finger") {
      const fingerName = control.getAttribute("data-finger");
      if (!mushtiRequirements.fingerThresholds) {
        mushtiRequirements.fingerThresholds = {};
      }
      if (fingerName) {
        mushtiRequirements.fingerThresholds[fingerName] = value;
      }
    } else if (group === "motion") {
      movementRequirements[key] = value;
      classifier = createMotionClassifier(buildClassifierConfig());
    }
    persistControls();
  });
}

function bindResetControls() {
  if (!resetControlsButton) return;
  resetControlsButton.addEventListener("click", () => {
    if (!defaultMushtiRequirements || !defaultMovementRequirements) return;
    mushtiRequirements = cloneConfig(defaultMushtiRequirements);
    movementRequirements = cloneConfig(defaultMovementRequirements);
    ensureFingerThresholds();
    classifier = createMotionClassifier(buildClassifierConfig());
    updateControlsUI();
    renderMetricsInfo();
    persistControls();
  });
}

function bindControlsToggle() {
  if (!controlsToggle || !controlsCard) return;
  controlsToggle.addEventListener("click", () => {
    const isCollapsed = controlsCard.classList.contains("is-collapsed");
    controlsCard.classList.toggle("is-collapsed", !isCollapsed);
    controlsToggle.textContent = isCollapsed ? "Collapse" : "Expand";
    controlsToggle.setAttribute("aria-pressed", String(isCollapsed));
  });
}

function bindInfoToggles() {
  if (!metricsInfoEl) return;
  metricsInfoEl.addEventListener("click", (event) => {
    const toggle = event.target.closest(".info-item-toggle");
    if (!toggle) return;
    const item = toggle.closest(".info-item");
    if (!item) return;
    const isOn = toggle.getAttribute("data-state") === "on";
    const nextState = isOn ? "off" : "on";
    toggle.setAttribute("data-state", nextState);
    toggle.setAttribute("aria-pressed", String(!isOn));
    toggle.querySelector(".toggle-label").textContent = isOn ? "Off" : "On";
    item.classList.toggle("is-off", isOn);
  });
}

function bindInfoPanelToggle() {
  if (!infoPanelToggle || !infoPanelShow || !infoCard || !contentEl) return;

  const setHidden = (hidden) => {
    infoCard.classList.toggle("is-hidden", hidden);
    contentEl.classList.toggle("info-hidden", hidden);
    infoPanelToggle.textContent = hidden ? "Show" : "Hide";
    infoPanelToggle.setAttribute("aria-pressed", String(!hidden));
    infoPanelShow.classList.toggle("is-hidden", !hidden);
    infoPanelShow.setAttribute("aria-pressed", String(hidden));
  };

  infoPanelToggle.addEventListener("click", () => {
    setHidden(!infoCard.classList.contains("is-hidden"));
  });

  infoPanelShow.addEventListener("click", () => {
    setHidden(false);
  });
}

function bindCameraToggle() {
  if (!cameraToggle) return;
  cameraToggle.addEventListener("click", async () => {
      if (cameraActive) {
        stopWebcam();
        statusEl.textContent = "Camera stopped";
        cameraToggle.textContent = "Start Camera";
        cameraToggle.setAttribute("aria-pressed", "false");
        lastFist = false;
        actionLocked = false;
        graceStartY = null;
        graceStartMs = null;
        return;
      }

    try {
      statusEl.textContent = "Starting camera...";
      if (!handLandmarker) {
        await initHandLandmarker();
      }
      await startWebcam();
      lastVideoTime = -1;
      classifier.reset();
      statusEl.textContent = "Ready";
      cameraToggle.textContent = "Stop Camera";
      cameraToggle.setAttribute("aria-pressed", "true");
    } catch (error) {
      console.error(error);
      statusEl.textContent = "Failed to start camera.";
    }
  });
}

function logAction({ label, confidence }) {
  const entry = document.createElement("div");
  const timestamp = new Date().toLocaleTimeString();
  entry.className = `log-entry ${label.toLowerCase()}`;
  entry.textContent = `[${timestamp}] ${label} (${confidence.toFixed(2)})`;
  logEl.prepend(entry);
}

function detectHands() {
  if (!handLandmarker || !classifier || !cameraActive) {
    requestAnimationFrame(detectHands);
    return;
  }

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

      const pitchThreshold = movementRequirements?.pitchUpThreshold ?? 0.01;
      const pitch = getPitchUp(landmarks, pitchThreshold);

      mushtiEval.pitch = pitch;

      if (fist && classifier.cancelGrace) {
        classifier.cancelGrace();
        graceStartY = null;
        graceStartMs = null;
      }
      if (!fist && lastFist && classifier.startGrace) {
        classifier.startGrace(landmarks[0].y, nowMs);
        graceStartY = landmarks[0].y;
        graceStartMs = nowMs;
      }

      const diagnostics = classifier.getDiagnostics(nowMs);
      diagnostics.pitchUp = pitch.pitchUp;
      diagnostics.pitchDelta = pitch.delta;
      const graceActive =
        diagnostics.graceRemainingMs && diagnostics.graceRemainingMs > 0;
      const graceDisplacement =
        graceActive && graceStartY !== null ? landmarks[0].y - graceStartY : 0;

      if (!fist && graceActive && !actionLocked) {
        motion = classifier.update(landmarks, nowMs, null, {
          courageAllowed: pitch.pitchUp
        });
        if (motion) {
          logAction(motion);
          actionLocked = true;
        }
      } else {
        classifier.resetSamples();
      }

      if (fist && !lastFist) {
        actionLocked = false;
      }
      lastFist = fist;

      renderMetrics(
        fist,
        mushtiEval.metrics,
        diagnostics,
        mushtiEval.threshold,
        mushtiEval.requiredCurled,
        mushtiEval.thumbMetric
      );
      renderMushtiFeedback(mushtiEval, { graceActive, graceDisplacement });
    } else {
      ctx.clearRect(0, 0, displayWidth, displayHeight);
      classifier.reset();
      lastFist = false;
      actionLocked = false;
      graceStartY = null;
      graceStartMs = null;
      renderMetrics(
        false,
        null,
        classifier.getDiagnostics(Date.now()),
        null,
        null,
        null
      );
      renderMushtiFeedback(null);
    }
  }

  requestAnimationFrame(detectHands);
}

async function init() {
  try {
    statusEl.textContent = "Loading model...";
    await loadMushtiRequirements();
    await loadRequirementsInfo();
    await loadMovementRequirements();
    await loadSliderRanges();
    ensureFingerThresholds();
    defaultMushtiRequirements = cloneConfig(mushtiRequirements);
    defaultMovementRequirements = cloneConfig(movementRequirements);
    applySavedSettings();
    ensureFingerThresholds();
    renderMetricsInfo();
    renderControls();
    bindControls();
    classifier = createMotionClassifier(buildClassifierConfig());
    bindInfoToggles();
    bindInfoPanelToggle();
    bindResetControls();
    bindControlsToggle();
    bindCameraToggle();
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
