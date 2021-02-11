module.exports = function(ring) {
  const ringIsComplete = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];

  if (ringIsComplete) {
    return [ring];
  }

  const polygon = ring
    .slice()
    .map(coord => coord)
    .concat([ring[0]]);

  return [polygon];
}
