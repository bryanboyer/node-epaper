'use strict';

var path = require('path');
var fs = require('fs');
var epaper = require('../index.js');

epaper.init({
  spiDev: '/dev/spidev0.0',
  clockSpeed: 1e5
}, function(err) {
  if (err) {
    throw new Error(err);
  }

  var cliArgs = process.argv.slice(2);
  var pngFilePath = path.join(path.dirname(fs.realpathSync(__filename)), cliArgs[0]);

  if (fs.existsSync(pngFilePath)) {
    epaper.uploadPng(pngFilePath, function(err, data) {
      console.log(err, data);
    });
  } else {
    console.log("Could not find the PNG file");
  }

});
