const turfPolygonToLine = require("@turf/polygon-to-line").default;
const turfNearestPointOnLine = require("@turf/nearest-point-on-line").default;
const throttle = require("lodash.throttle");
const {
  getBufferLayerId,
  getBufferLayer,
  vertexIfClose,
  featureWrapperOnPoint,
  selectedFeatureIsPoint,
  notPointFilter,
  notSelectedFeatureFilter,
} = require("./util");

class Snapping {
  constructor(ctx) {
    this.map = ctx.map;
    this.snappedFeature = null;
    this.snappedGeometry = null;
    this.bufferLayers = [];
    this.snapLayers = ctx.options.snapLayers;
    this.fetchSourceGeometry = ctx.options.fetchSourceGeometry;
    this.resetSnappingGeomCache = ctx.options.resetSnappingGeomCache;
    this.snapFeatureFilter = ctx.options.snapFeatureFilter;
    this.snapDistance = ctx.options.snapDistance;
    this.store = ctx.store;
    this.snapToSelected = false;
    this.snappingEnabled = false;
    // this is the amount the endpoints are preferenced as snap points. and is related to the angle between the hover point, the nearest point and the endpoint
    this.vertexPullFactor = Math.sqrt(2);

    this._mouseoverHandler = this._mouseoverHandler.bind(this);
    this._mouseoutHandler = this._mouseoutHandler.bind(this);
    this.refreshSnapLayers = this.refreshSnapLayers.bind(this);
    this.setSnapLayers = this.setSnapLayers.bind(this);
    this.setSnapFeatureFilter = this.setSnapFeatureFilter.bind(this);
    this.clearSnapCoord = this.clearSnapCoord.bind(this);
    this.setSnapToSelected = this.setSnapToSelected.bind(this);
    this.cursorIsSnapped = this.cursorIsSnapped.bind(this);
    this.disableSnapping = this.disableSnapping.bind(this);
    this.enableSnapping = this.enableSnapping.bind(this);
    this.resetSnappingGeomCache = this.resetSnappingGeomCache.bind(this);

    this.initialize();
    this._throttledMouseOverHandler = throttle(this._mouseoverHandler, 100);
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
    ctx.api.setSnapFeatureFilter = this.setSnapFeatureFilter;
    ctx.api.clearSnapCoord = this.clearSnapCoord;
    ctx.api.cursorIsSnapped = this.cursorIsSnapped;
    ctx.api.disableSnapping = this.disableSnapping;
    ctx.api.enableSnapping = this.enableSnapping;
    ctx.api.resetSnappingGeomCache = this.resetSnappingGeomCache;
  }

  refreshSnapLayers() {
    this._updateSnapLayers();
  }

  setSnapLayers(snapLayers) {
    this.snapLayers = snapLayers;
    this._updateSnapLayers();
  }
  setSnapFeatureFilter(snapFeatureFilter) {
    this.snapFeatureFilter = snapFeatureFilter;
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
    this._snappableLayers().forEach(l => this._removeSnapBuffer(l));
    this.map.off("mousemove", this._throttledMouseOverHandler);
    this.map.off("mouseout", this._mouseoutHandler);
    this.map.removeLayer("_snap_vertex");
    this.map.removeSource("_snap_vertex");
  }

  enableSnapping() {
    this.snappingEnabled = true;
    this._snappableLayers().forEach(l => this._addSnapBuffer(l));
    this.map.on("mousemove", this._throttledMouseOverHandler);
    this.map.on("mouseout", this._mouseoutHandler);
    this._addSnapSourceAndLayer();
  }

  async _mouseoverHandler(e) {
    const { x, y } = e.point;
    let snappableFeaturesNearMouse = this.map
      .queryRenderedFeatures([x, y], {
        layers: this.bufferLayers.map(l => getBufferLayerId(l)),
      })
      .filter(notSelectedFeatureFilter(this.store, this.snapToSelected));

    //  This will prevent Point to Point snapping
    if (selectedFeatureIsPoint(this.store)) {
      snappableFeaturesNearMouse = snappableFeaturesNearMouse.filter(
        notPointFilter
      );
    }

    const newSnappedFeature = this.snapFeatureFilter ?
      snappableFeaturesNearMouse.find(this.snapFeatureFilter) :
      snappableFeaturesNearMouse[0];

    if (!newSnappedFeature) {
      this._mouseoutHandler();
      return;
    }

    if (this.snappedFeature) {
      if (
        this.snappedFeature.properties.feature_id !==
        newSnappedFeature.properties.feature_id
      ) {
        // This is hit when we are snapping from one feature onto another
        this._setSnapHoverState(this.snappedFeature, false);
      } else {
        // This is hit when we stay snapped to the same feature.
        return;
      }
    }

    let geometry = newSnappedFeature.geometry;
    if (typeof this.fetchSourceGeometry === "function"){
      const srcGeom = await this.fetchSourceGeometry(newSnappedFeature);
      if(srcGeom && srcGeom.type && srcGeom.coordinates.length){
        geometry = srcGeom;
      }
    }

    if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
      this.snappedGeometry = turfPolygonToLine(geometry).geometry;
    } else {
      this.snappedGeometry = geometry;
    }

    this.snappedFeature = newSnappedFeature;
    this._setSnapHoverState(this.snappedFeature, true);
  }

  snapCoord({ lngLat }, featureFilter) {
    if (
      this.snappedGeometry && this.snappingEnabled &&
      !(featureFilter && !featureFilter(this.snappedFeature))
    ) {
      const hoverPoint = {
        type: "Point",
        coordinates: [lngLat.lng, lngLat.lat],
      };
      let snapPoint;
      if (this.snappedGeometry.type === "Point") {
        snapPoint = { type: "Feature", geometry: this.snappedGeometry };
      } else {
        // default to snap to the nearest point on the line:
        snapPoint = turfNearestPointOnLine(this.snappedGeometry, hoverPoint);
        const closeEnoughEnpoint = vertexIfClose(
          hoverPoint.coordinates,
          snapPoint.geometry.coordinates,
          this.snappedGeometry.coordinates,
          this.vertexPullFactor
        );
        if (closeEnoughEnpoint) {
          // use the endpoint if we've found that the endpoint is best:
          snapPoint = featureWrapperOnPoint(closeEnoughEnpoint);
        }
      }
      this.map
        .getSource("_snap_vertex")
        .setData({ type: "FeatureCollection", features: [snapPoint] });
      this.map.fire("draw.snapped", { snapped: true });
      return {
        lng: snapPoint.geometry.coordinates[0],
        lat: snapPoint.geometry.coordinates[1],
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
        .layers.filter(l => !l.id.match(/^_snap_/) && this.snapLayers(l))
        .map(l => l.id);
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
      this.map.setFeatureState(
        {
          id: feature.id,
          source: feature.source,
          ...(feature.sourceLayer && { sourceLayer: feature.sourceLayer }),
        },
        { "snap-hover": state }
      );
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
        .filter(l => !newLayers.includes(l))
        .forEach(l => this._removeSnapBuffer(l));

      newLayers
        .filter(l => !this.bufferLayers.includes(l))
        .forEach(l => this._addSnapBuffer(l));

      newLayers
        .filter(l => this.bufferLayers.includes(l))
        .forEach((l) => {
          this.map.setFilter(
            getBufferLayerId(l),
            this.map
              .getLayer(l)
              .filter.filter(
                filt => !(filt instanceof Array) || filt[0] !== "!="
              )
          );
        });
      this.bufferLayers = newLayers;
    });
  }
}

module.exports = Snapping;
