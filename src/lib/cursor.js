const throttle = require("lodash.throttle");
const featuresAt = require("./features_at");
const cursors = require("../constants").cursors;

class CursorManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.snapped = false;
    ctx.setGetCursorTypeLogic = this.setGetCursorTypeLogic;
    this.init();
  }

  init() {
    this.ctx.map.on("draw.snapped", ({ snapped }) => {
      console.log("isSnapped");
      this.snapped = snapped;
    });
  }
  setCursor(event, eventType) {
    const glDrawFeats = featuresAt.click(event, null, this.ctx);
    const allFeatures = featuresAt
      .any(event, null, this.ctx)
      .filter(l => !l.layer.id.includes("snap"));

    const cursorType =
      this.getCursorType &&
      this.getCursorType({
        snapped: this.snapped,
        isOverSelected: Boolean(glDrawFeats[0]),
        isOverAny: allFeatures.length > 0
      });
    this.ctx.map.getCanvas().style.cursor = null;
    if (cursorType) {
      this.ctx.ui.queueMapClasses({ mouse: cursorType });
      this.ctx.ui.updateMapClasses();
    } else {
      this.ctx.ui.queueMapClasses({ mouse: cursors.NONE });
      this.ctx.ui.updateMapClasses();
    }

    return glDrawFeats[0];
  }
}

// CursorManager.prototype.getCursorType = () => "grab";

CursorManager.prototype.setGetCursorTypeLogic = function(fn) {
  console.log("hit");
  console.log(this);
  if (fn) {
    CursorManager.prototype.getCursorType = fn;
  } else {
    CursorManager.prototype.getCursorType = null;
  }
};
module.exports = CursorManager;
