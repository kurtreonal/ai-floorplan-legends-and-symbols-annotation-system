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
  const outputDir = options.outputDir || path.join(ROOT_DIR, 'training_dataset');
  const imagesDir = path.join(outputDir, 'images');
  const labelsDir = path.join(outputDir, 'labels');

  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(labelsDir, { recursive: true });

  const { classList, classToId } = loadBaseClasses();

  function getOrCreateClassId(label) {
    const normalized = normalizeClassName(label);
    if (classToId.has(normalized)) {
      return classToId.get(normalized);
    }
    const newId = classList.length;
    classList.push(label.trim());
    classToId.set(normalized, newId);
    return newId;
  }

  const sheets = payload.sheets || [];
  let exportedSheetsCount = 0;
  let totalBoxesCount = 0;
  const classCounts = {};

  for (const sheet of sheets) {
    const sheetWidth = Number(sheet.width);
    const sheetHeight = Number(sheet.height);
    if (!sheetWidth || !sheetHeight || sheetWidth <= 0 || sheetHeight <= 0) continue;

    // Filter active annotations (exclude deleted)
    const activeAnnotations = (sheet.annotations || []).filter(a => {
      if (a.review_state === 'deleted') return false;
      // Focus on symbols, legends, or any annotated bounding boxes
      return true;
    });

    const yoloLines = [];

    for (const ann of activeAnnotations) {
      const box = extractBox(ann);
      if (!box) continue;

      const [x1, y1, x2, y2] = box;
      // Clamp coordinates to sheet boundary
      const cx1 = Math.max(0, Math.min(sheetWidth, x1));
      const cy1 = Math.max(0, Math.min(sheetHeight, y1));
      const cx2 = Math.max(0, Math.min(sheetWidth, x2));
      const cy2 = Math.max(0, Math.min(sheetHeight, y2));

      const w = cx2 - cx1;
      const h = cy2 - cy1;
      if (w <= 1 || h <= 1) continue;

      const xCenter = (cx1 + w / 2) / sheetWidth;
      const yCenter = (cy1 + h / 2) / sheetHeight;
      const normW = w / sheetWidth;
      const normH = h / sheetHeight;

      if (xCenter <= 0 || yCenter <= 0 || normW <= 0 || normH <= 0) continue;

      const label = ann.label || ann.legend_entry || 'symbol';
      const classId = getOrCreateClassId(label);

      yoloLines.push(`${classId} ${xCenter.toFixed(6)} ${yCenter.toFixed(6)} ${normW.toFixed(6)} ${normH.toFixed(6)}`);
      classCounts[classList[classId]] = (classCounts[classList[classId]] || 0) + 1;
      totalBoxesCount++;
    }

    // Resolve sheet image file
    let srcImagePath = null;
    let imageExt = '.jpg';

    if (sheet.image && typeof sheet.image === 'string') {
      if (sheet.image.startsWith('data:')) {
        const match = sheet.image.match(/^data:image\/(\w+);base64,(.*)$/);
        if (match) {
          imageExt = `.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
          const destName = `${sheet.id}${imageExt}`;
          fs.writeFileSync(path.join(imagesDir, destName), Buffer.from(match[2], 'base64'));
          srcImagePath = 'written_from_base64';
        }
      } else {
        const candidate1 = path.join(ROOT_DIR, sheet.image);
        const candidate2 = path.join(ROOT_DIR, 'images', path.basename(sheet.image));
        const candidate3 = path.join(ROOT_DIR, 'references', sheet.image);
        if (fs.existsSync(candidate1)) srcImagePath = candidate1;
        else if (fs.existsSync(candidate2)) srcImagePath = candidate2;
        else if (fs.existsSync(candidate3)) srcImagePath = candidate3;
      }
    } else {
      const defImage = path.join(ROOT_DIR, 'images', `${sheet.id}.jpg`);
      if (fs.existsSync(defImage)) srcImagePath = defImage;
    }

    const baseName = sheet.id;

    if (srcImagePath && srcImagePath !== 'written_from_base64') {
      imageExt = path.extname(srcImagePath) || '.jpg';
      const destImagePath = path.join(imagesDir, `${baseName}${imageExt}`);
      try {
        fs.copyFileSync(srcImagePath, destImagePath);
      } catch (err) {
        console.warn(`[YOLO Export] Could not copy image for ${sheet.id}:`, err.message);
      }
    }

    // Write .txt label file (even if empty to act as negative sample if 0 annotations)
    const labelFilePath = path.join(labelsDir, `${baseName}.txt`);
    fs.writeFileSync(labelFilePath, yoloLines.join('\n') + (yoloLines.length ? '\n' : ''), 'utf8');
    exportedSheetsCount++;
  }

  // Write classes.txt
  const classesFilePath = path.join(outputDir, 'classes.txt');
  fs.writeFileSync(classesFilePath, classList.join('\n') + '\n', 'utf8');

  // Write dataset.yaml for Ultralytics YOLO
  const yamlLines = [
    `# Ultralytics YOLO dataset configuration for VED Electrical Symbols`,
    `# Exported: ${new Date().toISOString()}`,
    `path: ${outputDir.replace(/\\/g, '/')}`,
    `train: images`,
    `val: images`,
    ``,
    `nc: ${classList.length}`,
    `names:`
  ];
  for (let i = 0; i < classList.length; i++) {
    const escapedName = (classList[i] || `class_${i}`).replace(/"/g, '\\"');
    yamlLines.push(`  ${i}: "${escapedName}"`);
  }
  const yamlFilePath = path.join(outputDir, 'dataset.yaml');
  fs.writeFileSync(yamlFilePath, yamlLines.join('\n') + '\n', 'utf8');

  // Save complete JSON review backup
  const backupJsonPath = path.join(outputDir, 'review_export.json');
  fs.writeFileSync(backupJsonPath, JSON.stringify(payload, null, 2), 'utf8');

  // Summary object
  const summary = {
    exported_at: new Date().toISOString(),
    output_directory: outputDir,
    total_sheets: exportedSheetsCount,
    total_bounding_boxes: totalBoxesCount,
    total_classes: classList.length,
    class_distribution: classCounts,
    files_created: [
      'images/ (drawing images)',
      'labels/ (*.txt bounding boxes)',
      'classes.txt (class list)',
      'dataset.yaml (Ultralytics configuration)',
      'review_export.json (full review backup)'
    ]
  };

  const summaryPath = path.join(outputDir, 'export_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  return summary;
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
