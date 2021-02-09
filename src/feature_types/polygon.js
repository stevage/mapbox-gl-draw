const { polygon } = require('@turf/helpers');
const unkinkPolygon = require('@turf/unkink-polygon').default;
const Feature = require('./feature');

const Polygon = function(ctx, geojson) {
  Feature.call(this, ctx, geojson);
  this.coordinates = this.coordinates.map(ring => ring.slice(0, -1));
};

Polygon.prototype = Object.create(Feature.prototype);

Polygon.prototype.isValid = function() {
  if (this.coordinates.length === 0) return false;
  return this.coordinates.every(ring => ring.length > 2);
};

Polygon.prototype.isCreatingValid = function() {
  if (this.coordinates.length === 0) return false;
  const isValid = this.coordinates.every(ring => {
    // console.log('ring', ring);
       
    let polyCoords = [];

    if (ring.length >= 4) {
      polyCoords = ring.slice(0, ring.length - 1).concat([ring[0]]);
    }

    if (polyCoords.length >= 4) {
      // console.log('valid check', polyCoords.length >= 4, unkinkPolygon(polygon([polyCoords])).features, unkinkPolygon(polygon([polyCoords])).features.length === 1);
    }

    return polyCoords.length >= 4 && unkinkPolygon(polygon([polyCoords])).features.length === 1;
  });

  console.log('valid?', isValid);
  return isValid;
};

// Expects valid geoJSON polygon geometry: first and last positions must be equivalent.
Polygon.prototype.incomingCoords = function(coords) {
  this.coordinates = coords.map(ring => ring.slice(0, -1));
  this.changed();
};

// Does NOT expect valid geoJSON polygon geometry: first and last positions should not be equivalent.
Polygon.prototype.setCoordinates = function(coords) {
  this.coordinates = coords;
  this.changed();
};

Polygon.prototype.addCoordinate = function(path, lng, lat) {
  this.changed();
  const ids = path.split('.').map(x => parseInt(x, 10));

  const ring = this.coordinates[ids[0]];

  ring.splice(ids[1], 0, [lng, lat]);
};

Polygon.prototype.removeCoordinate = function(path) {
  this.changed();
  const ids = path.split('.').map(x => parseInt(x, 10));
  const ring = this.coordinates[ids[0]];
  if (ring) {
    ring.splice(ids[1], 1);
    if (ring.length < 3) {
      this.coordinates.splice(ids[0], 1);
    }
  }
};

Polygon.prototype.getCoordinate = function(path) {
  const ids = path.split('.').map(x => parseInt(x, 10));
  const ring = this.coordinates[ids[0]];
  return JSON.parse(JSON.stringify(ring[ids[1]]));
};

Polygon.prototype.getCoordinates = function(creating) {
  return creating
    ? JSON.parse(JSON.stringify(this.coordinates.map(coords => {
      // remove the placeholder vertex
      const newCoords = coords.slice();
      newCoords.splice(newCoords.length - 2, 1);

      return newCoords.concat([newCoords[0]]);
    })))
    : this.coordinates.map(coords => coords.concat([coords[0]]));
};

Polygon.prototype.updateCoordinate = function(path, lng, lat) {
  this.changed();
  const parts = path.split('.');
  const ringId = parseInt(parts[0], 10);
  const coordId = parseInt(parts[1], 10);

  if (this.coordinates[ringId] === undefined) {
    this.coordinates[ringId] = [];
  }

  this.coordinates[ringId][coordId] = [lng, lat];
};

module.exports = Polygon;
