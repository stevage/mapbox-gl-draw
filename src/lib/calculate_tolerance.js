/**
 * Calculate the tolerance for the simplification algorithm of polygons
 *
 * @param {number} zoom
 * @return {number} tolerance
 */
module.exports = function(zoom) {
  return Math.abs(3 / ((zoom - 4) * 150) - 0.0011);
};
