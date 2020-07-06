const cursors = require("../constants").cursors;

const SplitLine = {};

const appendData = (map, coordinates) => {
  const source = map.getSource("_split_vertecies");
  const features = [
    ...source._data.features,
    { type: "Feature", geometry: { type: "Point", coordinates } }
  ];
  source.setData({
    type: "FeatureCollection",
    features
  });

  const type = features.length > 1 ? "MultiPoint" : "Point";
  const splitPointCoordinates =
    features.length > 1
      ? features.map(feature => feature.geometry.coordinates)
      : features[0].geometry.coordinates;
  const splitPointGeometry = {
    type,
    coordinates: splitPointCoordinates
  };
  map.fire("draw.splitPoints", { splitPointGeometry });
};

const clearData = map => {
  const source = map.getSource("_split_vertecies");
  if (source) {
    source.setData({
      type: "FeatureCollection",
      features: []
    });
  }
  map.fire("draw.splitPoints", { splitPointGeometry: null });
};

SplitLine.onSetup = function onSetup({ featureFilter }) {
  this._ctx.snapping.setSnapToSelected(true);
  clearData(this.map);
  const removeSplitVertecies = () => {
    clearData(this.map);
  };
  this._ctx.setGetCursorTypeLogic(({ snapped, isOverAny }) => {
    if (snapped) {
      return cursors.ADD;
    } else if (isOverAny) {
      return cursors.POINTER;
    } else {
      return cursors.GRAB;
    }
  });
  this._ctx.api.removeSplitVertecies = removeSplitVertecies;
  if (!this.map.getSource("_split_vertecies")) {
    this._ctx.map.addSource("_split_vertecies", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: []
      }
    });
  }
  if (!this.map.getLayer("_split_vertecies")) {
    this.map.addLayer({
      id: "_split_vertecies",
      type: "circle",
      source: "_split_vertecies",
      paint: {
        "circle-color": "transparent",
        "circle-radius": 3,
        "circle-stroke-width": 2,
        "circle-stroke-color": "orange"
      }
    });
  }

  setTimeout(() => {
    this.map.on("draw.modechange", ({ mode }) => {
      if (mode !== "split") {
        this.map.fire("draw.splitPoints", { splitPointGeometry: null });
        if (this.map.getLayer("_split_vertecies")) {
          this.map.removeLayer("_split_vertecies");
        }
        if (this.map.getSource("_split_vertecies")) {
          this.map.removeSource("_split_vertecies");
        }
        this.map.getCanvas().style.cursor = null;
      }
    });
  });

  this.setActionableState({});

  return { featureFilter }; // this state will be passed to future events
};

SplitLine.onClick = function onClick(state, e) {
  const lngLat = this._ctx.snapping.snapCoord(e, state.featureFilter);
  if (!lngLat.snapped) {
    // don't fire if we weren't close enough to a feature to snap to it.
    return;
  }
  const { lat, lng, snappedFeature } = lngLat;
  if (snappedFeature.geometry.type !== "LineString") {
    return;
  }
  appendData(this.map, [lng, lat]);
};

SplitLine.onMouseMove = function onMouseMove(state, e) {
  this._ctx.snapping.snapCoord(e, state.featureFilter);
};

SplitLine.onTap = SplitLine.onClick;

SplitLine.toDisplayFeatures = function toDisplayFeatures(
  state,
  geojson,
  display
) {
  geojson.properties.active = true;
  return display(geojson);
};

SplitLine.stopDrawingAndRemove = function stopDrawingAndRemove(state) {
  this.changeMode("simple_select");
};

SplitLine.onTrash = SplitLine.stopDrawingAndRemove;

module.exports = SplitLine;
