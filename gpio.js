/*
gpio unexportall
gpio export 23 in # /TC_EN (1=disabled 0=enabled)
gpio export 18 high
sleep 1
gpio export 18 low #to enable /TC_EN
sleep 1 # for setup and initialization of TCON
echo "Pins exported using gpio"
*/

'use strict';

var path = require('path');
var util = require('util');
var child_process = require('child_process');
var fs = require('fs');
var exec = child_process.exec;

var gpioInitPath = path.join(path.dirname(fs.realpathSync(__filename)), 'pin-configure.sh')

function getPinPath(pin) {
  return util.format('/sys/class/gpio/gpio%d/value', pin.bcm);
}

var pins = {
  PIN_BUSY: {beaglebone: 'P8.10', bcm: x, physical: x, id: 18},
  PIN_EN: {beaglebone:'P9.12', bcm: x, physical: x, id: 23}
};

function Gpio() {
  this.pins = pins;
}

Gpio.prototype.init = function init(cb) {
  console.log(gpioInitPath);
  child_process.execFile("sh " + gpioInitPath, function(error, stdout, stderr) {
    console.log(stdout);
    console.log(stderr);
    cb(error);
  });
}

Gpio.prototype.get = function get(pin, cb) {
  fs.readFile(getPinPath(pin), function (err, data) {
    if (err) throw err;
    return cb(null, parseInt(data));
  });
}

Gpio.prototype.set = function set(pin, value, cb) {
  // gpio -g write 13 1
  // turn pin 13 to value 1. Must use BCM pin number.
  var command = util.format('gpio -g write %s %s', pin.name, value);
  exec(command, function (error, stdout, stderr) {
    if (stderr) {
      console.log('stderr: ' + stderr);
    }

    cb(error);
  });
}

module.exports = new Gpio();
