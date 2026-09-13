const fs = require('fs');
const path = require('path');

const rootDir = fs.existsSync(path.join(__dirname, 'data')) ? __dirname : path.resolve(__dirname, '..');
const inputPath = fs.existsSync(path.join(rootDir, 'data/starting-progress.json'))
  ? path.join(rootDir, 'data/starting-progress.json')
  : path.join(rootDir, 'starting-progress.json');
const outputPath = fs.existsSync(path.join(rootDir, 'data'))
  ? path.join(rootDir, 'data/labeled-review.json')
  : path.join(rootDir, 'labeled-review.json');
const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const trofferEntry = 'sheet-52:L08';
const trofferSource = {
  sheet_id: 'sheet-52',
  group: 22,
  source_sha256: '7c488356e49c4eafa20f7dd3cc04b7be934ad37aa82a4c65cbcab737624da29a'
};

let changed = 0;

for (const sheet of payload.sheets) {
  const shouldMapLinearFixtures = sheet.id === 'sheet-14' || sheet.id === 'sheet-17';

  for (const annotation of sheet.annotations) {
    const isLinearFixture = annotation.layer === 'symbols'
      && annotation.review_state !== 'deleted'
      && annotation.label === 'Unmapped linear lighting fixture';
    const isUserTroffer = sheet.id === 'sheet-11'
      && annotation.layer === 'legend'
      && annotation.review_state !== 'deleted'
      && annotation.label === 'Troffer lights'
      && !annotation.legend_entry;

    if (!((shouldMapLinearFixtures && isLinearFixture) || isUserTroffer)) continue;

    if (!annotation.original_annotation) {
      annotation.original_annotation = {
        id: annotation.id,
        layer: annotation.layer,
        label: annotation.label,
        geometry: JSON.parse(JSON.stringify(annotation.geometry)),
        legend_entry: annotation.legend_entry ?? null,
        note: annotation.note || '',
        review_state: annotation.review_state,
        method: annotation.method,
        class_state: annotation.class_state,
        production_class_id: annotation.production_class_id ?? null
      };
    }

    annotation.layer = 'legend';
    annotation.label = 'Troffer lights';
    annotation.legend_entry = trofferEntry;
    annotation.review_state = 'corrected';
    annotation.class_state = 'cross_group_candidate';
    annotation.legend_source = { ...trofferSource };
    annotation.legend_scope = 'cross_group';
    annotation.last_edited_at = new Date().toISOString();
    changed += 1;
  }
}

payload.created_at = new Date().toISOString();
fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n');
console.log(`Mapped ${changed} annotations to ${trofferEntry}; wrote ${outputPath}.`);
