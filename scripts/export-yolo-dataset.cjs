// export-yolo-dataset.cjs
// Converts VED review annotations into standard Ultralytics YOLO training format:
// images/, labels/ (*.txt), classes.txt, dataset.yaml, and review_export.json.
// Zero emojis in output.

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

function normalizeClassName(name) {
  if (!name || typeof name !== 'string') return 'unclassified';
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function loadBaseClasses() {
  const metaPath = path.join(ROOT_DIR, 'models', 'ved-symbols.training.json');
  const classList = [];
  const classToId = new Map();

  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.class_names && typeof meta.class_names === 'object') {
        const sortedKeys = Object.keys(meta.class_names).map(k => parseInt(k, 10)).sort((a, b) => a - b);
        for (const idx of sortedKeys) {
          const rawName = meta.class_names[String(idx)];
          classList[idx] = rawName;
          classToId.set(normalizeClassName(rawName), idx);
        }
      }
    } catch (e) {
      console.warn('[YOLO Export] Notice reading ved-symbols.training.json:', e.message);
    }
  }
  return { classList, classToId };
}

function extractBox(annotation) {
  const g = annotation?.geometry;
  if (!g || !Array.isArray(g.coordinates)) return null;

  if (g.type === 'bbox' && g.coordinates.length === 4) {
    const [x1, y1, x2, y2] = g.coordinates;
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    if (maxX > minX && maxY > minY) {
      return [minX, minY, maxX, maxY];
    }
  } else if ((g.type === 'polygon' || g.type === 'polyline') && g.coordinates.length >= 2) {
    const xs = g.coordinates.map(p => p[0]);
    const ys = g.coordinates.map(p => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    if (maxX > minX && maxY > minY) {
      return [minX, minY, maxX, maxY];
    }
  }
  return null;
}

function exportYoloDataset(payload, options = {}) {
  // No writes until trusted approval, completeness and split evidence exist.
  throw Object.assign(new Error('Training export blocked: verified project splits, task completeness, and authenticated dataset approval are required. Use Dataset readiness to review the gaps.'), { code: 'DATASET_NOT_READY' });
}

// Standalone CLI execution
if (require.main === module) {
  console.log('================================================================');
  console.log('VED YOLO Training Dataset Exporter');
  console.log('================================================================\n');

  const inputArg = process.argv[2];
  let inputPath = null;

  if (inputArg) {
    inputPath = path.resolve(inputArg);
  } else {
    const candidate1 = path.join(ROOT_DIR, 'data', 'labeled-review.json');
    const candidate2 = path.join(ROOT_DIR, 'data', 'starting-progress.json');
    if (fs.existsSync(candidate1)) inputPath = candidate1;
    else if (fs.existsSync(candidate2)) inputPath = candidate2;
  }

  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error('Error: Could not find review dataset JSON to export.');
    console.error('Usage: node scripts/export-yolo-dataset.cjs [path/to/review.json] [output-dir]');
    process.exit(1);
  }

  const outputArg = process.argv[3] || path.join(ROOT_DIR, 'training_dataset');
  const outputDir = path.resolve(outputArg);

  console.log(`Source dataset:   ${inputPath}`);
  console.log(`Target directory: ${outputDir}\n`);

  try {
    const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const summary = exportYoloDataset(payload, { outputDir });

    console.log('Export completed successfully!');
    console.log(`- Total Sheets:        ${summary.total_sheets}`);
    console.log(`- Total Bounding Boxes: ${summary.total_bounding_boxes}`);
    console.log(`- Total Classes:       ${summary.total_classes}`);
    console.log(`- Output Files:        ${outputDir}`);
    console.log('\nReady for training with Ultralytics YOLO:');
    console.log(`  yolo detect train data="${path.join(outputDir, 'dataset.yaml')}" model=yolo11n.pt epochs=100 imgsz=1024\n`);
  } catch (err) {
    console.error('Export failed:', err.message);
    process.exit(1);
  }
}

module.exports = {
  exportYoloDataset,
  loadBaseClasses,
  extractBox
};
