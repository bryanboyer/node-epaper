'use strict';

var epaper = require('../index.js');

epaper.init({
  spiDev: '/dev/spidev0.0',
  clockSpeed: 1e5
});

function displayUpdate() {
      epaper.displayUpdate(function(err) {
        if (err) {
          return console.log('Error refreshing display');
        }
        console.log('Image update successful!');
      });
}

epaper.displayUpdate();

