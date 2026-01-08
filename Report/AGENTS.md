# Repository Guidelines

## Project Structure & Module Organization
This repository currently centers on a planning document: `Codex Plan.txt`, which describes the browser-based hand-motion classifier. Source code is not yet checked in. When implementation begins, place it under `mushti-classifier/`:
- `mushti-classifier/index.html`: UI shell and layout.
- `mushti-classifier/app.js`: webcam + MediaPipe setup and runtime loop.
- `mushti-classifier/classifier.js`: motion classification logic.
- `mushti-classifier/style.css`: visual styling.
Optional media can live in `assets/` (images, demo clips).

## Build, Test, and Development Commands
No build system is defined yet. For local testing of the static app, serve the folder over localhost:
```bash
python -m http.server 8000
```
Open `http://localhost:8000` and verify the webcam initializes correctly (MediaPipe requires a secure context).

## Coding Style & Naming Conventions
- Indentation: 2 spaces for HTML/CSS/JS.
- File naming: lowercase files (`app.js`, `style.css`); directories use lowercase with hyphens.
- JS style: prefer `const`/`let`, early returns, and small functions (e.g., `initHandLandmarker()`, `classifyMotion()`).
- Keep MediaPipe URLs and model paths in a single place to simplify updates.

## Testing Guidelines
No automated test framework is configured. Manual checks should cover:
- Webcam permission prompt and live video.
- Landmark rendering stability and FPS.
- Motion classification thresholds.
If tests are added later, place them in `tests/` and name files `*.test.js`.

## Commit & Pull Request Guidelines
Use Conventional Commits until a project history emerges (e.g., `feat: add motion classifier`). PRs should include:
- A short summary of the change and why it is needed.
- Any UI/UX screenshots or short clips.
- Notes on manual testing steps and results.

## Security & Configuration Tips
- Do not commit API keys or model files; use CDN-hosted MediaPipe assets.
- Test locally on `localhost` to satisfy secure-context requirements.
