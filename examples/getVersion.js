'use strict';

var epaper = require('../index.js');

epaper.init({
  spiDev: '/dev/spidev0.0',
  clockSpeed: 1e5
}, function(err) {
  if (err) {
    throw new Error(err);
  }

});
