const {
  noTarget,
  isOfMetaType,
  isInactiveFeature,
  isShiftDown
} = require("../lib/common_selectors");
const createSupplementaryPoints = require("../lib/create_supplementary_points");
const constrainFeatureMovement = require("../lib/constrain_feature_movement");
const doubleClickZoom = require("../lib/double_click_zoom");
const Constants = require("../constants");
const CommonSelectors = require("../lib/common_selectors");
const moveFeatures = require("../lib/move_features");
const cursors = require("../constants").cursors;
const isPolygonSelfIntersecting = require("../lib/is_polygon_self_intersecting");
const createPolygonFromPartialRing = require("../lib/create_polygon_from_partial_ring");

const isVertex = isOfMetaType(Constants.meta.VERTEX);
const isMidpoint = isOfMetaType(Constants.meta.MIDPOINT);

const DirectSelect = {};

// INTERNAL FUCNTIONS

DirectSelect.fireUpdate = function () {
  this.map.fire(Constants.events.UPDATE, {
    action: Constants.updateActions.CHANGE_COORDINATES,
    features: this.getSelected().map(f => f.toGeoJSON())
  });
};

DirectSelect.fireActionable = function (state) {
  this.setActionableState({
    combineFeatures: false,
    uncombineFeatures: false,
    trash: state.selectedCoordPaths.length > 0
  });
};

DirectSelect.startDragging = function (state, e) {
  this.map.dragPan.disable();
  state.canDragMove = true;
  state.dragMoveLocation = e.lngLat;
};

DirectSelect.stopDragging = function (state) {
  this.map.dragPan.enable();
  state.dragMoving = false;
  state.canDragMove = false;
  state.dragMoveLocation = null;
  state.previousPointsOriginalCoords = [];
};

DirectSelect.onVertex = function (state, e) {
  this.startDragging(state, e);
  const about = e.featureTarget.properties;
  const selectedIndex = state.selectedCoordPaths.indexOf(about.coord_path);
  if (!isShiftDown(e) && selectedIndex === -1) {
    state.selectedCoordPaths = [about.coord_path];
  } else if (isShiftDown(e) && selectedIndex === -1) {
    state.selectedCoordPaths.push(about.coord_path);
  }

  const selectedCoordinates = this.pathsToCoordinates(
    state.featureId,
    state.selectedCoordPaths
  );
  this.setSelectedCoordinates(selectedCoordinates);
};

DirectSelect.onMidpoint = function (state, e) {
  this.startDragging(state, e);
  const about = e.featureTarget.properties;
  state.feature.addCoordinate(about.coord_path, about.lng, about.lat);
  this.fireUpdate();
  state.selectedCoordPaths = [about.coord_path];
};

DirectSelect.pathsToCoordinates = function (featureId, paths) {
  return paths.map(coord_path => ({ feature_id: featureId, coord_path }));
};

DirectSelect.onFeature = function (state, e) {
  if (state.selectedCoordPaths.length === 0) this.startDragging(state, e);
  else this.stopDragging(state);
};

DirectSelect.dragFeature = function (state, e, delta) {
  moveFeatures(this.getSelected(), delta);
  state.dragMoveLocation = e.lngLat;
};

DirectSelect.dragVertex = function (state, e, delta) {
  const selectedCoords = state.selectedCoordPaths.map(coord_path =>
    state.feature.getCoordinate(coord_path)
  );
  const selectedCoordPoints = selectedCoords.map(coords => ({
    type: Constants.geojsonTypes.FEATURE,
    properties: {},
    geometry: {
      type: Constants.geojsonTypes.POINT,
      coordinates: coords
    }
  }));

  const constrainedDelta = constrainFeatureMovement(selectedCoordPoints, delta);
  for (let i = 0; i < selectedCoords.length; i++) {
    const coord = selectedCoords[i];
    state.feature.updateCoordinate(
      state.selectedCoordPaths[i],
      coord[0] + constrainedDelta.lng,
      coord[1] + constrainedDelta.lat
    );
  }
};

DirectSelect.clickNoTarget = function () {
  this.changeMode(Constants.modes.SIMPLE_SELECT);
};

DirectSelect.clickInactive = function () {
  this.changeMode(Constants.modes.SIMPLE_SELECT);
};

DirectSelect.clickActiveFeature = function (state) {
  state.selectedCoordPaths = [];
  this.clearSelectedCoordinates();
  state.feature.changed();
};


DirectSelect.onDblClick = function(state, e) {
  const { feature, selectedCoordPaths } = state;

  const featureClicked = e.featureTarget;
  const featureIsLine = feature.type === 'LineString';
  const onlyOneVertexSelected = selectedCoordPaths.length === 1;
  const selectedVertexIsAtEndOfLine = onlyOneVertexSelected
    && (Number(selectedCoordPaths[0]) === 0
      || Number(selectedCoordPaths[0]) === feature.coordinates.length - 1)

  if (!featureClicked || !featureIsLine || !onlyOneVertexSelected || !selectedVertexIsAtEndOfLine) {
    return;
  }

  const selectedCoordIdx = Number(selectedCoordPaths[0]);
  this.changeMode(Constants.modes.DRAW_LINE_STRING, {
    featureId: state.featureId,
    from: feature.coordinates[selectedCoordIdx]
  });
  this.map.fire(Constants.events.EXTEND_LINE, { feature });
};

// EXTERNAL FUNCTIONS

