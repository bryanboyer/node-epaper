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
var assert = require('assert');

var pins = require('./pins.js');

var gpioInitPath = path.join(path.dirname(fs.realpathSync(__filename)), 'pin-configure.sh')

function getPinPath(pin) {
  return util.format('/sys/class/gpio/gpio%d/value', pin.bcm);
}

var pins = {
  PIN_BUSY: {beaglebone: 'P8.10', bcm: 23, physical: 12},
  PIN_EN: {beaglebone:'P9.12', bcm: 28, physical: 16}
};

function Gpio() {
  this.pins = pins;
}

Gpio.prototype.init = function init(options, cb) {
  var self = this;
  assert(options.busyPin);
  assert(options.enablePin)
  console.log(gpioInitPath);
  child_process.exec("sh " + gpioInitPath, function(error, stdout, stderr) {
    console.log(stdout);
    console.log(stderr);
    if (error) {
      return cb(error);
    }
    //config-pin P9.12 out  #EN
    //config-pin P8.10 in   #BUSY

    self.set(options.busyPin, 'in', function(err) {
      if (err) {
        return cb(err);
      }
      self.set(options.enablePin, 'out', function(err) {
        return cb(err);
      });
    });
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
  var command = util.format('gpio -g write %s %s', pin.bcm, value);
  exec(command, function (error, stdout, stderr) {
    if (stderr) {
      console.log('stderr: ' + stderr);
    }

    cb(error);
  });
}

Gpio.prototype.set = function set(pin, value, cb) {
  var strValue = 'low';
  if (value === 'in' || value === 'out') {
    strValue = value;
  } else if (value && value !== '0') {
    strValue = 'hi';
  }
  var command = genCommand(pin, strValue);
  this.execCommand(command, cb);
}

module.exports = new Gpio();
