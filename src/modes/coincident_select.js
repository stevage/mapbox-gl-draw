const CommonSelectors = require("../lib/common_selectors");
const mouseEventPoint = require("../lib/mouse_event_point");
const createSupplementaryPoints = require("../lib/create_supplementary_points");
const StringSet = require("../lib/string_set");
const doubleClickZoom = require("../lib/double_click_zoom");
const moveFeatures = require("../lib/move_features");
const Constants = require("../constants");
const cursors = Constants.cursors

const CoincidentSelect = {};

const pointsEqual = (point1, point2) =>
  point1[0] === point2[0] && point1[1] === point2[1];

// OverLoaded function. This is serving both to check if the line is connected to the point
// and also to return the adjacent point(s) in the line to the connected point
const getAdjacentLineData = (lineCoords, pointCoord) => {
  if (pointsEqual(lineCoords[0], pointCoord)) {
    return { index: 0, adjacentPoints: [lineCoords[1]] };
  }
  for (let i = 1; i < lineCoords.length - 2; i += 1) {
    if (pointsEqual(lineCoords[i], pointCoord)) {
      return {
        index: i,
        adjacentPoints: [lineCoords[i - 1], lineCoords[i + 1]]
      };
    }
  }
  if (pointsEqual(lineCoords[lineCoords.length - 1], pointCoord)) {
    return {
      index: lineCoords.length - 1,
      adjacentPoints: [lineCoords[lineCoords.length - 2]]
    };
  }
  return null;
};

CoincidentSelect.onSetup = async function(opts) {
  if (this._ctx.snapping) {
    this._ctx.snapping.setSnapToSelected(false);
  }

  // turn the opts into state.
  const state = {
    dragMoveLocation: null,
    boxSelectStartLocation: null,
    boxSelectElement: undefined,
    boxSelecting: false,
    canBoxSelect: false,
    dragMoving: false,
    canDragMove: false,
    initiallySelectedFeatureIds: opts.featureIds || [],
    coincidentData: []
  };

  this._ctx.setGetCursorTypeLogic(({ overFeatures, isOverSelected }) => {
    if (isOverSelected) {
      return cursors.GRAB;
    } else if (overFeatures) {
      return cursors.POINTER;
    }
    return cursors.GRAB;
  });

  this.setSelected(
    state.initiallySelectedFeatureIds.filter(
      id => this.getFeature(id) !== undefined
    )
  );

  let feature = this.getFeature(state.initiallySelectedFeatureIds[0]);
  if (feature.type !== "Point") {
    return;
  }
  featIds = [feature.id];
  const { x, y } = this._ctx.map.project(feature.coordinates);
  const halfPixels = 5;
  const bbox = [
    [x - halfPixels, y - halfPixels],
    [x + halfPixels, y + halfPixels]
  ];
  const features = this._ctx.map.queryRenderedFeatures(bbox);
  const planId = features.find(f => f.properties.vetro_id === feature.id)
    .properties.plan_id;

  for(const f of features){
    if (
      f.properties.plan_id === planId &&
      f.geometry.type === "LineString" &&
      !f.layer.id.includes("_snap")
    ) {

      let lineGeom = f.geometry;
      if(typeof this._ctx.options.fetchSourceGeometry === "function"){

        const [ lineSrcGeom, ptSrcGeom ] = await Promise.allSettled([
          this._ctx.options.fetchSourceGeometry(f),
          this._ctx.options.fetchSourceGeometry({ properties: { vetro_id: state.initiallySelectedFeatureIds[0] }})
        ]);

        if(lineSrcGeom && lineSrcGeom.type && lineSrcGeom.coordinates.length){
          lineGeom = lineSrcGeom;
        }

        if(ptSrcGeom && ptSrcGeom.type && ptSrcGeom.coordinates.length){
          feature = ptSrcGeom;
        }
      }

      const adjacentLineData = getAdjacentLineData(
        lineGeom.coordinates,
        feature.coordinates
      );
      if (adjacentLineData) {
        const { index, adjacentPoints } = adjacentLineData;
        state.coincidentData.push({
          id: f.properties.vetro_id,
          layer_id: f.properties.layer_id,
          oldGeom: lineGeom,
          updateIndex: index,
          adjacentPoints
        });
      }
    }
  }

  this.fireActionable();

  this.setActionableState({
    combineFeatures: true,
    uncombineFeatures: true,
    trash: true
  });

  return state;
};

