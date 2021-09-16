const throttle = require("lodash.throttle");
const getNearestPointOnLine = require("@turf/nearest-point-on-line").default;
const turfDistance = require("@turf/distance").default;
const {
  point: turfPoint,
  lineString: turfLineString,
  featureCollection: turfFeatureCollection,
} = require("@turf/helpers");
const cloneDeep = require("lodash.clonedeep");
const last = require("lodash.last");
const turfCircle = require("@turf/circle").default;
const { getCoord, getCoords, getType } = require("@turf/invariant");

const {
  getBufferLayerId,
  getBufferLayer,
  findVertexInCircle,
} = require("./util");
const {
  STATIC,
  FREEHAND,
  MARQUEE,
  DIRECT_SELECT,
  SIMPLE_SELECT,
  DRAW_LINE_STRING,
  DRAW_POLYGON,
  COINCIDENT_SELECT,
  DRAW_POINT,
} = require("../constants").modes;

const LINE_MODES = [DIRECT_SELECT, DRAW_LINE_STRING, DRAW_POLYGON];
const POINT_MODES = [SIMPLE_SELECT, DRAW_POINT, COINCIDENT_SELECT];

const MOUSE_UP_MODES = [
  DIRECT_SELECT,
  SIMPLE_SELECT,
  DRAW_POINT,
  COINCIDENT_SELECT,
  FREEHAND,
  MARQUEE,
];

const MOUSE_DOWN_MODES = [DRAW_LINE_STRING, DRAW_POLYGON];

const MOUSEMOVE_THROTTLE_MS = 16;

class Snapping {
  constructor(ctx) {
    this.map = ctx.map;
    this.snappedFeature = null;
    this.snappedGeometry = null;
    this.bufferLayers = [];
    this.snapLayers = ctx.options.snapLayers;
    this.fetchSnapGeometry = ctx.options.fetchSnapGeometry;
    this.fetchSnapGeometries = ctx.options.fetchSnapGeometries;
    this._updateSourceGeomCache = ctx.options._updateSourceGeomCache;
    this._setGeomCacheIfNotExists = ctx.options._setGeomCacheIfNotExists;
    this.fetchSourceGeometry = ctx.options.fetchSourceGeometry;
    this.fetchSourceGeometries = ctx.options.fetchSourceGeometries;
    this.getClosestPoint = ctx.options.getClosestPoint;
    this.resetSnappingGeomCache = ctx.options.resetSnappingGeomCache;
    this.fetchMapExtentGeometry = ctx.options.fetchMapExtentGeometry;
    this.snapDistance = ctx.options.snapDistance;
    this.store = ctx.store;
    this.snapToSelected = false;
    this.snappingEnabled = false;
    // this is the amount the endpoints are preferenced as snap points. and is related to the angle between the hover point, the nearest point and the endpoint
    this.vertexPullFactor = Math.sqrt(2);

    this._mouseMoveHandler = this._mouseMoveHandler.bind(this);
    this._mouseoutHandler = this._mouseoutHandler.bind(this);
    this.refreshSnapLayers = this.refreshSnapLayers.bind(this);
    this.setSnapLayers = this.setSnapLayers.bind(this);
    this.clearSnapCoord = this.clearSnapCoord.bind(this);
    this.setSnapToSelected = this.setSnapToSelected.bind(this);
    this.cursorIsSnapped = this.cursorIsSnapped.bind(this);
    this.disableSnapping = this.disableSnapping.bind(this);
    this.enableSnapping = this.enableSnapping.bind(this);
    this.resetSnappingGeomCache = this.resetSnappingGeomCache.bind(this);
    this.fetchMapExtentGeometry = this.fetchMapExtentGeometry.bind(this);
    this.fetchSourceGeometry = this.fetchSourceGeometry.bind(this);
    this.fetchSourceGeometries = this.fetchSourceGeometries.bind(this);
    this.getClosestPoint = this.getClosestPoint.bind(this);

    this.initialize();
    this._throttledMouseMoveHandler = throttle(
      this._mouseMoveHandler,
      MOUSEMOVE_THROTTLE_MS
    );
    this.attachApi(ctx);
  }

  initialize() {
    this.map.on("styledata", () => {
      this._updateSnapLayers();
    });
    this.map.on("draw.update", () => {
      this.clearSnapCoord();
    });
    this.map.on("draw.modechange", () => {
      this.clearSnapCoord();
    });
    this.map.on("draw.refreshsnapping", () => {
      this.bufferLayers = [];
      this._addSnapSourceAndLayer();
    });
  }

  /** OUTWARD FACING METHODS */

