const pointInPolygon = require("@turf/boolean-point-in-polygon").default;
const { getCoords } = require("@turf/invariant");

const LINE_TYPES = ["line", "fill", "fill-extrusion"];
const CIRCLE_TYPES = ["circle", "symbol"];

const getBufferLayerType = (rootLayer) => {
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

exports.getBufferLayerId = (layerId) => `_snap_buffer_${layerId}`;

exports.getBufferLayer = (bufferLayerId, rootLayer, snapDistance) => {
  const bufferLayer = {
    id: bufferLayerId,
    source: rootLayer.source,
  };

  bufferLayer.type = getBufferLayerType(rootLayer);

  if (rootLayer.sourceLayer) {
    bufferLayer["source-layer"] = rootLayer.sourceLayer;
  }
  if (rootLayer.filter) {
    bufferLayer.filter = rootLayer.filter.filter(
      (filt) => !(filt instanceof Array) || filt[0] !== "!="
    );
  }
  if (bufferLayer.type === "circle") {
    bufferLayer.paint = {
      "circle-color": "hsla(0,100%,50%,0.001)",
      "circle-radius": snapDistance,
    };
  } else {
    bufferLayer.paint = {
      "line-color": "hsla(0,100%,50%,0.001)",
      "line-width": snapDistance * 2,
    };
  }
  return bufferLayer;
};

exports.findVertexInCircle = (feature, circle) =>
  getCoords(feature).find((coord) => pointInPolygon(coord, circle));