CoincidentSelect.fireUpdate = function(coincidentData) {
  const features = this.getSelected().map(f => f.toGeoJSON());
  const newPointCoords = features[0].geometry.coordinates;
  const formattedCoincidentData = coincidentData.map(
    ({ id, oldGeom, updateIndex, layer_id }) => {
      const newLineCoords = [...oldGeom.coordinates];
      newLineCoords.splice(updateIndex, 1, newPointCoords);
      return {
        "x-vetro": { vetro_id: id, layer_id },
        geometry: {
          ...oldGeom,
          coordinates: newLineCoords
        }
      };
    }
  );
  this.map.fire(Constants.events.UPDATE, {
    action: Constants.updateActions.MOVE,
    features,
    coincidentData: formattedCoincidentData
  });
};

CoincidentSelect.fireActionable = function() {
  const selectedFeatures = this.getSelected();

  const multiFeatures = selectedFeatures.filter(feature =>
    this.isInstanceOf("MultiFeature", feature)
  );

  let combineFeatures = false;

  if (selectedFeatures.length > 1) {
    combineFeatures = true;
    const featureType = selectedFeatures[0].type.replace("Multi", "");
    selectedFeatures.forEach(feature => {
      if (feature.type.replace("Multi", "") !== featureType) {
        combineFeatures = false;
      }
    });
  }

  const uncombineFeatures = multiFeatures.length > 0;
  const trash = selectedFeatures.length > 0;

  this.setActionableState({
    combineFeatures,
    uncombineFeatures,
    trash
  });
};

CoincidentSelect.getUniqueIds = function(allFeatures) {
  if (!allFeatures.length) return [];
  const ids = allFeatures
    .map(s => s.properties.id)
    .filter(id => id !== undefined)
    .reduce((memo, id) => {
      memo.add(id);
      return memo;
    }, new StringSet());

  return ids.values();
};

CoincidentSelect.stopExtendedInteractions = function(state) {
  if (state.boxSelectElement) {
    if (state.boxSelectElement.parentNode)
      state.boxSelectElement.parentNode.removeChild(state.boxSelectElement);
    state.boxSelectElement = null;
  }

  this.map.dragPan.enable();

  state.boxSelecting = false;
  state.canBoxSelect = false;
  state.dragMoving = false;
  state.canDragMove = false;
};

CoincidentSelect.onStop = function() {
  doubleClickZoom.enable(this);
};

CoincidentSelect.onMouseMove = function(state) {
  // On mousemove that is not a drag, stop extended interactions.
  // This is useful if you drag off the canvas, release the button,
  // then move the mouse back over the canvas --- we don't allow the
  // interaction to continue then, but we do let it continue if you held
  // the mouse button that whole time
  this.stopExtendedInteractions(state);

  // Skip render
  return true;
};

CoincidentSelect.onMouseOut = function(state) {
  // As soon as you mouse leaves the canvas, update the feature
  if (state.dragMoving) return this.fireUpdate(state.coincidentData);

  // Skip render
  return true;
};

CoincidentSelect.onTap = CoincidentSelect.onClick = function(state, e) {
  // Click (with or without shift) on no feature
  if (CommonSelectors.noTarget(e)) return this.clickAnywhere(state, e); // also tap
  if (CommonSelectors.isOfMetaType(Constants.meta.VERTEX)(e))
    return this.clickOnVertex(state, e); //tap
  if (CommonSelectors.isFeature(e)) return this.clickOnFeature(state, e);
};

CoincidentSelect.clickAnywhere = function(state) {
  // Clear the re-render selection
  const wasSelected = this.getSelectedIds();
  if (wasSelected.length) {
    this.clearSelectedFeatures();
    wasSelected.forEach(id => this.doRender(id));
  }
  doubleClickZoom.enable(this);
  this.stopExtendedInteractions(state);
};

CoincidentSelect.clickOnVertex = function(state, e) {
  // Enter direct select mode
  this.changeMode(Constants.modes.DIRECT_SELECT, {
    featureId: e.featureTarget.properties.parent,
    coordPath: e.featureTarget.properties.coord_path,
    startPos: e.lngLat
  });
};

