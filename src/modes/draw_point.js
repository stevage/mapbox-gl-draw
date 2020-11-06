const CommonSelectors = require("../lib/common_selectors");
const Constants = require("../constants");
const cursors = Constants.cursors;

const DrawPoint = {};

DrawPoint.onSetup = function(opts = {}) {
  if (this._ctx.snapping) {
    this._ctx.snapping.setSnapToSelected(false);
  }

  this._ctx.setGetCursorTypeLogic(({ snapped, overFeatures }) => {
    if (snapped) {
      return cursors.ADD;
    } else {
      return cursors.POINTER;
    }
  });

  const point = this.newFeature({
    type: Constants.geojsonTypes.FEATURE,
    properties: {},
    geometry: {
      type: Constants.geojsonTypes.POINT,
      coordinates: []
    }
  });

  this.addFeature(point);
  this.setSelected(this._ctx.store.getAllIds()[0]);

  // this.clearSelectedFeatures();
  // this.updateUIClasses({ mouse: Constants.cursors.ADD });
  this.activateUIButton(Constants.types.ADD);

  this.setActionableState({
    trash: true
  });

  return {
    point,
    redraw: opts.redraw,
    previousFeatureId: opts.previousFeatureId
  };
};

DrawPoint.stopDrawingAndRemove = function(state) {
  if (state.redraw) return;

  this.deleteFeature([state.point.id], { silent: true });
  this.changeMode(Constants.modes.SIMPLE_SELECT);
};

DrawPoint.onTap = DrawPoint.onClick = function(state, e) {
  this.updateUIClasses({ mouse: Constants.cursors.MOVE });
  const lngLat = this._ctx.snapping.snapCoord(e);

  state.point.updateCoordinate("", lngLat.lng, lngLat.lat);
  this.map.fire(Constants.events.CREATE, {
    features: [state.point.toGeoJSON()]
  });

  if (state.redraw) {
    // delete previously drawn point if it exists
    if (state.previousFeatureId) {
      this.deleteFeature(state.previousFeatureId, { silent: true });
    }

    this.changeMode(Constants.modes.DRAW_POINT, {
      previousFeatureId: state.point.id,
      redraw: true
    });
  } else {
    this.changeMode(Constants.modes.SIMPLE_SELECT, {
      featureIds: [state.point.id]
    });
  }
};

DrawPoint.onStop = function(state) {
  this.activateUIButton();
  if (!state.point.getCoordinate().length) {
    this.deleteFeature([state.point.id], { silent: true });
  }
};

DrawPoint.onMouseMove = function (state, e) {
  this._ctx.snapping.snapCoord(e);
}

DrawPoint.toDisplayFeatures = function(state, geojson, display) {
  // Never render the point we're drawing
  const isActivePoint = geojson.properties.id === state.point.id;
  geojson.properties.active = isActivePoint
    ? Constants.activeStates.ACTIVE
    : Constants.activeStates.INACTIVE;
  if (!isActivePoint) return display(geojson);
};

DrawPoint.onTrash = DrawPoint.stopDrawingAndRemove;

DrawPoint.onKeyUp = function(state, e) {
  if (state.redraw) return;

  if (CommonSelectors.isEscapeKey(e) || CommonSelectors.isEnterKey(e)) {
    return this.stopDrawingAndRemove(state, e);
  }
};

module.exports = DrawPoint;
