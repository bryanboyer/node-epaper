'use strict';

var path = require('path');
var fs = require('fs');
var epaper = require('../index.js');

var cliArgs = process.argv.slice(2);

if (cliArgs.length > 0) {
  var filePath = path.join(path.dirname(fs.realpathSync(__filename)), cliArgs[0]);
} else {
  var filePath = path.join(path.dirname(fs.realpathSync(__filename)), 'images/text.png');

}

epaper.init({
  spiDev: '/dev/spidev0.0',
  clockSpeed: 300000
}, function(err) {
  if (err) {
    throw new Error(err);
  }

  if (fs.existsSync(filePath)) {
    epaper.uploadPng(filePath, "temp.png", function(err, data) {
      console.log(err, data);
    });
  } else {
    console.log("Could not find the PNG file");
  }

});