  attachApi(ctx) {
    // To whom so ever has beef with this, I'm with you, but without re-designing things on a greater scale... this is how it is.
    ctx.api.refreshSnapLayers = this.refreshSnapLayers;
    ctx.api.setSnapLayers = this.setSnapLayers;
    ctx.api.clearSnapCoord = this.clearSnapCoord;
    ctx.api.cursorIsSnapped = this.cursorIsSnapped;
    ctx.api.disableSnapping = this.disableSnapping;
    ctx.api.enableSnapping = this.enableSnapping;
    ctx.api.resetSnappingGeomCache = this.resetSnappingGeomCache;
    ctx.api.fetchMapExtentGeometry = this.fetchMapExtentGeometry;
    ctx.api.fetchSourceGeometry = this.fetchSourceGeometry;
    ctx.api.fetchSourceGeometries = this.fetchSourceGeometries;
    ctx.api.getClosestPoint = this.getClosestPoint;
  }

  refreshSnapLayers() {
    this._updateSnapLayers();
  }

  setSnapLayers(snapLayers) {
    this.snapLayers = snapLayers;
    this._updateSnapLayers();
  }
  setSnapToSelected(shouldSnapToSelected) {
    this.snapToSelected = shouldSnapToSelected;
  }
  cursorIsSnapped() {
    const source = this.map.getSource("_snap_vertex");
    return source && source._data.features.length > 0;
  }

  clearSnapCoord() {
    const source = this.map.getSource("_snap_vertex");
    if (source) {
      source.setData({ type: "FeatureCollection", features: [] });
    }
  }

