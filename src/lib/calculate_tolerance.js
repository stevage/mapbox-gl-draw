module.exports = function(zoom) {
  return Math.abs(3 / ((zoom - 4) * 150) - 0.0011);
};
