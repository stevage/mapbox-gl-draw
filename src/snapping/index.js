const throttle = require("lodash.throttle");
const nearestPointOnLine = require("@turf/nearest-point-on-line").default;

const {
  getBufferLayerId,
  getBufferLayer,
  getFeatureFilter,
} = require("./util");
const {
  STATIC,
  FREEHAND,
  MARQUEE,
  DIRECT_SELECT,
  SIMPLE_SELECT,
} = require("../constants").modes;

class Snapping {
  constructor(ctx) {
    this.map = ctx.map;
    this.snappedFeature = null;
    this.snappedGeometry = null;
    this.bufferLayers = [];
    this.snapLayers = ctx.options.snapLayers;
    this.fetchSnapGeometry = ctx.options.fetchSnapGeometry;
    this.fetchSourceGeometry = ctx.options.fetchSourceGeometry;
    this.resetSnappingGeomCache = ctx.options.resetSnappingGeomCache;
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
    this.clearSnapCoord = this.clearSnapCoord.bind(this);
    this.setSnapToSelected = this.setSnapToSelected.bind(this);
    this.cursorIsSnapped = this.cursorIsSnapped.bind(this);
    this.disableSnapping = this.disableSnapping.bind(this);
    this.enableSnapping = this.enableSnapping.bind(this);
    this.resetSnappingGeomCache = this.resetSnappingGeomCache.bind(this);
    this.fetchSourceGeometry = this.fetchSourceGeometry.bind(this);

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
    ctx.api.clearSnapCoord = this.clearSnapCoord;
    ctx.api.cursorIsSnapped = this.cursorIsSnapped;
    ctx.api.disableSnapping = this.disableSnapping;
    ctx.api.enableSnapping = this.enableSnapping;
    ctx.api.resetSnappingGeomCache = this.resetSnappingGeomCache;
    ctx.api.fetchSourceGeometry = this.fetchSourceGeometry;
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
    this.map.off("mousemove", this._throttledMouseOverHandler);
    this.map.off("mouseout", this._mouseoutHandler);
    this.map.removeLayer("_snap_vertex");
    this.map.removeSource("_snap_vertex");
  }

  enableSnapping() {
    this.snappingEnabled = true;
    this._snappableLayers().forEach((l) => this._addSnapBuffer(l));
    this.map.on("mousemove", this._throttledMouseOverHandler);
    this.map.on("mouseout", this._mouseoutHandler);
    this._addSnapSourceAndLayer();
  }

  async _mouseoverHandler(e) {
    const mode = this.store.ctx.api.getMode();
    if ([FREEHAND, MARQUEE, STATIC].includes(mode)) return;
    if (
      [DIRECT_SELECT, SIMPLE_SELECT].includes(mode) &&
      this.store.ctx.map.dragPan._mousePan._enabled
    ) {
      return;
    }

    const bufferLayerIds = this.bufferLayers.map(getBufferLayerId);
    const selectedFeature = this.store.ctx.api.getSelected().features[0];
    const { point: mousePosition } = e;
    const { x, y } = mousePosition;

    const featureFilter = getFeatureFilter(
      selectedFeature,
      this.snappedFeature,
      mode
    );

    const snapToFeature = this.map
      .queryRenderedFeatures([x, y], {
        layers: bufferLayerIds,
      })
      .find(featureFilter);

    if (!snapToFeature) {
      this._mouseoutHandler();
      return;
    }

    if (this.snappedFeature) {
      this._setSnapHoverState(this.snappedFeature, false);
    }

    const lngLat = this.map.unproject(mousePosition);

    const { lng, lat } = lngLat;

    this.snappedGeometry = await this.fetchSnapGeometry(
      snapToFeature,
      lng,
      lat
    );

    if (!this.snappedGeometry) return;

    this.snappedFeature = snapToFeature;
    this._setSnapHoverState(this.snappedFeature, true);
  }

  snapCoord({ lngLat }, featureFilter) {
    if (
      this.snappedGeometry &&
      this.snappingEnabled &&
      (!featureFilter || !featureFilter(this.snappedFeature))
    ) {
      const hoverPoint = {
        type: "Point",
        coordinates: [lngLat.lng, lngLat.lat],
      };

      const snapPoint =
        this.snappedGeometry.type === "Point"
          ? { type: "Feature", geometry: this.snappedGeometry }
          : nearestPointOnLine(this.snappedGeometry, hoverPoint);

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
