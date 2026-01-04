# Repository Guidelines

## Project Overview
This repository currently contains a planning document (`Codex Plan.txt`) for a browser-based hand-motion classifier. Source code is not yet checked in; use this guide to keep new files organized and contributions consistent.

## Project Structure & Module Organization
- `Codex Plan.txt`: product vision, architecture sketch, and a proposed web app layout.
- `mushti-classifier/` (planned): primary app directory.
  - `index.html`: UI shell and layout.
  - `app.js`: webcam + MediaPipe setup and runtime loop.
  - `classifier.js`: motion classification logic.
  - `style.css`: visual styling.
- `assets/` (optional): images, demo clips, or documentation media.

## Build, Test, and Development Commands
No build system is defined yet. For local testing of a static web app, serve the folder over localhost:
```bash
python -m http.server 8000
```
Open `http://localhost:8000` and ensure the webcam initializes correctly.

## Coding Style & Naming Conventions
- Indentation: 2 spaces for HTML/CSS/JS.
- File names: lowercase with hyphens for directories; lowercase for files (e.g., `app.js`, `style.css`).
- JS style: prefer `const`/`let`, early returns, and small functions (`initHandLandmarker()`, `classifyMotion()`).
- Keep MediaPipe URLs and model paths in one place for easy updates.

## Testing Guidelines
No automated test framework is configured. Manual checks should cover:
- Webcam permission prompt and live video.
- Landmark rendering stability and FPS.
- Motion classification thresholds.
If tests are added later, co-locate unit tests in `tests/` and name them `*.test.js`.

## Commit & Pull Request Guidelines
There is no established commit history in this repository. Until a convention emerges, use Conventional Commits (e.g., `feat: add motion classifier`). PRs should include:
- A short summary of the change and why it is needed.
- Any screenshots or short clips for UI/UX updates.
- Notes on manual test steps and results.

## Security & Configuration Tips
- Do not commit API keys or model files; use CDN-hosted MediaPipe assets.
- Ensure local testing uses `localhost` (MediaPipe requires a secure context).
