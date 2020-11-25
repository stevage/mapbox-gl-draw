const DrawPolygon = require("./draw_polygon");
const {
  geojsonTypes,
  updateActions,
  modes,
  events,
} = require("../constants");
const doubleClickZoom = require("../lib/double_click_zoom");
const simplify = require("@turf/simplify").default;

const { onMouseMove, ...DrawFreehandPolygon } = Object.assign({}, DrawPolygon);

DrawFreehandPolygon.onSetup = function (opts = {}) {
  const polygon = this.newFeature({
    type: geojsonTypes.FEATURE,
    properties: { freehand: true },
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
    const tolerance = 3 / ((this.map.getZoom() - 4) * 150) - 0.001; // https://www.desmos.com/calculator/b3zi8jqskw
    simplify(state.polygon, {
      mutate: true,
      tolerance: tolerance,
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
