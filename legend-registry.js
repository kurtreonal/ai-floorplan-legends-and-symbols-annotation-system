/* legend-registry.js
 * Universal / multi-use legend symbol registry.
 *
 * Problem this replaces:
 *   Legend classes used to be minted per sheet ("sheet-53:L06", "sheet-56:L06",
 *   "sheet-67:L06" are all CCTV CAMERA) and the class picker rendered one
 *   <optgroup> per drawing group. The same physical symbol therefore appeared
 *   many times, once per group, and every uploaded legend created yet another
 *   duplicate instead of joining the existing symbol.
 *
 * What this does:
 *   Every legend annotation, from any sheet, any group, plus every uploaded
 *   crop, is folded into ONE flat catalogue keyed by a canonical slug derived
 *   from the label. Sheet-scoped ids become aliases of that universal key.
 *   Adding a legend whose label canonicalises to an existing symbol merges into
 *   that symbol (new alias + new source) instead of creating a duplicate.
 *
 * Universal keys look like:  u:cctv-camera
 */
(function (root) {
  'use strict';

  var PREFIX = 'u:';

  /* Tokens dropped before matching so that
   *   `4" x 4" JUNCTION BOX`  and  `4 x 4 inch junction box`
   * collapse onto the same symbol. Applied to both sides, so prepositions
   * removed here never change relative meaning. */
  var NOISE = new Set(['in', 'inch', 'inches', 'mm', 'cm', 'the', 'a', 'an']);

  function canonicalize(label) {
    if (label == null) return '';
    return String(label)
      .toLowerCase()
      .replace(/[\u2018\u2019\u201c\u201d]/g, '"')        // smart quotes -> "
      .replace(/"/g, ' in ')                              // 4" -> 4 in
      .replace(/[^a-z0-9]+/g, ' ')                        // punctuation -> space
      .split(' ')
      .filter(function (t) { return t && !NOISE.has(t); })
      .join('-')
      .slice(0, 96);
  }

  function keyFor(label) {
    var slug = canonicalize(label);
    return slug ? PREFIX + slug : '';
  }

  /* Matching index: separators removed entirely, so compound-word variants of
   * the same symbol collapse together -
   *   "CIRCUIT HOMERUN TO CCTV MONITOR" == "Circuit home-run to CCTV monitor"
   *   "KEY PAD" == "KEYPAD",  "PULL BOX" == "PULLBOX"
   * The readable hyphenated slug stays the public key; this is only the lookup
   * used to decide whether a label is a new symbol or an existing one. */
  function matchKey(label) {
    return canonicalize(label).replace(/-/g, '');
  }

  function tokenKey(label) {
    if (label == null) return '';
    return canonicalize(label)
      .split('-')
      .filter(function (t) { return t && !NOISE.has(t); })
      .sort()
      .join('-');
  }

  function isUniversalKey(id) {
    return typeof id === 'string' && id.indexOf(PREFIX) === 0;
  }

  function Registry() {
    this.entries = new Map();   // universalKey -> entry
    this.aliases = new Map();   // legacy legend_entry id -> universalKey
    this.byMatch = new Map();   // separator-free match slug -> universalKey
    this.byTokens = new Map();  // sorted token slug -> universalKey
    this.generation = 0;
  }

  /* entry = {
   *   key, label, aliases:Set, sources:[{sheet_id, group, group_name,
   *   annotation_id, geometry, uploaded_crop, label}], custom:bool, sheetIds:Set
   * } */
  Registry.prototype._ensure = function (label, key) {
    var k = key || keyFor(label);
    if (!k) return null;

    // First check exact token permutation matching (e.g. "Two-pole switch (S2P)" vs "Switch two-pole (S2P)")
    var tk = tokenKey(label || k.slice(PREFIX.length));
    if (tk && this.byTokens.has(tk)) {
      var canonicalByToken = this.byTokens.get(tk);
      if (canonicalByToken !== k) {
        this.aliases.set(k, canonicalByToken);
        var ownerByToken = this.entries.get(canonicalByToken);
        if (ownerByToken) ownerByToken.aliases.add(k);
        k = canonicalByToken;
      }
    }

    // Fold compound-word / spacing variants onto the first spelling seen.
    var mk = matchKey(label || k.slice(PREFIX.length));
    if (mk && this.byMatch.has(mk)) {
      var canonical = this.byMatch.get(mk);
      if (canonical !== k) {
        this.aliases.set(k, canonical);
        var owner = this.entries.get(canonical);
        if (owner) owner.aliases.add(k);
        k = canonical;
      }
    } else if (mk) {
      this.byMatch.set(mk, k);
    }

    if (tk && !this.byTokens.has(tk)) {
      this.byTokens.set(tk, k);
    }

    var entry = this.entries.get(k);
    if (!entry) {
      entry = {
        key: k,
        label: String(label || k.slice(PREFIX.length)).trim(),
        aliases: new Set(),
        sources: [],
        sheetIds: new Set(),
        groups: new Set(),
        custom: false
      };
      this.entries.set(k, entry);
    }
    return entry;
  };

  Registry.prototype.link = function (legacyId, key) {
    if (!legacyId || !key || legacyId === key) return;
    this.aliases.set(legacyId, key);
    var entry = this.entries.get(key);
    if (entry) entry.aliases.add(legacyId);
  };

  /* Resolve any identifier - legacy sheet-scoped id, universal key, or a bare
   * label - to the universal key it belongs to. Unknown ids pass through
   * unchanged so nothing is silently lost. */
  Registry.prototype.resolve = function (id) {
    if (!id) return null;
    if (isUniversalKey(id)) return id;
    if (this.aliases.has(id)) return this.aliases.get(id);
    var lower = typeof id === 'string' ? id.toLowerCase().trim() : '';
    if (lower && this.aliases.has(lower)) return this.aliases.get(lower);
    var byLabel = keyFor(id);
    if (byLabel && this.entries.has(byLabel)) return byLabel;
    if (byLabel && this.aliases.has(byLabel)) return this.aliases.get(byLabel);
    var mk = matchKey(id);
    if (mk && this.byMatch.has(mk)) return this.byMatch.get(mk);
    return id;
  };

  Registry.prototype.get = function (id) {
    var key = this.resolve(id);
    return key ? this.entries.get(key) || null : null;
  };

  Registry.prototype.labelFor = function (id) {
    var entry = this.get(id);
    return entry ? entry.label : (id || '');
  };

  /* Ingest one legend-layer annotation from a sheet. */
  Registry.prototype.ingest = function (annotation, sheet, opts) {
    if (!annotation || annotation.layer !== 'legend') return null;
    if (annotation.review_state === 'deleted') return null;
    var label = annotation.label || annotation.legend_entry;
    if (!label) return null;

    var entry = this._ensure(label, isUniversalKey(annotation.legend_entry) ? annotation.legend_entry : null);
    if (!entry) return null;

    if (annotation.legend_entry) this.link(annotation.legend_entry, entry.key);
    if (annotation.legendKey) this.link(annotation.legendKey, entry.key);
    if (annotation.class_state === 'user_defined_legend_source') entry.custom = true;

    if (sheet && sheet.group != null) entry.groups.add(sheet.group);
    if (sheet && !entry.sources.some(function (s) { return s.annotation_id === annotation.id; })) {
      entry.sources.push({
        sheet_id: sheet.id,
        group: sheet.group,
        group_name: sheet.group_name || sheet.title || ('Group ' + sheet.group),
        annotation_id: annotation.id,
        geometry: annotation.geometry || null,
        uploaded_crop: annotation.uploaded_crop || null,
        label: annotation.label || entry.label,
        origin: (opts && opts.origin) || 'sheet'
      });
      if (sheet.id) entry.sheetIds.add(sheet.id);
    }
    return entry;
  };

  /* Ingest a custom / uploaded entry that may not live on a sheet yet. */
  Registry.prototype.ingestCustom = function (custom) {
    if (!custom) return null;
    var label = custom.label || custom.legend_entry || custom.legendKey;
    if (!label) return null;
    var entry = this._ensure(label, null);
    if (!entry) return null;
    entry.custom = true;
    if (custom.group != null) entry.groups.add(custom.group);
    if (custom.legend_entry) this.link(custom.legend_entry, entry.key);
    if (custom.legendKey) this.link(custom.legendKey, entry.key);
    if (custom.crop && !entry.sources.some(function (s) { return s.uploaded_crop === custom.crop; })) {
      entry.sources.push({
        sheet_id: custom.source_sheet_id || null,
        group: null,
        group_name: custom.source_name || 'Uploaded',
        annotation_id: null,
        geometry: null,
        uploaded_crop: custom.crop,
        label: entry.label,
        origin: 'custom'
      });
      if (custom.source_sheet_id) entry.sheetIds.add(custom.source_sheet_id);
    }
    return entry;
  };

  /* Ingest a Philippine Electrical Code (PEC) reference entry into the universal catalog. */
  Registry.prototype.ingestPec = function (pec) {
    if (!pec) return null;
    var label = pec.label || pec.legend_entry || pec.legendKey;
    if (!label) return null;
    var entry = this._ensure(label, null);
    if (!entry) return null;
    entry.is_pec = true;
    if (pec.id) {
      this.link(pec.id, entry.key);
      this.link('u:' + pec.id, entry.key);
    }
    if (pec.legend_entry) this.link(pec.legend_entry, entry.key);
    if (pec.legendKey) this.link(pec.legendKey, entry.key);
    var crop = pec.crop || (pec.id ? 'references/pec/' + pec.id + '.png' : null);
    if (crop && !entry.sources.some(function (s) { return s.uploaded_crop === crop; })) {
      entry.sources.push({
        sheet_id: pec.source_id || null,
        group: null,
        group_name: pec.source_name || 'PEC Reference (Philippine Electrical Code)',
        annotation_id: null,
        geometry: null,
        uploaded_crop: crop,
        label: entry.label,
        origin: 'pec',
        is_pec: true,
        locator: pec.locator || null
      });
      if (pec.source_id) entry.sheetIds.add(pec.source_id);
    }
    return entry;
  };

  /* Ingest a project drawing-specific reference entry into the universal catalog. */
  Registry.prototype.ingestDrawingSpecific = function (item) {
    if (!item) return null;
    var label = item.label || item.legend_entry || item.legendKey;
    if (!label) return null;
    var entry = this._ensure(label, null);
    if (!entry) return null;
    entry.is_drawing_specific = true;
    if (item.id) {
      this.link(item.id, entry.key);
      this.link('u:' + item.id, entry.key);
    }
    if (item.legend_entry) this.link(item.legend_entry, entry.key);
    if (item.legendKey) this.link(item.legendKey, entry.key);
    var crop = item.crop || (item.id ? 'references/' + item.id + '.png' : null);
    if (crop && !entry.sources.some(function (s) { return s.uploaded_crop === crop; })) {
      entry.sources.push({
        sheet_id: item.source_id || null,
        group: null,
        group_name: item.source_name || ('Drawing Specific Reference (' + (item.source_id || 'Project') + ')'),
        annotation_id: null,
        geometry: null,
        uploaded_crop: crop,
        label: entry.label,
        origin: 'drawing',
        is_drawing_specific: true,
        locator: item.locator || null
      });
      if (item.source_id) entry.sheetIds.add(item.source_id);
    }
    return entry;
  };

  /* Public "add a legend" path. Returns the entry it merged into, so callers
   * can tell the user whether a new symbol was created or an existing
   * universal symbol was reused. */
  Registry.prototype.add = function (input) {
    var label = input && (input.label || input.legend_entry);
    if (!label) return null;
    var mk = matchKey(label);
    var existed = this.byMatch.has(mk);
    var entry = this.ingestCustom(input);
    if (entry) entry.merged = existed;
    this.generation++;
    return entry;
  };

  /* Count how many live annotations currently point at each symbol. */
  Registry.prototype.countUsage = function (sheets) {
    var self = this;
    this.entries.forEach(function (e) { e.usage = 0; e.usedOn = new Set(); });
    (sheets || []).forEach(function (sheet) {
      (sheet.annotations || []).forEach(function (a) {
        if (a.review_state === 'deleted') return;
        var id = a.legend_entry || a.legendKey;
        if (!id) return;
        var entry = self.get(id);
        if (!entry) return;
        entry.usage = (entry.usage || 0) + 1;
        entry.usedOn.add(sheet.id);
      });
    });
  };

  /* Rebuild the whole catalogue. Order matters only for which label wins as
   * the display label: the first non-empty one seen for a canonical key. */
  Registry.prototype.rebuild = function (opts) {
    opts = opts || {};
    this.entries.clear();
    this.aliases.clear();
    this.byMatch.clear();
    this.byTokens.clear();

    var self = this;
    function scan(sheets, origin) {
      (sheets || []).forEach(function (sheet) {
        (sheet.annotations || []).forEach(function (a) {
          if (a.layer === 'legend') self.ingest(a, sheet, { origin: origin });
        });
      });
    }
    scan(opts.baseline && opts.baseline.sheets, 'baseline');
    scan(opts.data && opts.data.sheets, 'sheet');

    var pecItems = opts.pec || (opts.references ? opts.references.filter(function (e) {
      return e && (e.family === 'pec' || (e.id && e.id.indexOf('pec-') === 0) || (e.source_id && e.source_id.indexOf('pec-') === 0));
    }) : null);
    if (!pecItems && typeof window !== 'undefined' && window.REFERENCE_LIBRARY && Array.isArray(window.REFERENCE_LIBRARY.entries)) {
      pecItems = window.REFERENCE_LIBRARY.entries.filter(function (e) {
        return e && (e.family === 'pec' || (e.id && e.id.indexOf('pec-') === 0) || (e.source_id && e.source_id.indexOf('pec-') === 0));
      });
    }
    (pecItems || []).forEach(function (p) { self.ingestPec(p); });

    var drawingItems = opts.drawingSpecific || (opts.references ? opts.references.filter(function (e) {
      return e && (e.family === 'drawing' || e.role === 'drawing_specific_reference_only' || (e.source_id && (e.source_id.indexOf('cogeo') === 0 || e.source_id.indexOf('bdo') === 0)));
    }) : null);
    if (!drawingItems && typeof window !== 'undefined' && window.REFERENCE_LIBRARY && Array.isArray(window.REFERENCE_LIBRARY.entries)) {
      drawingItems = window.REFERENCE_LIBRARY.entries.filter(function (e) {
        return e && (e.family === 'drawing' || e.role === 'drawing_specific_reference_only' || (e.source_id && (e.source_id.indexOf('cogeo') === 0 || e.source_id.indexOf('bdo') === 0)));
      });
    }
    (drawingItems || []).forEach(function (d) { self.ingestDrawingSpecific(d); });

    (opts.custom || []).forEach(function (c) { self.ingestCustom(c); });

    var CANONICAL_FALLBACK_ALIASES = {
      'switch_single': 'pec-switch-single',
      'switch-single': 'pec-switch-single',
      'single-pole-switch': 'pec-switch-single',
      'single-pole switch': 'pec-switch-single',
      'single pole switch': 'pec-switch-single',
      'single-pole switch s': 'pec-switch-single',
      'single-pole switch (s)': 'pec-switch-single',
      'switch': 'pec-switch-single',
      'wall-switch': 'pec-switch-single',
      'wall switch': 'pec-switch-single',
      'switch_duplex': 'pec-switch-duplex',
      'switch-duplex': 'pec-switch-duplex',
      'switch_triplex': 'pec-switch-triplex',
      'switch-triplex': 'pec-switch-triplex',
      'switch_doublepole': 'pec-switch-doublepole',
      'switch-doublepole': 'pec-switch-doublepole',
      'switch_threeway': 'pec-switch-threeway',
      'switch-threeway': 'pec-switch-threeway',
      'troffer_lights': 'cogeo-troffer',
      'troffer-lights': 'cogeo-troffer',
      'troffer_light': 'cogeo-troffer',
      'troffer-light': 'cogeo-troffer',
      'troffer': 'cogeo-troffer',
      'linear_fixture': 'pec-fluorescent',
      'linear-fixture': 'pec-fluorescent',
      'linear_lighting_fixture': 'pec-fluorescent',
      'linear lighting fixture': 'pec-fluorescent',
      'fluorescent_fixture': 'pec-fluorescent',
      'receptacle_duplex': 'pec-duplex-outlet',
      'receptacle-duplex': 'pec-duplex-outlet',
      'duplex_convenience_outlet': 'pec-duplex-outlet',
      'duplex convenience outlet': 'pec-duplex-outlet',
      'duplex_3_prong_power_outlet': 'pec-duplex-outlet',
      'duplex 3-prong power outlet': 'pec-duplex-outlet',
      'smoke_detector': 'pec-smoke',
      'smoke-detector': 'pec-smoke',
      'smoke detector': 'pec-smoke',
      'heat_detector': 'pec-heat',
      'heat-detector': 'pec-heat',
      'wall_fan': 'pec-fan',
      'wall-fan': 'pec-fan',
      'wall fan': 'pec-fan',
      'air_conditioning_unit': 'pec-special-purpose-outlet',
      'air-conditioning-unit': 'pec-special-purpose-outlet',
      'circuit_homerun': 'pec-homerun',
      'circuit-homerun': 'pec-homerun',
      'panelboard': 'pec-power-panel',
      'downlight': 'cogeo-downlight-200',
      'recessed_downlight': 'cogeo-downlight-200',
      'recessed downlight': 'cogeo-downlight-200'
    };

    for (var aKey in CANONICAL_FALLBACK_ALIASES) {
      var targetId = CANONICAL_FALLBACK_ALIASES[aKey];
      var resolvedUniversal = self.resolve(targetId);
      if (resolvedUniversal && self.entries.has(resolvedUniversal)) {
        self.link(aKey, resolvedUniversal);
        self.link(aKey.toLowerCase(), resolvedUniversal);
        self.link('u:' + aKey, resolvedUniversal);
        var canonSlug = canonicalize(aKey);
        if (canonSlug && canonSlug !== aKey) {
          self.link(canonSlug, resolvedUniversal);
          self.link('u:' + canonSlug, resolvedUniversal);
        }
      }
    }

    /* Second pass: annotations on non-legend layers may reference a legacy id
     * whose legend row lives on a sheet we already scanned. Nothing to do for
     * those. But an annotation may carry a universal key that has no legend row
     * yet (e.g. restored from an export) - keep it addressable. */
    function adopt(sheets) {
      (sheets || []).forEach(function (sheet) {
        (sheet.annotations || []).forEach(function (a) {
          var id = a.legend_entry || a.legendKey;
          if (isUniversalKey(id) && !self.entries.has(id)) {
            self._ensure(a.label || id.slice(PREFIX.length).replace(/-/g, ' '), id);
          }
        });
      });
    }
    adopt(opts.data && opts.data.sheets);

    this.countUsage((opts.data && opts.data.sheets) || []);
    this.generation++;
    return this;
  };

  /* Flat, alphabetical, de-duplicated list - the universal catalogue. */
  Registry.prototype.list = function (filter, opts) {
    opts = opts || {};
    var term = (filter || '').toLowerCase().trim();
    var groups = opts.groups ? new Set(opts.groups) : null;
    var out = [];
    this.entries.forEach(function (entry) {
      if (groups && groups.size) {
        var inScope = entry.groups.size === 0 ||
          Array.from(entry.groups).some(function (g) { return groups.has(g); });
        if (!inScope) return;
      }
      if (term) {
        var hay = (entry.label + ' ' + entry.key + ' ' +
          Array.from(entry.aliases).join(' ')).toLowerCase();
        if (hay.indexOf(term) === -1) return;
      }
      out.push(entry);
    });
    out.sort(function (a, b) { return a.label.localeCompare(b.label); });
    return out;
  };

  /* Best preview source for a symbol, preferring one on the given sheet. */
  Registry.prototype.bestSource = function (id, preferSheetId) {
    var entry = this.get(id);
    if (!entry || !entry.sources.length) return null;
    return entry.sources.find(function (s) { return s.sheet_id === preferSheetId; })
      || entry.sources.find(function (s) { return s.uploaded_crop; })
      || entry.sources.find(function (s) { return s.geometry && s.sheet_id; })
      || entry.sources[0];
  };

  Registry.prototype.isUsedOn = function (id, sheetId) {
    var entry = this.get(id);
    if (!entry) return false;
    return entry.sheetIds.has(sheetId) || (entry.usedOn && entry.usedOn.has(sheetId));
  };

  /* Same symbol on two annotations, regardless of which legacy id each holds. */
  Registry.prototype.sameSymbol = function (a, b) {
    if (!a || !b) return false;
    return this.resolve(a) === this.resolve(b);
  };

  var api = new Registry();
  api.canonicalize = canonicalize;
  api.keyFor = keyFor;
  api.matchKey = matchKey;
  api.isUniversalKey = isUniversalKey;
  api.PREFIX = PREFIX;

  root.LegendRegistry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
