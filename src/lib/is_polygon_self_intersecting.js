const { polygon } = require('@turf/helpers');
const unkinkPolygon = require('@turf/unkink-polygon').default;

/**
 * Determine if polygon(s) cross their own border
 *
 * @param {array} polygon coordinates
 * @return {boolean} true if polygon intersects itself
 */
module.exports = function(coords) {
  return coords.every(ring => {
    return ring.length >= 4 && unkinkPolygon(polygon([ring])).features.length > 1;
  });
}