  _addSnapSourceAndLayer() {
    if (this.map.getSource("_snap_vertex")) return;

    this.map.addSource("_snap_vertex", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    this.map.addLayer({
      id: "_snap_vertex",
      type: "circle",
      source: "_snap_vertex",
      paint: {
        "circle-color": "transparent",
        "circle-radius": 5,
        "circle-stroke-width": 3,
        "circle-stroke-color": "orange",
      },
    });
  }

  disableSnapping() {
    this.snappingEnabled = false;
    this._snappableLayers().forEach((l) => this._removeSnapBuffer(l));
    this.map.off("mousemove", this._throttledMouseMoveHandler);
    this.map.off("mouseout", this._mouseoutHandler);
    this.map.removeLayer("_snap_vertex");
    this.map.removeSource("_snap_vertex");
  }

  enableSnapping() {
    this.snappingEnabled = true;
    this._snappableLayers().forEach((l) => this._addSnapBuffer(l));
    this._addSnapSourceAndLayer();
    this.map.on("mousemove", this._throttledMouseMoveHandler);
    this.map.on("mouseout", this._mouseoutHandler);

    // If the feature has been snapped to a linestring or
    // a polygon, nearestPointOnLine may give an innacurate result (e.g., slightly off the line),
    // especially if the line is very long. Therefore, when the vertex is "complete", we go to the
    // database to get a point that is truly on the snapped-to feature
    this.map.on("mousedown", async () => {
      if (!this.snappedGeometry || !this._drawEndsOnMouseDown()) return;

      if (this._isLineDraw()) {
        this._handleLineStringAndPolygonSnapEnd();
      } else if (this._isPointDraw()) {
        this._handlePointSnapEnd();
      }
    });

    this.map.on("mouseup", async () => {
      if (!this.snappedGeometry || !this._drawEndsOnMouseUp()) return;

      if (this._isLineDraw()) {
        this._handleLineStringAndPolygonSnapEnd();
      } else if (this._isPointDraw()) {
        this._handlePointSnapEnd();
      }
    });
  }

  async _handlePointSnapEnd() {
    if (this._isSnappedToPoint()) return;

    const { features } = this.store.ctx.api.getSelected();
    const feature = cloneDeep(features[0]);
    const [lng, lat] = getCoords(feature);

    const { vetro_id: vetroId } = this.snappedFeature.properties;

    const closestPoint = await this.getClosestPoint(vetroId, lng, lat);

    feature.geometry.coordinates = getCoord(closestPoint);

    const fc = turfFeatureCollection([feature]);

    this.store.ctx.api.set(fc);
  }

  async _handleLineStringAndPolygonSnapEnd() {
    if (this._isSnappedToPoint()) return;

    // get edited coordinate
    const updatedCoord = getCoord(
      this.store.ctx.api.getSelectedPoints().features[0]
    );

    const [lng, lat] = updatedCoord;

    const { vetro_id: vetroId } = this.snappedFeature.properties;

    // get closest point on snapped feature from db, bypassing issues w/ turf/nearest-point-on-line
    const closestPoint = await this.getClosestPoint(vetroId, lng, lat);

    // find index of coord to update
    const feature = cloneDeep(this.store.ctx.api.getSelected().features[0]);
    const index = getCoords(feature).findIndex(
      (coord) => coord[0] === updatedCoord[0] && coord[1] === updatedCoord[1]
    );

    // update feature with the true closest point
    feature.geometry.coordinates.splice(index, 1, getCoord(closestPoint));

    // set this feature as the drawing
    const fc = turfFeatureCollection([feature]);
    this.store.ctx.api.set(fc);
  }

  _circleFromMousePoint(x, y) {
    const mouseLatLng = turfPoint(this.map.unproject([x, y]).toArray());

    const snapDistanceDeltaLatLng = turfPoint(
      this.map.unproject([x + this.snapDistance, y]).toArray()
    );

    const km = turfDistance(mouseLatLng, snapDistanceDeltaLatLng);

    const circle = turfCircle(this.map.unproject([x, y]).toArray(), km);

    return circle;
  }

  _getClosestPoint(x, y) {
    // get point buffers
    const pointBufferIds = this.bufferLayers
      .filter((id) => id.endsWith("point"))
      .map(getBufferLayerId);

    // get close by points
    const availablePoints = this.map.queryRenderedFeatures([x, y], {
      layers: pointBufferIds,
    });

    // everything's a vertex so just return the closest point
    return availablePoints[0];

    // find closest point to mouse

    // leaving in case we do want to get the closest point
    // const coordinates = availablePoints.map((f) => getCoord(f));

    // let closestIndex = null;
    // let closest = null;

    // const { lng, lat } = this.map.unproject([x, y]);
    // const mousePoint = turfPoint([lng, lat]);

    // coordinates.forEach((coord, index) => {
    //   const distance = turfDistance(turfPoint(coord), mousePoint);

    //   if (!closest || closest > distance) {
    //     closest = distance;
    //     closestIndex = index;
    //   }
    // });

    // // return point
    // if (closestIndex !== null) return availablePoints[closestIndex];

    // return null;
  }

  async _getClosestLineStringOrPolygon(x, y) {
    // get linestring and polygon buffers
    const lnpBufferIds = this.bufferLayers
      .filter((id) => id.match(/(linestring|polygon)$/))
      .map(getBufferLayerId);

    // get close by linestring and polygons
    const availableFeatures = this.map.queryRenderedFeatures([x, y], {
      layers: lnpBufferIds,
    });

    if (availableFeatures.length === 0) return null;
    if (availableFeatures.length === 1) return availableFeatures[0];

    // find an feature that has a vertex near the snap point
    const circle = this._circleFromMousePoint(x, y);

    // get real geometry for every feature so that it will have all vertexes
    // limit vertex check to 50 features
    const fullGeometries = await this.fetchSnapGeometries(
      availableFeatures.slice(0, 50)
    );

    const lineStrings = fullGeometries.map(({ coordinates }) =>
      turfLineString(coordinates)
    );

    const lineWithCloseVertex = lineStrings.find(
      (feature) => !!findVertexInCircle(feature, circle)
    );

    if (lineWithCloseVertex) return lineWithCloseVertex;

    // return the first feature if there is no nearby vertex
    return availableFeatures[0];
  }

  _isSnappedToPoint() {
    return getType(this.snappedFeature) === "Point";
  }

  _isPointDraw() {
    return POINT_MODES.includes(this.store.ctx.api.getMode());
  }

  _isLineDraw() {
    return LINE_MODES.includes(this.store.ctx.api.getMode());
  }

  _drawEndsOnMouseUp() {
    return MOUSE_UP_MODES.includes(this.store.ctx.api.getMode());
  }

  _drawEndsOnMouseDown() {
    return MOUSE_DOWN_MODES.includes(this.store.ctx.api.getMode());
  }

  async _mouseMoveHandler(e) {
    const mode = this.store.ctx.api.getMode();
    if ([FREEHAND, MARQUEE, STATIC].includes(mode)) return;
    if (
      [DIRECT_SELECT, SIMPLE_SELECT].includes(mode) &&
      this.store.ctx.map.dragPan._mousePan._enabled
    ) {
      return;
    }

    const {
      point: { x, y },
    } = e;

    let snapToFeature;

    // avoid snapping points to points
    if (this._isLineDraw()) {
      snapToFeature = this._getClosestPoint(x, y);
    }

    if (!snapToFeature) {
      snapToFeature = await this._getClosestLineStringOrPolygon(x, y);
    }

    if (!snapToFeature) {
      this._mouseoutHandler();
      return;
    }

    if (this.snappedFeature) {
      this._setSnapHoverState(this.snappedFeature, false);
    }

    // snappedGeometry: geometry of snapped-to feature retrieved from database
    // snappedFeature: mapbox feature of snapped to feature - has metadata but simplified geometry
    this.snappedGeometry = await this.fetchSnapGeometry(snapToFeature);

    if (!this.snappedGeometry) return;

    this.snappedFeature = snapToFeature;
    this._setSnapHoverState(this.snappedFeature, true);
  }

  _getVertexOrClosestPoint(snapGeom, mousePoint) {
    const { x, y } = mousePoint;

    const circle = this._circleFromMousePoint(x, y);
    const vertex = findVertexInCircle(snapGeom, circle);

    if (vertex) return turfPoint(vertex);

    const hoverPoint = turfPoint(this.map.unproject([x, y]).toArray());
    const closestPoint = getNearestPointOnLine(snapGeom, hoverPoint);

    return closestPoint;
  }

  _getSnapPoint(mousePoint) {
    const coordinates = getCoords(this.snappedGeometry);
    const geomType = getType(this.snappedGeometry);

    if (geomType === "Point") return turfPoint(coordinates);

    // polygons are converted to lines for snapping, so this will
    // always be a line if it's not a point
    const lineString = turfLineString(coordinates);

    return this._getVertexOrClosestPoint(lineString, mousePoint);
  }

  // uses features established by mousemove handler
  // might not need feature filter
  snapCoord({ point: mousePoint, lngLat }, featureFilter) {
    const snappedFeatureFiltered =
      featureFilter && featureFilter(this.snappedFeature);

    const shouldSnap =
      this.snappedGeometry && this.snappingEnabled && !snappedFeatureFiltered;

    if (shouldSnap) {
      const snapPoint = this._getSnapPoint(mousePoint);

      const fc = turfFeatureCollection([snapPoint]);

      this.map.getSource("_snap_vertex").setData(fc);

      this.map.fire("draw.snapped", { snapped: true });

      const [lng, lat] = getCoord(snapPoint);

      return {
        lng,
        lat,
        snapped: true,
        snappedFeature: this.snappedFeature,
      };
    } else {
      this.clearSnapCoord();
      this.map.fire("draw.snapped", { snapped: false });

      return lngLat;
    }
  }

  /** INTERNAL METHODS */

  _snappableLayers() {
    if (typeof this.snapLayers === "function") {
      return this.map
        .getStyle()
        .layers.filter((l) => !l.id.match(/^_snap_/) && this.snapLayers(l))
        .map((l) => l.id);
    } else {
      return this.snapLayers || [];
    }
  }

  _removeSnapBuffer(layerId) {
    const bufferLayerId = getBufferLayerId(layerId);
    this.map.removeLayer(bufferLayerId);
  }

  _addSnapBuffer(layerId) {
    const bufferLayerId = getBufferLayerId(layerId);
    const bufferLayerExists = this.map.getLayer(bufferLayerId);
    if (bufferLayerExists) {
      this.map.removeLayer(bufferLayerId);
    }
    const layerDef = this.map.getLayer(layerId);
    if (!layerDef) {
      console.error(
        `Layer ${layerId} does not exist in map; can't snap to it.`
      );
      return;
    }

    const bufferLayer = getBufferLayer(
      bufferLayerId,
      layerDef,
      this.snapDistance
    );

    this.map.addLayer(bufferLayer);
  }

  _setSnapHoverState(feature, state) {
    if (feature.id !== undefined) {
      const fs = {
        id: feature.id,
        source: feature.source,
      };
      if (feature.sourceLayer) fs.sourceLayer = feature.sourceLayer;
      this.map.setFeatureState(fs, { "snap-hover": state });
    }
  }

  _mouseoutHandler() {
    if (this.snappedFeature) {
      this._setSnapHoverState(this.snappedFeature, false);
      this.snappedGeometry = null;
      this.snappedFeature = null;
    }
  }

  _updateSnapLayers() {
    if (!this.snappingEnabled) return;

    setTimeout(() => {
      const newLayers = this._snappableLayers();

      this.bufferLayers
        .filter((l) => !newLayers.includes(l))
        .forEach((l) => this._removeSnapBuffer(l));

      newLayers
        .filter((l) => !this.bufferLayers.includes(l))
        .forEach((l) => this._addSnapBuffer(l));

      newLayers
        .filter((l) => this.bufferLayers.includes(l))
        .forEach((l) => {
          this.map.setFilter(
            getBufferLayerId(l),
            this.map
              .getLayer(l)
              .filter.filter(
                (filt) => !(filt instanceof Array) || filt[0] !== "!="
              )
          );
        });
      this.bufferLayers = newLayers;
    });
  }
}

module.exports = Snapping;