CoincidentSelect.startOnActiveFeature = function(state, e) {
  // Stop any already-underway extended interactions
  this.stopExtendedInteractions(state);

  // Disable map.dragPan immediately so it can't start
  this.map.dragPan.disable();

  // Re-render it and enable drag move
  this.doRender(e.featureTarget.properties.id);

  // Set up the state for drag moving
  state.canDragMove = true;
  state.dragMoveLocation = e.lngLat;
};

CoincidentSelect.clickOnFeature = function(state, e) {
  // Stop everything
  doubleClickZoom.disable(this);
  this.stopExtendedInteractions(state);

  const isShiftClick = CommonSelectors.isShiftDown(e);
  const selectedFeatureIds = this.getSelectedIds();
  const featureId = e.featureTarget.properties.id;
  const isFeatureSelected = this.isSelected(featureId);

  // Click (without shift) on any selected feature but a point
  if (
    !isShiftClick &&
    isFeatureSelected &&
    this.getFeature(featureId).type !== Constants.geojsonTypes.POINT
  ) {
    // Enter direct select mode
    return this.changeMode(Constants.modes.DIRECT_SELECT, {
      featureId
    });
  }

  // Shift-click on a selected feature
  if (isFeatureSelected && isShiftClick) {
    // Deselect it
    this.deselect(featureId);
    if (selectedFeatureIds.length === 1) {
      doubleClickZoom.enable(this);
    }
    // Shift-click on an unselected feature
  } else if (!isFeatureSelected && isShiftClick) {
    // Add it to the selection
    this.select(featureId);
    // Click (without shift) on an unselected feature
  } else if (!isFeatureSelected && !isShiftClick) {
    // Make it the only selected feature
    selectedFeatureIds.forEach(id => this.doRender(id));

    this.setSelected(featureId);
  }

  // No matter what, re-render the clicked feature
  this.doRender(featureId);
};

CoincidentSelect.onMouseDown = function(state, e) {
  if (CommonSelectors.isActiveFeature(e))
    return this.startOnActiveFeature(state, e);
  if (this.drawConfig.boxSelect && CommonSelectors.isShiftMousedown(e))
    return this.startBoxSelect(state, e);
};

CoincidentSelect.startBoxSelect = function(state, e) {
  this.stopExtendedInteractions(state);
  this.map.dragPan.disable();
  // Enable box select
  state.boxSelectStartLocation = mouseEventPoint(
    e.originalEvent,
    this.map.getContainer()
  );
  state.canBoxSelect = true;
};

CoincidentSelect.onTouchStart = function(state, e) {
  if (CommonSelectors.isActiveFeature(e))
    return this.startOnActiveFeature(state, e);
};

CoincidentSelect.onDrag = function(state, e) {
  if (state.canDragMove) return this.dragMove(state, e);
  if (this.drawConfig.boxSelect && state.canBoxSelect)
    return this.whileBoxSelect(state, e);
};

CoincidentSelect.whileBoxSelect = function(state, e) {
  state.boxSelecting = true;

  // Create the box node if it doesn't exist
  if (!state.boxSelectElement) {
    state.boxSelectElement = document.createElement("div");
    state.boxSelectElement.classList.add(Constants.classes.BOX_SELECT);
    this.map.getContainer().appendChild(state.boxSelectElement);
  }

  // Adjust the box node's width and xy position
  const current = mouseEventPoint(e.originalEvent, this.map.getContainer());
  const minX = Math.min(state.boxSelectStartLocation.x, current.x);
  const maxX = Math.max(state.boxSelectStartLocation.x, current.x);
  const minY = Math.min(state.boxSelectStartLocation.y, current.y);
  const maxY = Math.max(state.boxSelectStartLocation.y, current.y);
  const translateValue = `translate(${minX}px, ${minY}px)`;
  state.boxSelectElement.style.transform = translateValue;
  state.boxSelectElement.style.WebkitTransform = translateValue;
  state.boxSelectElement.style.width = `${maxX - minX}px`;
  state.boxSelectElement.style.height = `${maxY - minY}px`;
};

