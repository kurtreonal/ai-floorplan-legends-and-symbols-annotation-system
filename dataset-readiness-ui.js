// Read-only audit inside the existing review workspace. No annotation mutation.
(() => {
  function glyph(imageUrl, box, label) {
    const figure = document.createElement('figure');
    const caption = document.createElement('figcaption'); caption.textContent = label;
    if (!imageUrl || !Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= box[0] || box[3] <= box[1]) {
      figure.textContent = 'Preview unavailable: verify image and box.'; return figure;
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `${box[0]} ${box[1]} ${box[2] - box[0]} ${box[3] - box[1]}`);
    svg.setAttribute('width', '140'); svg.setAttribute('height', '100');
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label);
    const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    image.setAttribute('href', imageUrl);
    svg.append(image); figure.append(svg, caption); return figure;
  }
  const host = document.getElementById('panel-review');
  if (!host) return;
  const section = document.createElement('section');
  const title = document.createElement('h3');
  title.textContent = 'Dataset readiness';
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = 'Audit saved annotations';
  const download = document.createElement('button');
  download.type = 'button';
  download.textContent = 'Download reviewed symbol candidates';
  const downloadStatus = document.createElement('p');
  downloadStatus.setAttribute('role', 'status');
  const result = document.createElement('div');
  result.setAttribute('role', 'status');
  result.setAttribute('tabindex', '-1');
  section.append(title, refresh, download, downloadStatus, result);
  host.prepend(section);
  download.addEventListener('click', async () => {
    download.disabled = true;
    try {
      const response = await fetch('/api/dataset-symbol-candidates');
      const bundle = await response.json();
      if (!response.ok) throw Error(bundle.error || 'Candidate export failed');
      const href = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = href;
      link.download = `ved-symbol-candidates-${bundle.source_session_sha256.slice(0, 12)}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      downloadStatus.textContent = `Downloaded ${bundle.records.length} explicit mappings, ${bundle.mapping_proposals.length} exact-label mapping proposals, and ${bundle.exclusions.length} exclusions. Confirm proposals before training; this file is not training approval.`;
    } catch (error) { downloadStatus.textContent = error.message; }
    finally { download.disabled = false; }
  });
  const predictionLabel = document.createElement('label');
  predictionLabel.textContent = 'Import local predictions (ved-symbol-predictions-v1 JSON)';
  const predictionFile = document.createElement('input'); predictionFile.type = 'file'; predictionFile.accept = '.json,application/json';
  predictionLabel.append(predictionFile);
  const predictionResult = document.createElement('div'); predictionResult.setAttribute('role', 'status');
  section.append(predictionLabel, predictionResult);
  predictionFile.addEventListener('change', async () => {
    const file = predictionFile.files[0]; if (!file) return;
    predictionFile.disabled = true;
    predictionResult.textContent = 'Validating predictions locally…';
    try {
      if (file.size > 8 * 1024 * 1024) throw Error('Prediction file exceeds 8 MiB');
      const input = JSON.parse(await file.text());
      const response = await fetch('/api/dataset-predictions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const record = await response.json();
      if (!response.ok) throw Error(record.error || 'Import failed');
      predictionResult.replaceChildren();
      const heading = document.createElement('p');
      heading.textContent = `Model ${record.model_id}; run ${record.run_id}. Immutable prediction artifact ${record.artifact_id}. Human annotations unchanged.`;
      predictionResult.append(heading);
      for (const page of record.pages) {
        const details = document.createElement('details');
        const label = document.createElement('summary'); label.textContent = `${page.page_id}: ${page.evaluation_status}`;
        details.append(label);
        const stats = document.createElement('p');
        stats.textContent = page.metrics.status === 'MEASURED' ? `TP ${page.metrics.tp}, FP ${page.metrics.fp}, FN ${page.metrics.fn}; precision ${page.metrics.precision === null ? 'undefined' : (page.metrics.precision * 100).toFixed(1) + '%'}, recall ${page.metrics.recall === null ? 'undefined' : (page.metrics.recall * 100).toFixed(1) + '%'}. Confidence 0.5, IoU 0.5. Not approved gold evaluation.` : page.evaluation_status;
        details.append(stats);
        const pair = document.createElement('div'); pair.className = 'dataset-page-pair';
        for (const [name, boxes, color] of [['Reviewed symbols', page.truth, '#007a38'], ['Predictions', page.predictions, '#bf3100']]) {
          const figure = glyph(page.image_url, [0, 0, page.width, page.height], name);
          const svg = figure.querySelector('svg');
          svg.setAttribute('width', '100%'); svg.setAttribute('height', '420');
          for (const item of boxes) {
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            const [x1, y1, x2, y2] = item.box;
            for (const [key, value] of Object.entries({ x: x1, y: y1, width: x2 - x1, height: y2 - y1, fill: 'none', stroke: color, 'stroke-width': Math.max(page.width / 600, 1) })) rect.setAttribute(key, value);
            const tip = document.createElementNS('http://www.w3.org/2000/svg', 'title'); tip.textContent = `${item.id}: ${item.class_id}`; rect.append(tip); svg.append(rect);
          }
          pair.append(figure);
        }
        details.append(pair);
        const errors = document.createElement('ul');
        for (const error of page.errors) { const item = document.createElement('li'); item.textContent = `${error.kind}: ${error.prediction_id || error.truth_id}${error.prediction_id && error.truth_id ? ' / ' + error.truth_id : ''}`; errors.append(item); }
        details.append(errors); predictionResult.append(details);
      }
    } catch (error) { predictionResult.textContent = error.message; }
    finally { predictionFile.disabled = false; }
  });
  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    result.textContent = 'Checking saved source hashes and annotations locally…';
    try {
      const response = await fetch('/api/dataset-readiness');
      const report = await response.json();
      if (!response.ok) throw Error(report.error || 'Audit failed');
      result.replaceChildren();
      const summary = document.createElement('p');
      summary.textContent = `${report.source_count} sheets; ${report.workspace_group_count} groups; ${report.verified_independent_projects} verified independent projects. ${report.verified_sources} matching image sources; ${report.invalid_symbol_boxes} invalid symbol boxes; ${report.eligible_pages} training-ready pages. Detection: ${report.metrics}.`;
      const policy = document.createElement('p');
      policy.textContent = 'Permission: supplied VED collection authorized. Encryption: deferred, not passed. Proposed target: precision and recall ≥85% at IoU ≥0.5; policy approval pending. Confidence 0.5 is separate.';
      const coverage = report.proposed_class_coverage;
      const classDetails = document.createElement('details');
      const classHeading = document.createElement('summary');
      classHeading.textContent = `${coverage.classes.length} drawing legend identities; ${coverage.exact_text_groups.length} distinct label texts; ${coverage.single_workspace_group_label_texts} label texts seen in one workspace group; ${coverage.validation_label_texts_absent_from_train} proposed validation label texts absent from proposed training. Matching text is a review clue, not an approved class merge.`;
      classDetails.append(classHeading);
      const classList = document.createElement('ul');
      for (const entry of coverage.classes) {
        const item = document.createElement('li');
        item.textContent = `${entry.label} (${entry.class_id}): ${entry.reviewed_valid} valid reviewed boxes, ${entry.pending} pending, ${entry.workspace_group_count} workspace groups; proposed train ${entry.proposed_train}, validation ${entry.proposed_validation}${entry.validation_label_absent_from_train ? ' — no proposed training examples' : ''}.`;
        classList.append(item);
      }
      classDetails.append(classList);
      const list = document.createElement('ul');
      for (const page of report.pages) {
        const row = document.createElement('li');
        row.textContent = `${page.id}: ${page.blockers.join('; ')}. `;
        const open = document.createElement('button');
        open.type = 'button'; open.textContent = 'Open page';
        open.addEventListener('click', () => { window.reviewWorkspace?.openSheet(page.id); document.getElementById('tab-edit')?.click(); });
        row.append(open);
        const invalid = page.annotations.filter(a => a.reasons.length);
        if (invalid.length) {
          const details = document.createElement('details');
          const label = document.createElement('summary');
          label.textContent = `${invalid.length} symbol review items`;
          details.append(label);
          for (const annotation of invalid) {
            const item = document.createElement('p');
            item.textContent = `${annotation.id}: ${annotation.reasons.join('; ')}`;
            const select = document.createElement('button');
            select.type = 'button'; select.textContent = 'Select in editor';
            select.addEventListener('click', () => { window.reviewWorkspace?.openSheet(page.id, annotation.id); document.getElementById('tab-edit')?.click(); });
            item.append(select);
            details.append(item);
            const candidate = report.legend_previews[annotation.class_id];
            if (candidate && !page.sealed_test) {
              const previews = document.createElement('div');
              previews.className = 'dataset-glyph-pair';
              previews.append(glyph(page.image_url, annotation.box, 'Observed: ' + annotation.original_label));
              for (const example of candidate.examples) previews.append(glyph(example.image_url, example.box, 'Drawing legend: ' + candidate.label));
              details.append(previews);
            }
          }
          row.append(details);
        }
        list.append(row);
      }
      result.append(summary, policy, classDetails, list);
      const current = window.reviewWorkspace?.getCurrent();
      const page = report.pages.find(p => p.id === current?.id);
      if (page) {
        const form = document.createElement('form');
        const heading = document.createElement('h4');
        heading.textContent = `Review ${page.id} — ${page.review.stale_decisions} stale decisions`;
        const explanation = document.createElement('p');
        explanation.textContent = 'Save editor changes first. These records are local attestations, not authenticated training approval. Corrections invalidate prior decisions; history is preserved.';
        const field = (text, input) => { const label = document.createElement('label'); label.append(document.createTextNode(text), input); form.append(label); return input; };
        form.append(heading, explanation);
        const actor = field('Reviewer name (self-reported)', document.createElement('input'));
        actor.required = true; actor.maxLength = 120;
        const layer = field('Layer', document.createElement('select'));
        for (const name of ['symbols', 'geometry', 'wiring', 'text', 'completeness']) layer.add(new Option(name, name));
        const complete = document.createElement('input'); complete.type = 'checkbox';
        field('Every visible target in this layer annotated', complete);
        const reviewed = document.createElement('input'); reviewed.type = 'checkbox';
        field('Layer corrections reviewed', reviewed);
        const notes = field('Review notes / missing areas', document.createElement('textarea'));
        notes.maxLength = 2000;
        const loadLayer = () => { complete.checked = !!page.review.layers[layer.value].complete; reviewed.checked = !!page.review.layers[layer.value].reviewed; };
        layer.addEventListener('change', loadLayer); loadLayer();
        const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Record layer review revision';
        save.dataset.action = 'layer_review';
        const feedback = document.createElement('p'); feedback.setAttribute('role', 'alert');
        form.append(save, feedback);
        const quality = field('Visual readability (not structural validity)', document.createElement('select'));
        for (const name of ['pending', 'readable', 'unreadable']) quality.add(new Option(name, name));
        quality.value = page.review.quality;
        const qualitySave = document.createElement('button'); qualitySave.type = 'submit'; qualitySave.dataset.action = 'quality_review'; qualitySave.textContent = 'Record readability review'; form.append(qualitySave);
        const project = field('Proposed independent project identity', document.createElement('input')); project.maxLength = 120;
        project.value = page.review.project_proposal?.project || '';
        const split = field('Proposed project split (keep related scans together)', document.createElement('select'));
        for (const name of ['pending', 'train', 'validation', 'sealed_test']) split.add(new Option(name, name));
        split.value = page.review.project_proposal?.split || 'pending';
        const groupSave = document.createElement('button'); groupSave.type = 'submit'; groupSave.dataset.action = 'project_proposal'; groupSave.textContent = 'Record grouping proposal'; form.append(groupSave);
        form.addEventListener('submit', async event => {
          event.preventDefault(); save.disabled = true;
          try {
            const response = await fetch('/api/dataset-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
              action: event.submitter?.dataset.action || 'layer_review', page_id: page.id, annotation_revision: page.revision, previous: report.review_head,
              actor: actor.value, layer: layer.value, complete: complete.checked, reviewed: reviewed.checked, notes: notes.value,
              quality: quality.value, project: project.value, split: split.value,
            }) });
            const answer = await response.json();
            if (!response.ok) throw Error(answer.error);
            report.review_head = answer.hash;
            feedback.textContent = 'Immutable review revision saved. Training approval remains pending.';
          } catch (error) { feedback.textContent = error.message; }
          finally { save.disabled = false; }
        });
        result.prepend(form);
      }
    } catch (error) { result.textContent = error.message; result.focus(); }
    finally { refresh.disabled = false; }
  });
})();
