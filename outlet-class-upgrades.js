/* Drawing-specific outlet legend corrections and separations. Loaded after data and reference library. */
((root) => {
  'use strict';
  const specs = [
    { sheet: 'sheet-32', old: 'L01', kind: 'telephone', single: [80, 265, 150, 380], duplex: [225, 235, 310, 380] },
    { sheet: 'sheet-32', old: 'L02', kind: 'data', single: [80, 445, 150, 560], duplex: [225, 420, 310, 560] },
    { sheet: 'sheet-34', old: 'L16', kind: 'voice', single: [18, 1682, 75, 1756], duplex: [92, 1678, 148, 1756] },
    { sheet: 'sheet-34', old: 'L17', kind: 'data', single: [18, 1785, 75, 1855], duplex: [92, 1780, 148, 1855] },
    { sheet: 'sheet-37', old: 'L01', kind: 'voice', single: [35, 265, 140, 395], duplex: [185, 245, 285, 395] },
    { sheet: 'sheet-37', old: 'L02', kind: 'data', single: [35, 445, 140, 550], duplex: [185, 425, 285, 550] },
    { sheet: 'sheet-51', old: 'L01', kind: 'convenience', single: [173, 154, 195, 182], duplex: [196, 154, 218, 182] }
  ];

  const definitions = [];
  for (const s of specs) {
    if (s.kind === 'convenience') {
      definitions.push({
        sheet: s.sheet,
        old: s.old,
        id: `${s.sheet}:${s.old}N`,
        label: 'Duplex convenience outlet - normal power, white plate',
        box: s.single,
        variant: 'normal',
        kind: s.kind
      });
      definitions.push({
        sheet: s.sheet,
        old: s.old,
        id: `${s.sheet}:${s.old}U`,
        label: 'Duplex convenience outlet - UPS power, metallic gray plate',
        box: s.duplex,
        variant: 'ups',
        kind: s.kind
      });
    } else {
      for (const variant of ['single', 'duplex']) {
        definitions.push({
          sheet: s.sheet,
          old: s.old,
          id: `${s.sheet}:${s.old}${variant === 'single' ? 'S' : 'D'}`,
          label: `${variant === 'single' ? 'Single' : 'Duplex'} ${s.kind} outlet`,
          box: s[variant],
          variant,
          kind: s.kind
        });
      }
    }
  }

  const byId = new Map(definitions.map(d => [d.id, d]));
  const sourceByOld = new Map(specs.map(s => [`${s.sheet}:${s.old}`, s]));
  const note = 'Separated from the supplied drawing legend. This is a legend example, not an installed device.';
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function addDefinition(sheet, def) {
    const oldId = `${def.sheet}:${def.old}`;
    const old = (sheet.annotations || []).find(a => a.layer === 'legend' && a.legend_entry === oldId);
    if (!old || (sheet.annotations || []).some(a => a.layer === 'legend' && a.legend_entry === def.id)) return;
    
    // Add separated legend symbol crop
    sheet.annotations.push({
      ...clone(old),
      id: `${def.sheet}-outlet-${def.old}-${def.variant}`,
      label: def.label,
      legend_entry: def.id,
      geometry: { type: 'bbox', coordinates: def.box.slice() },
      note,
      review_state: 'user_reviewed',
      class_state: 'approved_legend_mapping',
      method: 'drawing_legend_verified'
    });

    // Add matching text annotation
    const oldText = (sheet.annotations || []).find(a => a.layer === 'text' && a.legend_entry === oldId);
    if (oldText) {
      sheet.annotations.push({
        ...clone(oldText),
        id: `${def.sheet}-outlet-${def.old}-${def.variant}-text`,
        label: def.label,
        legend_entry: def.id,
        review_state: 'user_reviewed',
        class_state: 'approved_legend_mapping',
        method: 'drawing_legend_verified'
      });
    }
  }

  function retireCombined(sheet) {
    for (const a of (sheet.annotations || [])) {
      if ((a.layer === 'legend' || a.layer === 'text') && sourceByOld.has(a.legend_entry) && a.review_state !== 'deleted') {
        a.review_state = 'deleted';
      }
    }
  }

  function classifyExisting(sheet) {
    if (sheet.id === 'sheet-31') {
      for (const a of (sheet.annotations || [])) {
        if (a.layer === 'symbols' && a.legend_entry === 'sheet-32:L02' && a.review_state !== 'deleted') {
          a.legend_entry = 'sheet-32:L02S';
          a.label = 'Single data outlet candidate';
          a.note = 'Data symbol seen at this position; no duplex 2 is legible at the supplied resolution. Confirm in drawing.';
        }
      }
    }

    if (sheet.id === 'sheet-33') {
      for (const a of (sheet.annotations || [])) {
        const n = Number((a.id || '').match(/-v(\d+)$/)?.[1]);
        if (a.layer === 'symbols' && a.legend_entry === 'sheet-34:L17' && a.review_state !== 'deleted' && n >= 1 && n <= 12) {
          const voice = n >= 6;
          a.legend_entry = voice ? 'sheet-34:L16S' : 'sheet-34:L17S';
          a.label = voice ? 'Single voice outlet candidate' : 'Single data outlet candidate';
          a.note = 'Compared with this drawing legend: triangle is voice, circle is data. No duplex 2 is legible; verify source mark.';
        }
      }
    }

    if (sheet.id === 'sheet-38') {
      for (const a of [...(sheet.annotations || [])]) {
        const n = Number((a.id || '').match(/-v(\d+)$/)?.[1]);
        if (a.layer !== 'symbols' || a.legend_entry !== 'sheet-37:L02' || a.review_state === 'deleted' || n < 3 || n > 25) continue;
        const [x0, y0, x1, y1] = a.geometry.coordinates;
        const w = x1 - x0, h = y1 - y0;
        const paired = n <= 22;
        a.legend_entry = n === 22 ? 'sheet-37:L02D' : 'sheet-37:L02S';
        a.label = n === 22 ? 'Duplex data outlet candidate' : 'Single data outlet candidate';
        a.note = n === 22 ? 'Circle with legible 2 below: duplex data. Confirm precise mark boundary.' : 'Circle mark compared with drawing legend. Confirm whether a nearby 2 is present.';
        if (!paired) continue;
        const vertical = n >= 15;
        const dataBox = vertical ? [x0 + 0.34 * w, y0 + 0.45 * h, x1, y1] : [x0 + 0.48 * w, y0 + 0.19 * h, x1, y0 + 0.83 * h];
        const voiceBox = vertical ? [x0 + 0.22 * w, y0, x1, y0 + 0.58 * h] : [x0, y0 + 0.17 * h, x0 + 0.57 * w, y0 + 0.83 * h];
        a.geometry = { type: 'bbox', coordinates: dataBox.map(v => Math.round(v * 10) / 10) };
        const voiceId = `${a.id}-voice`;
        if (!sheet.annotations.some(item => item.id === voiceId)) {
          sheet.annotations.push({
            ...clone(a),
            id: voiceId,
            label: 'Single voice outlet candidate',
            legend_entry: 'sheet-37:L01S',
            geometry: { type: 'bbox', coordinates: voiceBox.map(v => Math.round(v * 10) / 10) },
            note: 'Triangle mark next to data circle, separated as voice from the supplied legend. Confirm precise mark boundary.',
            method: 'drawing_legend_verified'
          });
        }
      }
    }

    if (sheet.id === 'sheet-51') {
      // Teller stations 1 to 6 convenience outlets
      const tellerStations = [
        { normal: [642, 843, 656, 863], ups: [656, 843, 670, 863], station: '1' },
        { normal: [705, 843, 719, 863], ups: [719, 843, 733, 863], station: '2' },
        { normal: [769, 843, 783, 863], ups: [783, 843, 797, 863], station: '3' },
        { normal: [833, 843, 847, 863], ups: [847, 843, 861, 863], station: '4' },
        { normal: [896, 843, 910, 863], ups: [910, 843, 924, 863], station: '5' },
        { normal: [960, 843, 974, 863], ups: [974, 843, 988, 863], station: '6' }
      ];

      // Workstation desks (CRO, CS, CS, MA, MO)
      const deskStations = [
        { normal: [1150, 843, 1164, 863], ups: [1164, 843, 1178, 863], name: 'CRO' },
        { normal: [1194, 843, 1208, 863], ups: [1208, 843, 1222, 863], name: 'CS-1' },
        { normal: [1237, 843, 1251, 863], ups: [1251, 843, 1265, 863], name: 'CS-2' },
        { normal: [1281, 843, 1295, 863], ups: [1295, 843, 1309, 863], name: 'MA' },
        { normal: [1324, 843, 1338, 863], ups: [1338, 843, 1352, 863], name: 'MO' }
      ];

      for (const t of tellerStations) {
        const nid = `sheet-51-outlet-teller-${t.station}-normal`;
        const uid = `sheet-51-outlet-teller-${t.station}-ups`;
        if (!sheet.annotations.some(a => a.id === nid)) {
          sheet.annotations.push({
            id: nid,
            layer: 'symbols',
            label: 'Duplex convenience outlet - normal power, white plate',
            legend_entry: 'sheet-51:L01N',
            geometry: { type: 'bbox', coordinates: t.normal },
            review_state: 'user_reviewed',
            class_state: 'approved_legend_mapping',
            method: 'drawing_legend_verified',
            note: `Ground floor teller counter station ${t.station} - normal power duplex convenience outlet (white plate).`
          });
        }
        if (!sheet.annotations.some(a => a.id === uid)) {
          sheet.annotations.push({
            id: uid,
            layer: 'symbols',
            label: 'Duplex convenience outlet - UPS power, metallic gray plate',
            legend_entry: 'sheet-51:L01U',
            geometry: { type: 'bbox', coordinates: t.ups },
            review_state: 'user_reviewed',
            class_state: 'approved_legend_mapping',
            method: 'drawing_legend_verified',
            note: `Ground floor teller counter station ${t.station} - UPS power duplex convenience outlet (metallic gray plate).`
          });
        }
      }

      for (const d of deskStations) {
        const nid = `sheet-51-outlet-desk-${d.name}-normal`;
        const uid = `sheet-51-outlet-desk-${d.name}-ups`;
        if (!sheet.annotations.some(a => a.id === nid)) {
          sheet.annotations.push({
            id: nid,
            layer: 'symbols',
            label: 'Duplex convenience outlet - normal power, white plate',
            legend_entry: 'sheet-51:L01N',
            geometry: { type: 'bbox', coordinates: d.normal },
            review_state: 'user_reviewed',
            class_state: 'approved_legend_mapping',
            method: 'drawing_legend_verified',
            note: `Workstation ${d.name} - normal power duplex convenience outlet (white plate).`
          });
        }
        if (!sheet.annotations.some(a => a.id === uid)) {
          sheet.annotations.push({
            id: uid,
            layer: 'symbols',
            label: 'Duplex convenience outlet - UPS power, metallic gray plate',
            legend_entry: 'sheet-51:L01U',
            geometry: { type: 'bbox', coordinates: d.ups },
            review_state: 'user_reviewed',
            class_state: 'approved_legend_mapping',
            method: 'drawing_legend_verified',
            note: `Workstation ${d.name} - UPS power duplex convenience outlet (metallic gray plate).`
          });
        }
      }
    }
  }

  function applyToSheet(sheet) {
    if (!sheet || !Array.isArray(sheet.annotations)) return;
    classifyExisting(sheet);
    for (const def of definitions.filter(d => d.sheet === sheet.id)) {
      addDefinition(sheet, def);
    }
    retireCombined(sheet);
  }

  function applyToData(data) {
    for (const sheet of data?.sheets || []) {
      applyToSheet(sheet);
    }
  }

  function mergeRestored(target, baseline) {
    if (!target || !baseline) return;
    applyToSheet(target);
    const present = new Set((target.annotations || []).map(a => a.id));
    for (const a of (baseline.annotations || [])) {
      if (!a.id || present.has(a.id)) continue;
      if ((a.layer === 'legend' && byId.has(a.legend_entry)) ||
          (a.id.endsWith('-voice') && a.id.startsWith('sheet-38-v')) ||
          (a.id.startsWith('sheet-51-outlet-'))) {
        target.annotations.push(clone(a));
        present.add(a.id);
      }
    }
  }

  function addReferences(library, data) {
    if (!library || !data) return;
    for (const sheetId of ['sheet-32', 'sheet-34', 'sheet-37']) {
      const sheet = (data.sheets || []).find(s => s.id === sheetId);
      const sourceId = `outlets-${sheetId}`;
      if (sheet && !library.sources.some(s => s.id === sourceId)) {
        library.sources.push({
          id: sourceId,
          family: 'drawing',
          page: 1,
          image: sheet.image,
          sha256: sheet.sha256,
          width: sheet.width,
          height: sheet.height,
          source_path: sheet.image,
          role: 'drawing_specific_reference_only',
          training_eligible: false,
          edition_status: `Supplied drawing legend for group ${sheet.group}.`,
          rendering: 'Original sheet image; coordinates are source pixels.'
        });
      }
    }

    // Also ensure BDO power source exists in library sources
    const bdoSheet = (data.sheets || []).find(s => s.id === 'sheet-51');
    if (bdoSheet && !library.sources.some(s => s.id === 'bdo-power')) {
      library.sources.push({
        id: 'bdo-power',
        family: 'drawing',
        page: 1,
        image: bdoSheet.image,
        sha256: bdoSheet.sha256,
        width: bdoSheet.width,
        height: bdoSheet.height,
        source_path: bdoSheet.image,
        role: 'drawing_specific_reference_only',
        training_eligible: false,
        edition_status: 'Supplied drawing legend for group 21 (BDO Cubao).',
        rendering: 'Original sheet image; coordinates are source pixels.'
      });
    }

    for (const def of definitions) {
      if (library.entries.some(e => e.id === def.id)) continue;
      const sourceId = def.sheet === 'sheet-51' ? 'bdo-power' : `outlets-${def.sheet}`;
      library.entries.push({
        id: def.id,
        source_id: sourceId,
        sheet_id: def.sheet,
        group: (data.sheets || []).find(s => s.id === def.sheet)?.group,
        label: def.label,
        locator: `${def.sheet} drawing legend ${def.old}, ${def.variant} glyph`,
        source_bbox_pixels: def.box,
        crop: `references/split-outlets/${def.sheet}-${def.old}-${def.variant}.png`,
        note: def.sheet === 'sheet-51'
          ? 'The open circle is normal power/white plate; the vertical-filled circle is UPS power/metallic gray plate.'
          : `The ${def.variant} symbol is defined by this supplied drawing legend. A numeral 2 marks duplex.`,
        approved_class_id: def.id,
        role: 'drawing_legend_definition'
      });
    }
  }

  const api = { definitions, applyToSheet, applyToData, mergeRestored, addReferences };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.OUTLET_CLASS_UPGRADES = api;
    if (root.ANNOTATION_DATA) applyToData(root.ANNOTATION_DATA);
    if (root.REFERENCE_LIBRARY && root.ANNOTATION_DATA) addReferences(root.REFERENCE_LIBRARY, root.ANNOTATION_DATA);
  }
})(typeof window !== 'undefined' ? window : null);
