const Constants = require("../constants");

module.exports = {
  updateLineWidth(ctx, value) {
    const layerIds = Object.values(Constants.layerIds.LINE)
      .map(id => ([`${id}.hot`, `${id}.cold`]))
      .flat();

    layerIds.forEach(id => {
      ctx.map.setPaintProperty(id, 'line-width', value);
    });
  }
};
