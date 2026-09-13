# VED Floor Plan Review & Auto-Annotation System

![Node.js](https://img.shields.io/badge/Node.js-v20+-339933?style=flat-square&logo=node.js&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.10%20%7C%203.11-3776AB?style=flat-square&logo=python&logoColor=white)
![Ultralytics YOLO](https://img.shields.io/badge/YOLO-v11%20%7C%20v26%20%7C%20Custom-00FFFF?style=flat-square&logo=ultralytics&logoColor=black)
![Google Gemini](https://img.shields.io/badge/Google%20Gemini-3.8%20Flash%20Vision-8E75B2?style=flat-square&logo=google&logoColor=white)
![Groq](https://img.shields.io/badge/Groq-Qwen%203.8%20%2F%203.6%20Vision-F55036?style=flat-square)
![Konva.js](https://img.shields.io/badge/Konva.js-Canvas%202D-0D96F2?style=flat-square)
![Sharp](https://img.shields.io/badge/Sharp-Image%20Processing-990000?style=flat-square)
![Status](https://img.shields.io/badge/Environment-Portable%20%7C%20Offline%20First-007ACC?style=flat-square)

---

## Table of Contents

- [What the System Is](#what-the-system-is)
- [Description](#description)
- [Key Features](#key-features)
- [Multi-Tier Detection Architecture](#multi-tier-detection-architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Configuration](#environment-configuration)
- [Usage Workflow and Steps](#usage-workflow-and-steps)
- [Collaboration and Review Merging](#collaboration-and-review-merging)
- [Project Structure](#project-structure)
- [Annotation Limitations](#annotation-limitations)
- [Verification and Testing](#verification-and-testing)
- [Acknowledgements](#acknowledgements)

---

## What the System Is

The Visual Electrical Dataset (VED) Floor Plan Review & Auto-Annotation System is a portable, high-performance architectural plan inspection workbench and multi-tier AI auto-annotation platform.

The system enables electrical engineers, CAD reviewers, and machine learning practitioners to review, verify, correct, and augment electrical symbol annotations on large-format floor plans. It combines an interactive client-side 2D HTML5 canvas with a resilient, multi-tier AI vision pipeline supporting local Ultralytics YOLO object detection, Google Gemini Vision, and Groq Qwen Vision with automated model hopping.

---

## Description

Architectural floor plans are high-density, complex technical drawings containing hundreds of symbols (receptacles, switches, panelboards, lighting fixtures, homerun circuit tags) alongside architectural geometry, text labels, and wiring paths. Traditional computer vision and generic object detectors often fail due to resolution constraints, non-standard symbols across drafting groups, and severe symbol density.

This system solves these challenges through:

1. **High-Resolution Canvas Workspace**: An interactive, browser-based Konva.js canvas engine supporting smooth zooming, panning, rotation, and multi-layer annotation manipulation without downsampling source drawing fidelity.
2. **Overlapping Tile Analysis**: A tiling engine that divides drawings into 1024x1024 pixel regions with 200px stride overlaps to prevent boundary-clipped symbols from being missed.
3. **Multi-Tier Model Cascade**: A resilient detection pipeline that utilizes fast, local fine-tuned YOLO weights first, and automatically falls back to cloud vision APIs (Gemini 3.8 Flash, Groq Qwen 3.8/3.6, and alternate Gemini models) when local detection is unavailable or model hopping is required.
4. **Visual Context Prompting**: Dynamic visual contact sheet generation from verified legend libraries, providing visual few-shot context directly to vision-language models.
5. **Conflict-Free Collaboration**: Offline-capable file formats with deterministic merge scripts (`scripts/merge-reviews.cjs`) allowing distributed teams to review independent drawing sets and resolve conflicting edits systematically.

---

## Key Features

- **Interactive Canvas Review**:
  - Multi-layer toggle: Symbols/Homerun tags, Geometry (walls/openings), Wiring paths, Text/Dimensions, Unresolved areas, Legend examples, Drawing regions, and OCR text.
  - Precise geometry manipulation: Draw bounding boxes, multi-segment polyline wiring runs, and closed boundary polygons.
  - Multi-selection: Shift-click selection, rectangular box grouping (`Ctrl+G`), ungrouping (`Ctrl+Shift+G`), and bulk property assignments.
  - Undo / Redo engine: Full transaction history preserving zoom and viewport position (`Ctrl+Z` / `Ctrl+Y`).
  - Dark / Light interface theme: System-matched and user-toggleable theme with persistent local storage.

- **AI Auto-Annotation Engine**:
  - One-click detection: Trigger automatic symbol extraction across the entire active sheet using `Ctrl+A` or the toolbar button.
  - Primary Local Inference: Instant local bounding box predictions powered by custom fine-tuned YOLO models (`models/ved-symbols.pt`).
  - Automatic Model Hopping: Seamless failover between YOLO, Gemini 3.8 Flash, Groq Qwen 3.8, Groq Qwen 3.6, and fallback Gemini endpoints.
  - Batch Review Controls: One-click "Accept all auto", "Reject all auto", and "Mark all corrected" actions.
  - Intelligent Deduplication: IoU and spatial containment suppression against existing annotations, human corrections, and deleted annotations.

- **Legend Reference Integration**:
  - Legend snippet upload: Extract symbol definitions directly from PDF or image legend drawings.
  - Searchable class catalog: Rapid classification and color assignment linked directly to local legend definitions.

- **Zero-Install Portability**:
  - Runs directly as a static bundle in any standard web browser (`review.html`) via `file://` or through the local Node.js server (`server.cjs`).

---

## Multi-Tier Detection Architecture

The auto-annotation engine (`auto-annotate.cjs`) implements an automated model hopping hierarchy designed for maximum reliability, speed, and cost efficiency:

```
[ Sheet Image ]
       |
       v
[ Overlapping Tile Generator ] (1024x1024 tiles, 200px stride)
       |
       v
+-------------------------------------------------------------------+
| Tier 1: Local Ultralytics YOLO                                   |
| Model: models/ved-symbols.pt (Fallback: yolo11n.pt, yolo26n.pt)   |
| Engine: Python 3 runtime via yolo_detect.py                       |
+-------------------------------------------------------------------+
       | (If YOLO disabled, fails, or produces no detections)
       v
+-------------------------------------------------------------------+
| Tier 2: Cloud Primary (Google Gemini 3.8 Flash)                   |
| Model: gemini-3.8-flash                                           |
| Engine: Multi-part Vision API with Dynamic Reference Contact Sheets|
+-------------------------------------------------------------------+
       | (If rate limited, HTTP 429/503, or invalid output)
       v
+-------------------------------------------------------------------+
| Tier 3: Cloud Fast Alternative (Groq Qwen 3.8 27B)                |
| Model: qwen/qwen3.8-27b                                           |
| Optimization: 512x512 JPEG resizing, strict JSON extraction       |
+-------------------------------------------------------------------+
       | (If Qwen 3.8 rate limited or unavailable)
       v
+-------------------------------------------------------------------+
| Tier 4: Cloud Alternative Fallback (Groq Qwen 3.6 27B)           |
| Model: qwen/qwen3.6-27b                                           |
| Optimization: Reasoning tag stripping (<think>...</think>)        |
+-------------------------------------------------------------------+
       | (If Groq limits exceeded)
       v
+-------------------------------------------------------------------+
| Tier 5: Extended Gemini Fallback Cascade                          |
| Models: gemini-3.7-flash -> 3.6-flash -> 3.5-flash -> flash-latest|
+-------------------------------------------------------------------+
       |
       v
[ Coordinate Transformer ] (Tile normalized 0-1000 -> Drawing Pixel Space)
       |
       v
[ Suppression & Deduplication ] (IoU >= 0.70, Containment >= 0.85)
       |
       v
[ Interactive Review Canvas ]
```

---

## Tech Stack

### Core Technologies
- **Runtime Environment**: Node.js (CommonJS, native fetch, loadEnvFile)
- **AI / Inference Backend**: Python 3, PyTorch, Ultralytics YOLO
- **Cloud AI Providers**: Google Gemini Generative Language API, Groq Cloud API
- **Frontend Engine**: HTML5 Canvas, Vanilla JavaScript (ES2022), CSS3 (Modern Flex/Grid, Custom Properties)
- **Canvas Rendering**: Konva.js v9
- **Document Processing**: PDF.js (Mozilla), Sharp (Node.js High-Performance Image Processing)

### Technology Matrix

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| Application Server | Node.js HTTP Server (`server.cjs`) | Serves static assets, routes `/api/auto-annotate` and `/api/status` |
| Local Inference | Ultralytics YOLO (`yolo_detect.py`) | Low-latency local symbol detection on CPU or CUDA GPU |
| Cloud Vision | Google Gemini 3.8 Flash | Structured JSON visual object detection with reference contact sheets |
| Cloud Vision Fallback | Groq Qwen 3.8 / 3.6 Vision | High-throughput open-weight vision model failover |
| Canvas Rendering | Konva.js (`konva.min.js`) | Multi-layer 2D scene graph rendering and geometric transformation |
| Image Processing | Sharp (`sharp`) | High-speed image slicing, tiling, and thumbnail contact sheet creation |
| Document Rendering | PDF.js (`pdf.min.js`) | Direct client-side rasterization of PDF architectural sheets and legends |

---

## Prerequisites

Ensure the following environments are installed on your host system:

1. **Node.js**:
   - Version 20.0.0 or higher is required.
   - Verify installation:
     ```powershell
     node --version
     npm --version
     ```

2. **Python** (Required for local YOLO detection):
   - Python 3.10 or 3.11 recommended.
   - Verify installation:
     ```powershell
     python --version
     ```

3. **PyTorch & Ultralytics** (Required for local YOLO detection):
   - Install using pip:
     ```powershell
     pip install ultralytics torch torchvision
     ```

4. **API Keys** (Optional, required for cloud vision detection):
   - Google Gemini API key: Obtain from Google AI Studio.
   - Groq API key: Obtain from Groq Cloud Console.

---

## Installation

### 1. Clone or Extract the Repository
```powershell
git clone https://github.com/your-org/VED-floor-plan-review-portable.git
cd VED-floor-plan-review-portable
```

### 2. Install Node.js Dependencies
Install `sharp` for server-side tile generation and image packaging:
```powershell
npm install
```

### 3. Install Python Dependencies
Install Ultralytics and PyTorch for local YOLO execution:
```powershell
pip install ultralytics torch torchvision
```

### 4. Verify Model Weights
Ensure detection weights are present in the `models/` directory:
- `models/ved-symbols.pt` (Fine-tuned VED electrical symbol model)
- `models/yolo11n.pt` (Ultralytics YOLO11 nano base model)
- `models/yolo26n.pt` (Ultralytics YOLO26 nano base model)

---

## Environment Configuration

Configuration is managed via the `.env` file in the root directory. Copy `.env.example` or edit `.env` directly:

```ini
# Port for local review server
PORT=3000

# Google Gemini API Configuration
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.8-flash
GEMINI_MAX_ROUNDS=4

# Groq Vision API Configuration
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=qwen/qwen3.8-27b
GROQ_FALLBACK_MODEL=qwen/qwen3.6-27b

# Local YOLO Configuration
ENABLE_LOCAL_YOLO=true
YOLO_PYTHON=python
YOLO_MODEL=models/ved-symbols.pt
YOLO_CONFIDENCE=0.25
YOLO_IOU=0.45
```

---

## Usage Workflow and Steps

### Step 1: Verify Environment and Connectivity
Run the diagnostic utilities to verify provider status:
```powershell
npm run diagnose:groq
npm run diagnose:gemini
```

### Step 2: Start the Local Application Server
Launch the server from the root directory:
```powershell
npm start
```
The server outputs its connection details:
```
VED Review & Auto-Annotation Server running at http://127.0.0.1:3000/
Gemini API Key configured: true
Groq API Key configured: true
Local YOLO configured: true (models/ved-symbols.pt)
Model Hopping: ENABLED
```

### Step 3: Open the Workspace
Open your web browser and navigate to:
```
http://127.0.0.1:3000/review.html
```
*(Alternatively, you can open `review.html` directly in modern browsers via `file:///` protocol).*

### Step 4: Load a Drawing
1. In the top navigation bar, select a **Group** and a **Drawing** (e.g., Drawing Group 21, sheet-45).
2. Alternatively, click **Attach image** to load an arbitrary technical drawing (PNG, JPG, WebP, or PDF).
3. To load previously saved progress, click **Import review** and select `data/starting-progress.json`.

### Step 5: Execute Auto-Annotation
1. Click the **Auto annotate** button in the header or press `Ctrl+A`.
2. The engine evaluates local YOLO first. If unavailable or disabled, it queries Gemini 3.8 Flash, then Qwen 3.8, and so on.
3. Newly detected symbols appear on the canvas with distinct dashed visual proposal borders.
4. Use the bulk buttons in the sidebar:
   - **Accept all auto**: Approves all proposed symbols on the drawing and transitions them into active review state.
   - **Reject all auto**: Dismisses all proposals on the current drawing.

### Step 6: Manual Correction and Annotation
- **Select / Move**: Click any annotation to view its attributes. Drag corner handles to resize.
- **Draw New Annotations**: Right-click the canvas and select:
  - **Draw box**: Drag to create a symbol or room box.
  - **Draw line**: Click vertices along conduit or wiring paths. Click **Finish drawing** or press `Enter` to complete.
  - **Draw boundary**: Click boundary polygon points for room or department zones.
- **Assign Classification**: Choose from the searchable **Legend class** dropdown or assign custom text labels.
- **Wall & Opening Classification**: Set layer to "Wall / room / opening" to specify glass, fire-rated, partition, curtain wall, or opening types.

### Step 7: Exporting Your Work
1. Click **Export review** in the top-right header.
2. A timestamped JSON file (e.g., `ved-review-export-2026-09-13.json`) is downloaded.
3. Keep individual reviewer exports separate to maintain an immutable audit trail.

---

## Collaboration and Review Merging

When multiple annotators work independently on different drawings or partitions, combine their exported JSON files without data loss:

```powershell
node scripts/merge-reviews.cjs data/starting-progress.json review-annotator-a.json review-annotator-b.json data/merged-review.json
```

The script performs three-way conflict detection:
- Safe additions and non-conflicting edits from each reviewer are automatically combined.
- Any conflicting edits (e.g., two annotators modifying the same box geometry or classification differently) are logged to an adjacent conflict report file for manual inspection.

---

## Project Structure

```
VED-floor-plan-review-portable/
|-- .env                                # Environment variable configuration (API keys, models)
|-- .gitignore                          # Git exclusions for node_modules and temporary files
|-- package.json                        # Node.js project manifest, dependencies, and test scripts
|-- auto-annotate.cjs                   # Multi-tier auto-annotation engine and model hopping logic
|-- server.cjs                          # HTTP server and REST endpoints (/api/auto-annotate, /api/status)
|-- yolo_detect.py                      # Python bridge script executing Ultralytics YOLO inference
|-- review.html                         # Portable web application interface
|-- review.js                           # Core canvas controller, state management, and event handling
|-- editor-core.js                      # Shared geometric validation and annotation data structures
|-- data.js                             # Baseline drawing index and geometry specifications
|-- expanded-dataset.js                 # Extended dataset definitions and sheet records
|-- reference-library.js                # Legend symbol dictionary and catalog reference models
|-- reference-panel.js                  # Legend search and browser sidebar panel
|-- switch-proposals.js                 # Switch detection heuristics and proposal builders
|-- workspace-ui.js                     # UI controls, keyboard shortcuts, and theme manager
|-- workspace.css                       # Application stylesheet (responsive light and dark modes)
|-- legend-import.js                    # Interactive PDF/image legend crop and ingest module
|-- konva.min.js                        # Konva.js 2D HTML5 canvas library
|-- konva-enhancements.js               # Canvas extensions (snapping, multi-selection, group drag)
|-- pdf.min.js                          # Mozilla PDF.js rendering engine
|-- pdf.worker.js                       # Mozilla PDF.js web worker
|-- pdf.worker.min.js                   # Minified PDF.js web worker
|
|-- models/                             # Object detection neural network models
|   |-- ved-symbols.pt                  # Custom fine-tuned YOLO weights for electrical symbols
|   |-- ved-symbols.training.json       # Training metadata and label class mappings
|   |-- yolo11n.pt                      # Ultralytics YOLO11 nano model weights
|   |-- yolo26n.pt                      # Ultralytics YOLO26 nano model weights
|
|-- data/                               # Dataset records, catalogs, and exported progress
|   |-- approved-references.json        # Curated reference catalog (3,167 records across 52 sheets)
|   |-- starting-progress.json          # Baseline review progress payload
|   |-- labeled-review.json             # Labeled electrical review dataset
|   |-- output_payload.json             # Verified reference fixture payload
|
|-- scripts/                            # Operational, conversion, and diagnostic utilities
|   |-- diagnose-gemini.cjs             # Checks Gemini API key and queries available models
|   |-- diagnose-gemini-images.cjs      # Verifies multi-part image payload encoding
|   |-- diagnose-groq.cjs               # Checks Groq API key and queries available Qwen models
|   |-- label-review.cjs                # Maps verified legend references to review annotations
|   |-- merge-reviews.cjs               # Deterministic multi-reviewer JSON merge utility
|   |-- prepare-approved-data.cjs       # Compiles approved reference data library
|   |-- run-quality-trial.cjs           # Benchmarks detection quality on 5 representative sheets
|
|-- tests/                              # Automated test suites
|   |-- test-auto-annotate.cjs          # Comprehensive auto-annotation test suite
|   |-- test-server-integration.cjs     # HTTP server and API endpoint integration tests
|   |-- test-qwen-fallback.cjs          # Unit tests for model hopping and cooldown failovers
|   |-- zoom-validation.test.js         # Canvas zoom, pan, and transform regression tests
|
|-- docs/                               # System documentation and AI prompt schemas
|   |-- GEMINI-SYMBOL-DETECTION-PROMPT.txt # System instruction and schema for Gemini Vision
|   |-- Tool Functions & Action Logic Breakdown.md # Deep-dive documentation on canvas tools
|
|-- images/                             # High-resolution architectural floor plans (sheet-01 to 52)
|-- references/                         # Legend sheets, symbols, and supplemental reference crops
`-- backups/                            # Dated version checkpoints and configuration archives
```

---

## Annotation Limitations

When using this system, annotators and engineers must adhere to the following limitations and domain constraints:

1. **Heuristic Bounding Boxes**:
   - Model predictions are proposals and must be verified by a human reviewer.
   - Bounding boxes near tile boundaries (1024x1024 grid lines) may occasionally be split or duplicate if visual features extend across boundary edges.

2. **Non-Exhaustive Labels & Negative Labels**:
   - Technical drawings may contain unmodeled specialized equipment.
   - An unmarked region does **NOT** indicate a negative training label; it merely denotes an unannotated or unclassified region.

3. **No Guessing of Concealed Raceways**:
   - The "Wiring" layer is strictly reserved for **Observed Wiring Paths** visibly drafted on the drawing.
   - Annotators must **never** extrapolate, estimate, or guess concealed conduit routes, embedded floor ducting, or in-slab wiring runs.

4. **Homerun Tag Distinction**:
   - Arrowhead homerun tags indicating panelboard homerun circuits are classified as **Symbols / Homerun**, not wiring geometry.

5. **OCR and Text Transcription**:
   - Optical Character Recognition (OCR) text captures alphanumeric identifiers (e.g., panel names, room numbers, circuit circuiting tags).
   - High-density drafting lines crossing text blocks can cause OCR misinterpretations; manual verification is required before accepting OCR-generated records.

6. **Training-Use Approval Separation**:
   - Marking an annotation as "Reviewed" or selecting "Candidate after corrections" represents draft review feedback only.
   - It does **NOT** constitute formal dataset sign-off or engineering approval. Source drawings and verified reference masters remain unaltered.

7. **API Rate Limits and Provider Quotas**:
   - Free and standard tier cloud AI APIs enforce Requests Per Minute (RPM) and Tokens Per Minute (TPM) limits.
   - When large sheets (16+ tiles) are processed concurrently, the engine automatically schedules brief cooldown intervals to respect provider rate ceilings.

---

## Verification and Testing

The repository includes a comprehensive, emoji-free test suite verifying data integrity, geometry conversion, tiling, and model failovers.

Run all automated test suites:

```powershell
# Run auto-annotation engine test suite
npm test

# Run server and HTTP endpoint integration tests
npm run test:server

# Run Qwen model hopping and fallback unit tests
npm run test:qwen
```

### Test Coverage Highlights:
- **Test 1**: Verifies 52 floor plan sheets against SHA-256 integrity hashes and validates 3,167 approved reference annotations.
- **Test 2**: Validates square and non-square normalized (0-1000) coordinate conversions into full-scale pixel space.
- **Test 3**: Tests 1024x1024 tile generation with 200px stride over large drawings (e.g., 2864x3252).
- **Test 4**: Ensures multi-role legend sheets are rejected from auto-annotation to prevent recursive definition contamination.
- **Test 5**: Verifies truthful path execution without API keys or models (prevents silent mock fallbacks).
- **Test 6**: Validates explicit fixture generation mode across sheets 45, 46, and 49.
- **Test 7**: Tests contact sheet packaging under the strict 5-image ceiling limit.
- **Test 8**: Tests IoU (Intersection over Union) and containment suppression logic for duplicate bounding boxes.

---

## Acknowledgements

- **Ultralytics**: For the high-performance YOLO object detection framework.
- **Google DeepMind**: For the Gemini multimodal vision-language models.
- **Groq**: For low-latency LPU inference acceleration and Qwen model hosting.
- **Qwen Team (Alibaba Cloud)**: For the open-weight Qwen vision foundation models.
- **Konva.js Team**: For the HTML5 2D canvas library.
- **Mozilla**: For PDF.js client-side document rasterization.
- **Lovell Fuller and Sharp Contributors**: For the libvips Node.js image processing library.
- **VED Project Contributors**: For dataset collection, electrical symbol categorization, and architectural domain expertise.
