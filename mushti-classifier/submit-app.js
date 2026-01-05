const STORAGE_KEY = "submission-console-v1";

const readinessIds = [
  "chk-limitations",
  "chk-template",
  "chk-anonymity",
  "chk-dual",
  "chk-responsible",
  "chk-authors",
  "chk-review",
  "chk-preprint"
];

const fieldIds = [
  "meta-title",
  "meta-type",
  "meta-area",
  "meta-deadline",
  "meta-venue",
  "meta-preprint",
  "meta-ethics",
  "meta-ai",
  "meta-repo",
  "timeline-draft",
  "timeline-review",
  "timeline-submit",
  "timeline-register"
];

const contributionIds = [
  "contrib-resource",
  "contrib-analysis",
  "contrib-engineering",
  "contrib-lowresource",
  "contrib-application",
  "contrib-reproduction"
];

const artifactIds = [
  "art-paper",
  "art-appendix",
  "art-code",
  "art-data",
  "art-checklist"
];

function getEl(id) {
  return document.getElementById(id);
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn("Failed to parse submission state.", error);
    return null;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function readStateFromUI() {
  const state = {
    readiness: {},
    artifacts: {},
    contributions: {},
    fields: {}
  };

  readinessIds.forEach((id) => {
    const el = getEl(id);
    if (el) state.readiness[id] = el.checked;
  });

  artifactIds.forEach((id) => {
    const el = getEl(id);
    if (el) state.artifacts[id] = el.checked;
  });

  contributionIds.forEach((id) => {
    const el = getEl(id);
    if (el) state.contributions[id] = el.checked;
  });

  fieldIds.forEach((id) => {
    const el = getEl(id);
    if (!el) return;
    state.fields[id] = el.value;
  });

  return state;
}

function applyStateToUI(state) {
  if (!state) return;
  readinessIds.forEach((id) => {
    const el = getEl(id);
    if (el && state.readiness) {
      el.checked = Boolean(state.readiness[id]);
    }
  });

  artifactIds.forEach((id) => {
    const el = getEl(id);
    if (el && state.artifacts) {
      el.checked = Boolean(state.artifacts[id]);
    }
  });

  contributionIds.forEach((id) => {
    const el = getEl(id);
    if (el && state.contributions) {
      el.checked = Boolean(state.contributions[id]);
    }
  });

  fieldIds.forEach((id) => {
    const el = getEl(id);
    if (el && state.fields && state.fields[id] !== undefined) {
      el.value = state.fields[id];
    }
  });
}

function updateReadinessProgress() {
  const total = readinessIds.length;
  const checked = readinessIds.filter((id) => {
    const el = getEl(id);
    return el && el.checked;
  }).length;
  const percent = total === 0 ? 0 : Math.round((checked / total) * 100);

  const fill = getEl("readiness-progress");
  const label = getEl("readiness-label");
  if (fill) fill.style.width = `${percent}%`;
  if (label) label.textContent = `${percent}%`;
}

function bindInputs() {
  const inputs = [
    ...readinessIds,
    ...artifactIds,
    ...contributionIds,
    ...fieldIds
  ]
    .map((id) => getEl(id))
    .filter(Boolean);

  inputs.forEach((input) => {
    input.addEventListener("input", () => {
      saveState(readStateFromUI());
      updateReadinessProgress();
    });
  });
}

function buildSummaryText(state) {
  const title = state.fields["meta-title"] || "(untitled)";
  const area = state.fields["meta-area"] || "(not set)";
  const type = state.fields["meta-type"] || "(not set)";
  const deadline = state.fields["meta-deadline"] || "(not set)";
  const venue = state.fields["meta-venue"] || "(not set)";
  const preprint = state.fields["meta-preprint"] || "(not set)";

  const contributions = contributionIds
    .filter((id) => state.contributions[id])
    .map((id) => getEl(id)?.parentElement?.textContent?.trim())
    .filter(Boolean);

  const readiness = readinessIds
    .map((id) => {
      const label = getEl(id)?.parentElement?.textContent?.trim() || id;
      return `- [${state.readiness[id] ? "x" : " "}] ${label}`;
    })
    .join("\n");

  const artifacts = artifactIds
    .map((id) => {
      const label = getEl(id)?.parentElement?.textContent?.trim() || id;
      return `- [${state.artifacts[id] ? "x" : " "}] ${label}`;
    })
    .join("\n");

  return `ACL Submission Summary\n\nTitle: ${title}\nType: ${type}\nArea: ${area}\nDeadline: ${deadline}\nVenue: ${venue}\nPreprint: ${preprint}\n\nContributions:\n${contributions.length ? contributions.map((item) => `- ${item}`).join("\n") : "- (none)"}\n\nReadiness:\n${readiness}\n\nArtifacts:\n${artifacts}\n\nEthics Notes:\n${state.fields["meta-ethics"] || "(none)"}\n\nAI Assistance:\n${state.fields["meta-ai"] || "(none)"}\n\nAnonymous Repo:\n${state.fields["meta-repo"] || "(none)"}\n\nTimeline:\n- Draft: ${state.fields["timeline-draft"] || "(not set)"}\n- Internal review: ${state.fields["timeline-review"] || "(not set)"}\n- ARR submission: ${state.fields["timeline-submit"] || "(not set)"}\n- Author registration: ${state.fields["timeline-register"] || "(not set)"}`;
}

function bindCopySummary() {
  const button = getEl("copy-summary");
  if (!button) return;
  button.addEventListener("click", async () => {
    const state = readStateFromUI();
    const text = buildSummaryText(state);
    try {
      await navigator.clipboard.writeText(text);
      const original = button.textContent;
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = original;
      }, 1200);
    } catch (error) {
      console.warn("Failed to copy summary.", error);
      alert("Copy failed. You can manually select the text from the console.");
    }
  });
}

function init() {
  const state = loadState();
  applyStateToUI(state);
  updateReadinessProgress();
  bindInputs();
  bindCopySummary();
}

init();
