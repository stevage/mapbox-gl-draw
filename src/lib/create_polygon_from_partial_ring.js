module.exports = function(ring) {
  const polygon = ring
    .slice()
    .map(coord => coord)
    .concat([ring[0]]);

  return [polygon];
}
