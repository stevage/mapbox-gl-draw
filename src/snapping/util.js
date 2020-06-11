const turf = require("@turf/turf");

const LINE_TYPES = ["line", "fill", "fill-extrusion"];
const CIRCLE_TYPES = ["circle", "symbol"];

const getBufferLayerType = rootLayer => {
  if (LINE_TYPES.includes(rootLayer.type)) {
    return "line";
  } else if (CIRCLE_TYPES.includes(rootLayer.type)) {
    return "circle";
  } else {
    console.error(
      `Unsupported snap layer type ${rootLayer.type} for layer ${rootLayer.id}`
    );
  }
};

const shouldSnapToVertex = (
  hoverPoint,
  nearestPoint,
  enpoint,
  vertexPullFactor
) => {
  const smallerDistance = turf.distance(hoverPoint, nearestPoint);
  const largerDistance = turf.distance(hoverPoint, enpoint);
  return largerDistance / smallerDistance < vertexPullFactor;
};

exports.getBufferLayerId = layerId => `_snap_buffer_${layerId}`;

exports.getBufferLayer = (bufferLayerId, rootLayer, snapDistance) => {
  const bufferLayer = {
    id: bufferLayerId,
    source: rootLayer.source
  };

  bufferLayer.type = getBufferLayerType(rootLayer);

  if (rootLayer.sourceLayer) {
    bufferLayer["source-layer"] = rootLayer.sourceLayer;
  }
  if (rootLayer.filter) {
    bufferLayer.filter = rootLayer.filter;
  }
  if (bufferLayer.type === "circle") {
    bufferLayer.paint = {
      "circle-color": "hsla(0,100%,50%,0.001)",
      "circle-radius": snapDistance
    };
  } else {
    bufferLayer.paint = {
      "line-color": "hsla(0,100%,50%,0.001)",
      "line-width": snapDistance * 2
    };
  }
  return bufferLayer;
};

exports.vertexIfClose = (
  hoverpoint,
  nearestPoint,
  lineCoord,
  vertexPullFactor
) => {
  for (const vertex of lineCoord) {
    if (
      shouldSnapToVertex(hoverpoint, nearestPoint, vertex, vertexPullFactor)
    ) {
      return vertex;
    }
  }
};

exports.featureWrapperOnPoint = point => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: point }
});

exports.selectedFeatureIsPoint = store => {
  const feature = Object.values(store._features)[0];
  return feature && feature.type === "Point";
};

exports.notPointFilter = feature => feature.geometry.type !== "Point";

exports.notSelectedFeatureFilter = (store, snapToSelected) => feature => {
  return (
    (!snapToSelected && !store._features[feature.properties.vetro_id]) ||
    (snapToSelected && store._features[feature.properties.vetro_id])
  );
};
