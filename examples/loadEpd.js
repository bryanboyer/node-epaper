'use strict'

var path = require('path')
var fs = require('fs')
var epaper = require('../index.js')

var cliArgs = process.argv.slice(2);

if (cliArgs.length > 0) {
  var filePath = path.join(path.dirname(fs.realpathSync(__filename)), cliArgs[0]);
} else {
  var filePath = path.join(path.dirname(fs.realpathSync(__filename)), 'images/text.epd');
}

epaper.init({
  spiDev: '/dev/spidev0.0',
  clockSpeed: 1e5
}, function(err) {
  if (err) {
    throw new Error(err)
  }

  epaper.uploadEpd(filePath, function(err, data) {
    console.log(err, data);
  });
});
