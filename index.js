'use strict';

var SPI = require('pi-spi');
var async = require('async');
var u = require('lodash');
var fs = require('fs');
var gpio = require('./gpio.js');
var imageUtils = require('./image-utils.js');

// SPI Settings
// Bit rate – up to 3 MHz
// Polarity – CPOL = 1; clock transition high-to-low on the leading edge and low-to-high on the
// trailing edge
// Phase – CPHA = 1; setup on the leading edge and sample on the trailing edge
// Bit order – MSB first
// Chip select polarity – active low


var ResultCodes = {
    EP_SW_NORMAL_PROCESSING: 0x9000, //command successfully executed
    EP_SW_WRONG_LENGTH: 0x6700, //incorrect length (invalid Lc value or command too short or too long)
    EP_SW_INVALID_LE: 0x6C00, //invalid Le field
    EP_SW_WRONG_PARAMETERS_P1P2: 0x6A00, //invalid P1 or P2 field
    EP_SW_INSTRUCTION_NOT_SUPPORTED: 0x6D00, //command not supported
};


function Epaper () {

}

function resetPointer(cb) {
    cb = cb || function() {};
    var command = new Buffer([0x20, 0x0D, 0x00]);
    this.executeCommand(command, 2, cb);
}

Epaper.prototype._runCommand = function _runCommand(command, readBytes, cb) {
  var self = this;
  self.spi.write(command, function (err) {
    if (err) {
      console.error('Display update ERROR', err);
      return cb(err);
    }

    self.spi.read(readBytes, function(err, data) {
      console.log("DUMMY READ", data);
      console.log("DUMMY READ", data.toString());

      return cb(err, data);
    });
  });
}

Epaper.prototype.executeCommand = function executeCommand(command, readBytes, cb) {
  var self = this;

  var func = command;
  if (typeof command !== 'function') {
    func = self._runCommand.bind(self, command, readBytes);
  }

  async.series([
    function(callback){
      self.enable(callback);
    },
    function(callback){
      self.isBusy(function(err, busy) {
        if (err || busy === true) {
          return callback(new Error('Busy or not connected!'));
        }

        return callback();
      })
    },
    function(callback){
      func(callback);
    },
    function(callback){
      //Disabling immediately does not allow the epaper to do the action so wait a bit!
      function disable () {
        self.isBusy(function(err, res){
          console.log('timeout', timeout);
          if (err || timeout < 0) {
            return callback(err || new Error('Timeout in disable'));
          }

          console.log('Busy', res);
          if (res === false) {
            return self.disable(callback);
          }

          timeout -= 200;
          setTimeout(disable, 200);
        });
      }

      var timeout = 5000;
      disable();
    },
  ],
  function(err, results){
    if (err) {
      return cb(err);
    }

    //return the result from _runCommand
    return cb(null, results[2]);
  });
}

function parseInfo(infoBuf) {
  var info = {};

  info.buf = infoBuf;
  info.str = infoBuf.toString();

  if (info.str) {
    var splits = info.str.split('-');
    if (splits[0] === 'MpicoSys TC') {
      info.size = splits[1];
      info.version = splits[2];
    }
  }

  return info;
}

Epaper.prototype.getDeviceInfo = function getDeviceInfo(cb) {
  var self = this;
  var command = new Buffer([0x30, 0x01, 0x01, 0x00]);

  this.executeCommand(command, 32, function(err, data) {
    if (err) {
      return cb(err);
    }
    return cb(null, parseInfo(data));
  });
};

Epaper.prototype.init = function init(options, cb) {
  var spiDev = options.spiDev || '/dev/spidev1.0';
  var clockSpeed = options.clockSpeed || 1e5; //100 khz

  this.spi = SPI.initialize(spiDev);
  this.spi.dataMode(SPI.mode.CPHA | SPI.mode.CPOL);
  this.spi.clockSpeed(clockSpeed);
  var self = this;

  gpio.init(function(err) {
    if (err) {
      return cb(err);
    }

    self.getDeviceInfo(function (err, deviceInfo) {
      if (err) {
        return cb(err);
      }
      self.deviceInfo = deviceInfo;
      return cb(null, self.deviceInfo);
    });
  });
};

//pin=1 -> not busy
Epaper.prototype.isBusy = function isBusy(cb) {
  return gpio.get(gpio.pins.P8_10, function(err, val) {
    if (err) {
      return cb(err);
    }
    return cb(null, val ? false: true);
  });
};

Epaper.prototype.enable = function enable(cb) {
  return gpio.set(gpio.pins.P9_12, 0, cb);
};

Epaper.prototype.disable = function disable(cb) {
  return gpio.set(gpio.pins.P9_12, 1, cb);
};

var MAX_CHUNK_SIZE = 0xFA;
Epaper.prototype._sendBuf = function _sendBuf(buf, maxChunkSize, cb) {
  var self = this;
  var chunks = u.chunk(buf, maxChunkSize);

  async.eachSeries(chunks, function(chunk, callback) {
    var INS = 0x20;
    var P1 = 0x01;
    var P2 = 0x00;
    var Lc = chunk.length;
    chunk.unshift.apply(chunk, [INS, P1, P2, Lc]);

    var chunkToWrite = new Buffer(chunk);
    //console.log("Chunk Size", chunkToWrite.length, 'Chunk:', chunkToWrite);

    self.spi.write(chunkToWrite, function(err) {
      //console.log("WRITE CB", arguments);
      var rxbuf = new Buffer(2);
      callback(err);
    });
  }, function(err){
    // if any of the file processing produced an error, err would equal that error
    if( err ) {
      console.log('Error Result', err);
      return cb(err);
    } else {
      console.log('All fine');
      self.spi.read(2, function(err, rxbuf) {
        console.log("RESULT", rxbuf);
        return cb();
      });
    }
  });
};

Epaper.prototype.sendEpdFile = function sendEpdFile(filePath, cb) {
  var self = this;
  var imageStream = fs.createReadStream(filePath);
  var chunkSize = 120;

  imageStream.on('data', function(chunk) {
    console.log('got %d bytes of data', chunk.length);

    self._sendBuf(chunk, chunkSize, cb);
  });

  imageStream.on('end', function() {
    console.log('Stream End');
  });
};

Epaper.prototype.uploadImage = function uploadImage(filePath, cb) {
  var self = this;
  function displayUpdate(cb) {
    var command = new Buffer([0x24, 0x01, 0x00]);
    self._runCommand(command, 2, cb);
  }

  function upload(cb) {
    self.sendEpdFile(filePath, function(err) {
      if (err) {
        return cb('Error sending epd', err);
      }

      displayUpdate(function(err) {
        if (err) {
          return cb('Error refreshing display', err);
        }
        cb(null, 'Image upload is successful');
      });
    });
  }

  this.executeCommand(upload, 0, cb);
}

Epaper.prototype.uploadFromUrl = function uploadFromUrl(url, cb) {
  var self = this;
  imageUtils.capture(url, 'temp.png', function(err) {
    if (err) {
      return cb(err);
    }

    imageUtils.image2Epd('temp.png', 'temp.epd', function(err) {
      if (err) {
        return cb(err);
      }

      self.uploadImage('temp.epd', cb);
    });
  });
}

module.exports = new Epaper();
