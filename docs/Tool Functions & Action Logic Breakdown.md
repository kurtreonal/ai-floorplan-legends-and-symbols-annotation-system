# Tool Functions & Action Logic Breakdown

Comprehensive breakdown of canvas tools, selection systems, search & synchronization controls, legend assignment mechanics, and root cause resolutions for the VED Floor Plan Review toolset.

---

## 1. Viewport & Canvas Tools

### Pan & Zoom (Mouse Wheel / Drag)
- **Translates and scales** the Canvas / coordinate space, synchronizing overlay markers, bounding boxes, connection anchors, and labels without coordinate drift.
- **Mouse Wheel Zoom**: Scales relative to cursor position in world-space, maintaining the cursor anchor invariant across arbitrary zoom steps.
- **Drag Panning**: In Pointer/Pan mode, dragging on empty canvas space translates the viewport (`view = [x, y, w, h]`). Right-drag allows quick panning from any tool mode without switching tools.
- **Rotation Support**: Allows 90° view rotation while keeping annotation geometry in original image pixel frames.

### BBox / Marker Plotter
- **Renders visual bounding boxes**: Outlines symbols, equipment, walls, rooms, openings, and wiring paths with layer-specific or legend-specific color schemes.
- **Center Pins**: Renders high-visibility center pins over electrical symbols (`symbols` layer) to pinpoint device centers for precise wiring and anchor snapping.
- **Status Rings**: Displays status rings around markers indicating inspection status:
  - **Reviewed** (`user_reviewed`): Distinct green ring (`#22c55e`).
  - **Corrected** (`corrected`): Accent blue ring (`#29b6f6`).
  - **Pending / Proposed** (`manually_added` / `pending`): Amber ring (`#f59e0b`).
- **Interactive handles**: Drag handles on selected bounding boxes and polygon vertices allow direct spatial resizing and translation.

---

## 2. Selection Tools

### Single Select
- Clicks an individual annotation pin, line, or bounding box to immediately populate metadata in the sidebar.
- Binds to the sidebar edit panel, activating class selectors, layer types, and readable labels.
- Synchronizes with the sidebar annotation list, highlighting the corresponding row and auto-scrolling it into view.

### Multi-Select / Box Select
- Gathers multiple target bounding boxes and markers into an active selection array (`multi` set).
- Supports `Shift + Click` on canvas markers or sidebar list rows.
- Grouping: Selected items can be grouped (`Ctrl+G`) to move together as a single rigid component.

### Select All
- Selects all annotations matching the current active filter context:
  - Scoped to the active legend class (`currentActiveLegendKey` / `edit-class` value) when a legend category is chosen.
  - Scoped to current active search filter substring when `#annotation-search` has text.
  - Filters out deleted annotations and hidden layers.

---

## 3. Annotation & Search Controls

### Search / Filter
- Real-time dataset filtering by:
  - **Label / Readable text**: Partial match against device descriptions or user notes.
  - **Legend Key / Class**: Match against assigned legend identifiers (`legend_entry`, `legendKey`).
  - **Classification Type / Layer**: Filter by `symbols`, `geometry`, `wiring`, `text`, `unresolved`, etc.
  - **Inspection Status**: Match against `corrected`, `user_reviewed`, `manually_added`, etc.
  - **Annotation ID**: Quick search by ID suffix or prefix.
- Dispatches `updateAnnotationList()` on `#annotation-search` input to immediately rebuild or toggle visibility of corresponding list items.
- Provides search filtering for the Legend Class dropdown via `#edit-class-search`.

### List-Box Sync
- **Bi-directional binding**:
  - Clicking a row in the sidebar list highlights the canvas marker and focuses the viewport on the selected annotation (`focusSelected`).
  - Clicking or selecting any marker on the canvas highlights the sidebar list item and automatically scrolls the sidebar list container to keep the active item in view (`scrollIntoView({ block: 'nearest', behavior: 'smooth' })`).

---

## 4. Legend Assignment Tools

### Legend Palette Selector
- Sets target symbol class (e.g., Duplex Receptacle, Panelboard, 3-Way Switch).
- Interactive legend cards in "This drawing's legend" allow one-click loading of legend classes with color swatches and sample crop images.
- Real-time legend color swatch customization updates all annotations associated with that legend class.

### Attach New / Custom Legend
- Allows users to upload a legend sheet (PDF or image), crop out symbol definitions, label them, and attach them directly to the drawing.
- Creates a custom legend definition (`user_defined_legend_source`) and appends it to project storage.
- Automatically pushes the definition into the master `legendList` array, saves to `localStorage`, and updates the Annotation tab dropdown.

### Apply Changes vs. Corrected Action
- **Apply Changes (`#update`)**: Commits modified legend class, layer, and label to all selected annotations (mass overwrite of legend class).
- **Corrected Action (`#btn-corrected`)**: Dedicated action that commits modified bounding boxes/positions and marks status as `corrected`, but preserves each item's individual legend unless explicitly modified.

---

## 5. Bug Analysis & Root Cause Resolutions

### Bug 1: Annotation Search not filtering list-box
- **Cause**: The input event listener on `#annotation-search` either failed to trigger a full DOM refresh or filtered only canvas markers without updating the sidebar container list items.
- **Fix**: Bound `#annotation-search` to an `updateAnnotationList()` dispatch that filters the active sheet dataset across substring queries (label, ID, legend key, layer, review state) and immediately rebuilds or toggles `.hidden` on corresponding list-box items. Also added list-box synchronization to auto-scroll to selected items.

### Bug 2: "Select All" ignores current legend filter
- **Cause**: The `selectAll()` method pushed all global sheet annotations into the active selection array rather than scoping to annotations matching the active legend category.
- **Fix**: Restricted `selectAll()` to filter candidate annotations matching the active legend category:
  ```javascript
  annotations.filter(a => (!currentActiveLegendKey || a.legendKey === currentActiveLegendKey || a.legend_entry === currentActiveLegendKey))
  ```
  before setting the active selection state.

### Bug 3: Attached new legend disappears / does not update annotation-tab dropdown
- **Cause**: New legend entries were only saved to temporary local state without persisting to `localStorage` / project review payload, and the legend dropdown (`#edit-class`) in the Annotation tab was not re-populated after saving.
- **Fix**: Pushed the new legend entry into the master `legendList` array, called `persist()` to write to `localStorage`, and invoked `populateLegendDropdowns()` to refresh both the reference panel and the annotation tab select elements.

### Bug 4: Add "Corrected" button preserving per-item legend assignments on bulk actions
- **Cause / Requirement**: `Apply Changes` mass-overwrites selected items with the dropdown's selected legend. A distinct `Corrected` action was needed that commits modified bounding boxes/positions and marks status as `corrected`, but preserves each item's individual legend unless explicitly modified.
- **Fix**: Implemented a dedicated `handleCorrectedAction()` button handler (`#btn-corrected`):
  - For multiple selected items with different legends, retains:
    ```javascript
    item.legend_entry = item.pendingLegendKey || item.legendKey || item.legend_entry;
    item.legendKey = item.legend_entry;
    ```
  - Updates item status to `'corrected'`.
  - Saves changes to project state (`persist()`) and refreshes canvas markers, status rings, and list-box.
