/**
 * Calculate the tolerance for the simplification algorithm of polygons
 *
 * @param {number} zoom
 * @return {number} tolerance
 */
module.exports = function(zoom) {
  return Math.pow(2, -zoom);
};
