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

DrawFreehandPolygon.onSetup = function (opts) {
  const polygon = this.newFeature({
    type: geojsonTypes.FEATURE,
    properties: {},
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
    var tolerance = 3 / ((this.map.getZoom() - 4) * 150) - 0.001; // https://www.desmos.com/calculator/b3zi8jqskw
    simplify(state.polygon, {
      mutate: true,
      tolerance: tolerance,
      highQuality: true,
    });

    if (state.polygon.isValid()) {
      this.map.fire(events.CREATE, {
        features: [state.polygon.toGeoJSON()]
      });
    }
    // this.fireUpdate();
    // this.changeMode(modes.SIMPLE_SELECT, { featureIds: [state.polygon.id] });
    // this.clearSelectedFeatures();
  }
};

DrawFreehandPolygon.onTouchEnd = function (state, e) {
  this.onMouseUp(state, e);
};

DrawFreehandPolygon.fireUpdate = function () {
  this.map.fire(events.UPDATE, {
    action: updateActions.MOVE,
    features: this.getSelected().map((f) => f.toGeoJSON()),
  });
};

module.exports = DrawFreehandPolygon;