CoincidentSelect.dragMove = function(state, e) {
  // Dragging when drag move is enabled
  state.dragMoving = true;
  e.originalEvent.stopPropagation();
  let lngLat = e.lngLat;
  // TODO more efficient
  if (
    this.getSelected().length === 1 &&
    this.getSelected()[0].type === "Point"
  ) {
    lngLat = this._ctx.snapping.snapCoord(e);
    this.getSelected()[0].incomingCoords([lngLat.lng, lngLat.lat]);
  } else {
    const delta = {
      lng: lngLat.lng - state.dragMoveLocation.lng,
      lat: lngLat.lat - state.dragMoveLocation.lat
    };

    moveFeatures(this.getSelected(), delta);
  }
  state.dragMoveLocation = lngLat;
};

CoincidentSelect.onMouseUp = function(state, e) {
  // End any extended interactions
  if (state.dragMoving) {
    this.fireUpdate(state.coincidentData);
  } else if (state.boxSelecting) {
    const bbox = [
      state.boxSelectStartLocation,
      mouseEventPoint(e.originalEvent, this.map.getContainer())
    ];
    const featuresInBox = this.featuresAt(null, bbox, "click");
    const idsToSelect = this.getUniqueIds(featuresInBox).filter(
      id => !this.isSelected(id)
    );

    if (idsToSelect.length) {
      this.select(idsToSelect);
      idsToSelect.forEach(id => this.doRender(id));
    }
  }
  this.stopExtendedInteractions(state);
};

CoincidentSelect.toDisplayFeatures = function(state, geojson, display) {
  const { coincidentData } = state;
  geojson.properties.active = this.isSelected(geojson.properties.id)
    ? Constants.activeStates.ACTIVE
    : Constants.activeStates.INACTIVE;
  display(geojson);
  this.fireActionable();

  createSupplementaryPoints(geojson, { coincidentData }).forEach(display);
};

CoincidentSelect.onTrash = function() {
  this.deleteFeature(this.getSelectedIds());
  this.fireActionable();
};

CoincidentSelect.onCombineFeatures = function() {
  const selectedFeatures = this.getSelected();

  if (selectedFeatures.length === 0 || selectedFeatures.length < 2) return;

  const coordinates = [],
    featuresCombined = [];
  const featureType = selectedFeatures[0].type.replace("Multi", "");

  for (let i = 0; i < selectedFeatures.length; i++) {
    const feature = selectedFeatures[i];

    if (feature.type.replace("Multi", "") !== featureType) {
      return;
    }
    if (feature.type.includes("Multi")) {
      feature.getCoordinates().forEach(subcoords => {
        coordinates.push(subcoords);
      });
    } else {
      coordinates.push(feature.getCoordinates());
    }

    featuresCombined.push(feature.toGeoJSON());
  }

  if (featuresCombined.length > 1) {
    const multiFeature = this.newFeature({
      type: Constants.geojsonTypes.FEATURE,
      properties: featuresCombined[0].properties,
      geometry: {
        type: `Multi${featureType}`,
        coordinates
      }
    });

    this.addFeature(multiFeature);
    this.deleteFeature(this.getSelectedIds(), { silent: true });
    this.setSelected([multiFeature.id]);

    this.map.fire(Constants.events.COMBINE_FEATURES, {
      createdFeatures: [multiFeature.toGeoJSON()],
      deletedFeatures: featuresCombined
    });
  }
  this.fireActionable();
};

CoincidentSelect.onUncombineFeatures = function() {
  const selectedFeatures = this.getSelected();
  if (selectedFeatures.length === 0) return;

  const createdFeatures = [];
  const featuresUncombined = [];

  for (let i = 0; i < selectedFeatures.length; i++) {
    const feature = selectedFeatures[i];

    if (this.isInstanceOf("MultiFeature", feature)) {
      feature.getFeatures().forEach(subFeature => {
        this.addFeature(subFeature);
        subFeature.properties = feature.properties;
        createdFeatures.push(subFeature.toGeoJSON());
        this.select([subFeature.id]);
      });
      this.deleteFeature(feature.id, { silent: true });
      featuresUncombined.push(feature.toGeoJSON());
    }
  }

  if (createdFeatures.length > 1) {
    this.map.fire(Constants.events.UNCOMBINE_FEATURES, {
      createdFeatures,
      deletedFeatures: featuresUncombined
    });
  }
  this.fireActionable();
};

module.exports = CoincidentSelect;
