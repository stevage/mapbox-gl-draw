// This draw mode is copied from this module: https://github.com/bemky/mapbox-gl-draw-freehand-mode
// with a couple of minor tweaks:
//
// - clearSelectedFeatures() is called on mouseup event to remove the interactable vertices from the final polygon.
// - DrawPolygon's onMouseMove is not assigned to the FreeDraw object. Without this change, it becomes possible
//   (under rare circumstances) to enter a state in which the polygon is drawn by placing each vertex individually.
// - cursor UI updates are removed, as this is handled in src/events.js.

const DrawPolygon = require("./draw_polygon");
const {
  geojsonTypes,
  cursors,
  types,
  updateActions,
  modes,
  events,
} = require("../constants");
const doubleClickZoom = require("../lib/double_click_zoom");
const calculateTolerance = require("../lib/calculate_tolerance");
const simplify = require("@turf/simplify").default;

const { onMouseMove, ...FreeDraw } = Object.assign({}, DrawPolygon);

FreeDraw.onSetup = function () {
  const polygon = this.newFeature({
    type: geojsonTypes.FEATURE,
    properties: { selectable: false },
    geometry: {
      type: geojsonTypes.POLYGON,
      coordinates: [[]],
    },
    id: "no_interact",
  });

  this.addFeature(polygon);

  this.clearSelectedFeatures();
  doubleClickZoom.disable(this);
  // disable dragPan
  setTimeout(() => {
    if (!this.map || !this.map.dragPan) return;
    this.map.dragPan.disable();
  });

  this.setActionableState({
    trash: true,
  });

  return {
    polygon,
    currentVertexPosition: 0,
    dragMoving: false,
  };
};

FreeDraw.onDrag = FreeDraw.onTouchMove = function (state, e) {
  state.dragMoving = true;
  state.polygon.updateCoordinate(
    `0.${state.currentVertexPosition}`,
    e.lngLat.lng,
    e.lngLat.lat
  );
  state.currentVertexPosition++;
  state.polygon.updateCoordinate(
    `0.${state.currentVertexPosition}`,
    e.lngLat.lng,
    e.lngLat.lat
  );
};

FreeDraw.onMouseUp = function (state, e) {
  if (state.dragMoving) {
    simplify(state.polygon, {
      mutate: true,
      tolerance: calculateTolerance(this.map.getZoom()),
      highQuality: true,
    });

    this.fireUpdate();
    this.changeMode(modes.SIMPLE_SELECT, { featureIds: [state.polygon.id] });
    this.clearSelectedFeatures();
  }
};

FreeDraw.onTouchEnd = function (state, e) {
  this.onMouseUp(state, e);
};

FreeDraw.fireUpdate = function () {
  this.map.fire(events.UPDATE, {
    action: updateActions.MOVE,
    features: this.getSelected().map((f) => f.toGeoJSON()),
  });
};

module.exports = FreeDraw;
