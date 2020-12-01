/**
 * Determine if a selectable parameter was passed into a modes options
 *
 * @param {object} options
 * @return {boolean} selectable
 */
module.exports = function(opts) {
  return opts.hasOwnProperty('selectable') ? !!opts.selectable : true;
}
