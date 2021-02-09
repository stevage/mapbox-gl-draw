const { polygon } = require('@turf/helpers');
const unkinkPolygon = require('@turf/unkink-polygon').default;
const CommonSelectors = require("../lib/common_selectors");
const doubleClickZoom = require("../lib/double_click_zoom");
const Constants = require("../constants");
const isEventAtCoordinates = require("../lib/is_event_at_coordinates");
const createVertex = require("../lib/create_vertex");
const isSelectable = require("../lib/is_selectable");
const cursors = Constants.cursors;

const DrawPolygon = {};

function isPolygonSelfIntersecting(polygonCoords) {
  return polygonCoords.every(ring => {
    let polyCoords = [];

    console.log('intersect coords', ring, unkinkPolygon(polygon([ring])));
    if (ring.length >= 4) {
      // polyCoords = ring.slice(0, ring.length - 1).concat([ring[0]]);
    }

    return ring.length >= 4 && unkinkPolygon(polygon([ring])).features.length > 1;
  });
};

DrawPolygon.onSetup = function(opts) {
  if (this._ctx.snapping) {
    this._ctx.snapping.setSnapToSelected(false);
  }

  this._ctx.setGetCursorTypeLogic(({ snapped }) => {
    if (snapped) {
      return cursors.ADD;
    } else {
      return cursors.POINTER;
    }
  });

  const polygon = this.newFeature({
    type: Constants.geojsonTypes.FEATURE,
    properties: { selectable: isSelectable(opts) },
    geometry: {
      type: Constants.geojsonTypes.POLYGON,
      coordinates: [[]]
    }
  });

  this.addFeature(polygon);

  this.clearSelectedFeatures();
  doubleClickZoom.disable(this);
  this.updateUIClasses({ mouse: Constants.cursors.ADD });
  this.activateUIButton(Constants.types.POLYGON);
  this.setActionableState({
    trash: true
  });

  return {
    polygon,
    currentVertexPosition: 0,
    ignoreDeleteKey: opts.ignoreDeleteKey,
    multiple: opts.multiple,
    previousFeatureId: opts.previousFeatureId,
    redraw: opts.redraw,
  };
};

DrawPolygon.clickAnywhere = function(state, e) {
  console.log('click anywhere fired', state.polygon.coordinates.slice().map(coord => coord.slice()));
  if (
    state.currentVertexPosition > 0 &&
    isEventAtCoordinates(
      e,
      state.polygon.coordinates[0][state.currentVertexPosition - 1]
    )
  ) {
    return this.changeMode(Constants.modes.SIMPLE_SELECT, {
      featureIds: [state.polygon.id]
    });
  }

  const lngLat = this._ctx.snapping.snapCoord(e);

  // console.log('draw polygon', state.polygon.coordinates[0].length >= 4, state.polygon.coordinates, !state.polygon.isCreatingValid());
  if (state.polygon.coordinates[0].length >= 4) {
    const prepCoords = state.polygon.coordinates.slice()[0].map((coord, i, arr) => {
      if (i === state.polygon.coordinates[0].length - 1) {
        return [lngLat.lng, lngLat.lat];
      }
      return coord;
    }).concat([state.polygon.coordinates[0][0]]);

    if (isPolygonSelfIntersecting([prepCoords])) {
      return;
    }
  }

  this.updateUIClasses({ mouse: Constants.cursors.ADD });
  state.polygon.updateCoordinate(
    `0.${state.currentVertexPosition}`,
    lngLat.lng,
    lngLat.lat
  );
  state.currentVertexPosition++;
  state.polygon.updateCoordinate(
    `0.${state.currentVertexPosition}`,
    lngLat.lng,
    lngLat.lat
  );

  this.map.fire(Constants.events.VERTEX_PLACED, { features: [state.polygon.toGeoJSON()] });
  
  if (state.polygon.isCreatingValid()) {
    this.map.fire(Constants.events.CREATING, { features: [state.polygon.toGeoJSON(true)] });
  }
};

