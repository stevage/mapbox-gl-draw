const DrawPolygon = require("./draw_polygon");
const { geojsonTypes, updateActions, modes, events } = require("../constants");
const doubleClickZoom = require("../lib/double_click_zoom");
const { onMouseMove, ...RectangularDraw } = Object.assign({}, DrawPolygon);

RectangularDraw.onSetup = function () {
  const polygon = this.newFeature({
    type: geojsonTypes.FEATURE,
    properties: {},
    geometry: {
      type: geojsonTypes.POLYGON,
      coordinates: [[]],
    },
    id: "no_interact",
  });

  this.addFeature(polygon);

  this.clearSelectedFeatures();
  doubleClickZoom.disable(this);

  this.setActionableState({
    trash: true,
  });

  return {
    polygon,
    dragMoving: false,
  };
};

RectangularDraw.onDrag = RectangularDraw.onTouchMove = function (state, e) {
  if (!state.dragMoving) {
    const { lng, lat } = e.lngLat;

    // Initialize corner vertices of rectangle
    [0, 1, 2, 3].forEach((vertex) =>
      state.polygon.updateCoordinate(`0.${vertex}`, lng, lat)
    );
    state.dragMoving = true;
    return;
  }

  const [startLng, startLat] = state.polygon.getCoordinates()[0][0];
  const { lng: endLng, lat: endLat } = e.lngLat;

  state.polygon.updateCoordinate("0.1", startLng, endLat);
  state.polygon.updateCoordinate("0.2", endLng, endLat);
  state.polygon.updateCoordinate("0.3", endLng, startLat);
};

RectangularDraw.onMouseUp = function (state, e) {
  if (state.dragMoving) {
    // The last vertex in the polygon is set after dragging is done.
    // Otherwise, the vertex will not appear under the cursor while drawing.
    const [startLng, startLat] = state.polygon.getCoordinates()[0][0];
    state.polygon.updateCoordinate("0.4", startLng, startLat);

    this.fireUpdate();
    this.changeMode(modes.SIMPLE_SELECT, { featureIds: [state.polygon.id] });
    this.clearSelectedFeatures();
  }
};

RectangularDraw.onTouchEnd = function (state, e) {
  this.onMouseUp(state, e);
};

RectangularDraw.fireUpdate = function () {
  this.map.fire(events.UPDATE, {
    action: updateActions.MOVE,
    features: this.getSelected().map((f) => f.toGeoJSON()),
  });
};

module.exports = RectangularDraw;
