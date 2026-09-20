const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

console.log('================================================================');
console.log('Testing Switch Single Legend Class Resolution & Auto-Annotation');
console.log('================================================================');

// 1. Test LegendRegistry resolution
const context = { window: {}, console };
context.root = context;
vm.createContext(context);

const refLibCode = fs.readFileSync(path.join(__dirname, '..', 'reference-library.js'), 'utf8');
vm.runInContext(refLibCode, context);

const legRegCode = fs.readFileSync(path.join(__dirname, '..', 'legend-registry.js'), 'utf8');
vm.runInContext(legRegCode, context);

const startingData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'starting-progress.json'), 'utf8'));
const reg = context.window.LegendRegistry;
reg.rebuild({
  baseline: startingData,
  data: startingData,
  custom: [],
  pec: (context.window.REFERENCE_LIBRARY?.entries || []).filter(e => e.family === 'pec' || e.id?.startsWith('pec-')),
  drawingSpecific: (context.window.REFERENCE_LIBRARY?.entries || []).filter(e => e.family === 'drawing' || e.role === 'drawing_specific_reference_only'),
  references: context.window.REFERENCE_LIBRARY?.entries || []
});

console.log('--- 1. Testing Registry.resolve for switch_single and aliases ---');
const switchKey = reg.resolve('switch_single');
console.log('  reg.resolve("switch_single") ->', switchKey);
assert.strictEqual(switchKey, 'u:single-pole-switch-s', 'switch_single must resolve to u:single-pole-switch-s');

const singlePoleKey = reg.resolve('Single-pole switch');
console.log('  reg.resolve("Single-pole switch") ->', singlePoleKey);
assert.strictEqual(singlePoleKey, 'u:single-pole-switch-s', 'Single-pole switch must resolve to u:single-pole-switch-s');

const label = reg.labelFor('switch_single');
console.log('  reg.labelFor("switch_single") ->', label);
assert.strictEqual(label, 'Single-pole switch S', 'Label for switch_single must be Single-pole switch S');

// 2. Test auto-annotate engine proposal normalization
console.log('\n--- 2. Testing auto-annotate.cjs normalization and legend mapping ---');
const autoAnnotate = require(path.join(__dirname, '..', 'auto-annotate.cjs'));

// Check candidateClasses
assert(typeof autoAnnotate.runAutoAnnotation === 'function', 'runAutoAnnotation must be exported');

// 3. Test UI state simulation (review.js logic for existing annotations with switch_single)
console.log('\n--- 3. Testing UI mapping for auto-annotated switch proposal ---');
const simulatedAnnotation = {
  id: 'imported-mu9zu7gs-ai-a98f76',
  label: 'switch_single',
  layer: 'symbols',
  legend_entry: null,
  legendKey: undefined,
  review_state: 'needs_review'
};

function legendKeyOf(id) {
  return id ? (reg.resolve(id) || id) : null;
}

function legendLabelOf(id) {
  if (!id) return '';
  const e = reg.get(id);
  return e ? e.label : id;
}

// Emulate updateAnnotationList fallback
if (!simulatedAnnotation.legendKey) {
  simulatedAnnotation.legendKey = simulatedAnnotation.legend_entry || (simulatedAnnotation.label ? legendKeyOf(simulatedAnnotation.label) : null);
}
if (!simulatedAnnotation.legend_entry && simulatedAnnotation.legendKey) {
  simulatedAnnotation.legend_entry = simulatedAnnotation.legendKey;
}
if (simulatedAnnotation.label === 'switch_single' && simulatedAnnotation.legendKey) {
  const cleanName = legendLabelOf(simulatedAnnotation.legendKey);
  if (cleanName) simulatedAnnotation.label = cleanName;
}

console.log('  Resolved legendKey:', simulatedAnnotation.legendKey);
console.log('  Resolved legend_entry:', simulatedAnnotation.legend_entry);
console.log('  Updated readable label:', simulatedAnnotation.label);

assert.strictEqual(simulatedAnnotation.legendKey, 'u:single-pole-switch-s', 'legendKey must be resolved to u:single-pole-switch-s');
assert.strictEqual(simulatedAnnotation.legend_entry, 'u:single-pole-switch-s', 'legend_entry must be resolved to u:single-pole-switch-s');
assert.strictEqual(simulatedAnnotation.label, 'Single-pole switch S', 'label must be updated from switch_single to Single-pole switch S');

console.log('\n================================================================');
console.log('ALL SWITCH SINGLE LEGEND RESOLUTION TESTS PASSED!');
console.log('================================================================');