DrawPolygon.clickOnVertex = function(state) {
  if (state.redraw) {
    return this.changeMode(Constants.modes.DRAW_POLYGON, {
      previousFeatureId: state.polygon.id,
      redraw: true
    });
  }

  if (state.multiple) {
    return this.changeMode(Constants.modes.DRAW_POLYGON, { multiple: true });
  }

  return this.changeMode(Constants.modes.SIMPLE_SELECT, {
    featureIds: [state.polygon.id]
  });
};

DrawPolygon.onMouseMove = function(state, e) {
  const lngLat = this._ctx.snapping.snapCoord(e);
  state.polygon.updateCoordinate(
    `0.${state.currentVertexPosition}`,
    lngLat.lng,
    lngLat.lat
  );
  if (CommonSelectors.isVertex(e)) {
    this.updateUIClasses({ mouse: Constants.cursors.POINTER });
  }
};

DrawPolygon.onTap = DrawPolygon.onClick = function(state, e) {
  if (state.polygon.properties.freehand) return;

  // delete previously drawn polygon if it exists
  if (state.redraw && state.previousFeatureId) {
    this.deleteFeature(state.previousFeatureId, { silent: true });
  }

  if (CommonSelectors.isVertex(e)) return this.clickOnVertex(state, e);
  return this.clickAnywhere(state, e);
};

DrawPolygon.onStop = function(state) {
  this.updateUIClasses({ mouse: Constants.cursors.NONE });
  doubleClickZoom.enable(this);
  this.activateUIButton();

  // check to see if we've deleted this feature
  if (this.getFeature(state.polygon.id) === undefined) return;

  //remove last added coordinate
  state.polygon.removeCoordinate(`0.${state.currentVertexPosition}`);
  if (state.polygon.isValid()) {
    this.map.fire(Constants.events.CREATE, {
      features: [state.polygon.toGeoJSON()]
    });
  } else {
    this.deleteFeature([state.polygon.id], { silent: true });
    this.changeMode(Constants.modes.SIMPLE_SELECT, {}, { silent: true });
  }
};

DrawPolygon.toDisplayFeatures = function(state, geojson, display) {
  const isActivePolygon = geojson.properties.id === state.polygon.id;
  geojson.properties.active = isActivePolygon
    ? Constants.activeStates.ACTIVE
    : Constants.activeStates.INACTIVE;
  if (!isActivePolygon) return display(geojson);

  // Don't render a polygon until it has two positions
  // (and a 3rd which is just the first repeated)
  if (geojson.geometry.coordinates.length === 0) return;

  const coordinateCount = geojson.geometry.coordinates[0].length;
  // 2 coordinates after selecting a draw type
  // 3 after creating the first point
  if (coordinateCount < 3) {
    return;
  }
  geojson.properties.meta = Constants.meta.FEATURE;
  display(
    createVertex(
      state.polygon.id,
      geojson.geometry.coordinates[0][0],
      "0.0",
      false
    )
  );
  if (coordinateCount > 3) {
    // Add a start position marker to the map, clicking on this will finish the feature
    // This should only be shown when we're in a valid spot
    const endPos = geojson.geometry.coordinates[0].length - 3;
    display(
      createVertex(
        state.polygon.id,
        geojson.geometry.coordinates[0][endPos],
        `0.${endPos}`,
        false
      )
    );
  }
  if (coordinateCount <= 4) {
    // If we've only drawn two positions (plus the closer),
    // make a LineString instead of a Polygon
    const lineCoordinates = [
      [
        geojson.geometry.coordinates[0][0][0],
        geojson.geometry.coordinates[0][0][1]
      ],
      [
        geojson.geometry.coordinates[0][1][0],
        geojson.geometry.coordinates[0][1][1]
      ]
    ];
    // create an initial vertex so that we can track the first point on mobile devices
    display({
      type: Constants.geojsonTypes.FEATURE,
      properties: geojson.properties,
      geometry: {
        coordinates: lineCoordinates,
        type: Constants.geojsonTypes.LINE_STRING
      }
    });
    if (coordinateCount === 3) {
      return;
    }
  }
  // render the Polygon
  return display(geojson);
};

DrawPolygon.onTrash = function(state) {
  if (state.redraw || state.ignoreDeleteKey) return;

  this.deleteFeature([state.polygon.id], { silent: true });
  this.changeMode(Constants.modes.SIMPLE_SELECT);
};

module.exports = DrawPolygon;
