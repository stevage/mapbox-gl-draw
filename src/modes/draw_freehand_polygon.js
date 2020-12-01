const DrawPolygon = require("./draw_polygon");
const {
  geojsonTypes,
  updateActions,
  modes,
  events,
} = require("../constants");
const doubleClickZoom = require("../lib/double_click_zoom");
const calculateTolerance = require("../lib/calculate_tolerance");
const isSelectable = require("../lib/is_selectable");
const simplify = require("@turf/simplify").default;

const { onMouseMove, ...DrawFreehandPolygon } = Object.assign({}, DrawPolygon);

DrawFreehandPolygon.onSetup = function (opts = {}) {
  const polygon = this.newFeature({
    type: geojsonTypes.FEATURE,
    properties: {
      freehand: true,
      selectable: isSelectable(opts)
    },
    geometry: {
      type: geojsonTypes.POLYGON,
      coordinates: [[]],
    },
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
    multiple: opts.multiple,
  };
};

DrawFreehandPolygon.onDrag = DrawFreehandPolygon.onTouchMove = function (state, e) {
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

DrawFreehandPolygon.onMouseUp = function (state, e) {
  if (state.dragMoving) {
    simplify(state.polygon, {
      mutate: true,
      tolerance: calculateTolerance(this.map.getZoom()),
      highQuality: true,
    });

    if (state.multiple) {
      this.changeMode(modes.DRAW_FREEHAND_POLYGON, { multiple: true });
    } else {
      this.changeMode(modes.SIMPLE_SELECT, { featureIds: [state.polygon.id] });
    }
  }
};

DrawFreehandPolygon.onTouchEnd = function (state, e) {
  this.onMouseUp(state, e);
};

module.exports = DrawFreehandPolygon;