DirectSelect.onSetup = function (opts) {
  if (this._ctx.snapping) {
    this._ctx.snapping.setSnapToSelected(false);
  }
  const featureId = opts.featureId;
  const feature = this.getFeature(featureId);

  if (!feature) {
    throw new Error("You must provide a featureId to enter direct_select mode");
  }

  if (feature.type === Constants.geojsonTypes.POINT) {
    throw new TypeError("direct_select mode doesn't handle point features");
  }

  const state = {
    featureId,
    feature,
    dragMoveLocation: opts.startPos || null,
    dragMoving: false,
    canDragMove: false,
    selectedCoordPaths: opts.coordPath ? [opts.coordPath] : [],
    previousPointsOriginalCoords: [],
  };

  this._ctx.setGetCursorTypeLogic(({ snapped, overFeatures }) => {
    if (!overFeatures || overFeatures.filter(l => l.layer.id.includes('vertex') || l.layer.id.includes('midpoint')).length) {
      return cursors.GRAB;
    }
    return cursors.POINTER;

  });

  this.setSelected(featureId);
  this.setSelectedCoordinates(
    this.pathsToCoordinates(featureId, state.selectedCoordPaths)
  );
  doubleClickZoom.disable(this);

  this.setActionableState({
    trash: true
  });

  return state;
};

DirectSelect.onStop = function () {
  doubleClickZoom.enable(this);
  this.clearSelectedCoordinates();
};

DirectSelect.toDisplayFeatures = function (state, geojson, push) {
  if (state.featureId === geojson.properties.id) {
    geojson.properties.active = Constants.activeStates.ACTIVE;
    push(geojson);
    createSupplementaryPoints(geojson, {
      map: this.map,
      midpoints: true,
      selectedPaths: state.selectedCoordPaths
    }).forEach(push);
  } else {
    geojson.properties.active = Constants.activeStates.INACTIVE;
    push(geojson);
  }
  this.fireActionable(state);
};

DirectSelect.onTrash = function (state) {
  // Uses number-aware sorting to make sure '9' < '10'. Comparison is reversed because we want them
  // in reverse order so that we can remove by index safely.
  state.selectedCoordPaths
    .sort((a, b) => b.localeCompare(a, "en", { numeric: true }))
    .forEach(id => state.feature.removeCoordinate(id));
  this.fireUpdate();
  state.selectedCoordPaths = [];
  this.clearSelectedCoordinates();
  this.fireActionable(state);
  if (state.feature.isValid() === false) {
    this.deleteFeature([state.featureId]);
    this.changeMode(Constants.modes.SIMPLE_SELECT, {});
  }
};

DirectSelect.onMouseMove = function (state, e) {
  return true;
};

DirectSelect.onMouseOut = function (state) {
  // As soon as you mouse leaves the canvas, update the feature
  if (state.dragMoving) this.fireUpdate();

  // Skip render
  return true;
};

DirectSelect.onTouchStart = DirectSelect.onMouseDown = function (state, e) {
  if (isVertex(e)) return this.onVertex(state, e);
  if (CommonSelectors.isActiveFeature(e)) return this.onFeature(state, e);
  if (isMidpoint(e)) return this.onMidpoint(state, e);
};

DirectSelect.onDrag = function (state, e) {
  if (state.canDragMove !== true) return;
  state.dragMoving = true;
  e.originalEvent.stopPropagation();
  let lngLat = e.lngLat;

  if (state.feature.type === 'Polygon' && state.previousPointsOriginalCoords.length === 0) {
    state.previousPointsOriginalCoords = state.selectedCoordPaths.map(path => ({
      path,
      coordinate: state.feature.getCoordinate(path),
    }));
  }

  if (state.selectedCoordPaths.length === 1) {
    lngLat = this._ctx.snapping.snapCoord(e);
    // following the dragVertex() path below seems to cause a lag where our point
    // ends up one step behind the snapped location
    state.feature.updateCoordinate(
      state.selectedCoordPaths[0],
      lngLat.lng,
      lngLat.lat
    );
  } else {
    const delta = {
      lng: lngLat.lng - state.dragMoveLocation.lng,
      lat: lngLat.lat - state.dragMoveLocation.lat
    };

    if (state.selectedCoordPaths.length > 0) this.dragVertex(state, e, delta);
    else this.dragFeature(state, e, delta);
  }
  state.dragMoveLocation = lngLat;
};

DirectSelect.onClick = function (state, e) {
  // if (noTarget(e)) return this.clickNoTarget(state, e);
  if (CommonSelectors.isActiveFeature(e))
    return this.clickActiveFeature(state, e);
  if (isInactiveFeature(e)) return this.clickInactive(state, e);
  this.stopDragging(state);
};

DirectSelect.onTap = function (state, e) {
  // if (noTarget(e)) return this.clickNoTarget(state, e);
  if (CommonSelectors.isActiveFeature(e))
    return this.clickActiveFeature(state, e);
  if (isInactiveFeature(e)) return this.clickInactive(state, e);
};

DirectSelect.onTouchEnd = DirectSelect.onMouseUp = function (state) {
  if (state.dragMoving) {
    if (state.feature.type === 'Polygon') {
      const ring = state.feature.coordinates[0];

      if (isPolygonSelfIntersecting(createPolygonFromPartialRing(ring))) {
        state.previousPointsOriginalCoords.forEach(pt => {
          state.feature.updateCoordinate(
            pt.path,
            pt.coordinate[0],
            pt.coordinate[1],
          );
        });
      }
    }

    this.fireUpdate();
  }
  this.stopDragging(state);
};

module.exports = DirectSelect;
