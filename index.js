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

Epaper.prototype._waitUntilNotBusy = function _waitUntilNotBusy(timeout, callback) {
  var self = this;
  self.isBusy(function(err, res){
    console.log('timeout', timeout);
    if (err || timeout < 0) {
      return callback(err || new Error('Timeout in disable'));
    }

    console.log('Busy', res);
    if (res === false) {
      return callback(null);
    }

    setTimeout(self._waitUntilNotBusy.bind(self, timeout-200, callback), 200);
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
      self._waitUntilNotBusy(5000, function(err) {
        if (err) {
          return callback(err);
        }
        return self.disable(callback);
      });
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

  this.busyPin = options.busyPin || gpio.pins['P8_10'];
  this.enablePin = options.enablePin || gpio.pins['P9_12'];

  this.spi = SPI.initialize(spiDev);
  this.spi.dataMode(SPI.mode.CPHA | SPI.mode.CPOL);
  this.spi.clockSpeed(clockSpeed);
  var self = this;

  gpio.init({busyPin: this.busyPin, enablePin: this.enablePin}, function(err) {
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
  return gpio.get(this.busyPin, function(err, val) {
    if (err) {
      return cb(err);
    }
    return cb(null, val ? false: true);
  });
};

Epaper.prototype.enable = function enable(cb) {
  return gpio.set(this.enablePin, 0, cb);
};

Epaper.prototype.disable = function disable(cb) {
  return gpio.set(this.enablePin, 1, cb);
};

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

    self.spi.write(chunkToWrite, function(err) {

      self._waitUntilNotBusy(1000, function(err) {
        if (err) {
          return callback(err);
        }
        self.spi.read(2, function(err, rxbuf) {
          console.log("After Chunk", rxbuf);
          return callback(err);
        });

      });

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

Epaper.prototype.sendEpd = function sendEpd(epd, cb) {
  var self = this;

  //epd can be a filePath or buffer
  if (typeof epd === 'string') {
    var filePath = epd;

    var imageStream = fs.createReadStream(filePath);

    //TODO not a very smart way. It may arrive in several chunks and then it would fail.
    imageStream.on('data', function(chunk) {
      console.log('got %d bytes of data', chunk.length);

      self._sendBuf(chunk, 120, cb);
    });

    imageStream.on('end', function() {
      console.log('Stream End');
    });
  } else {
    self._sendBuf(epd, 120, cb);
  }
};

Epaper.prototype.uploadImage = function uploadImage(epd, cb) {
  var self = this;
  function displayUpdate(cb) {
    var command = new Buffer([0x24, 0x01, 0x00]);
    self._runCommand(command, 2, cb);
  }

  function upload(cb) {
    self.sendEpd(epd, function(err) {
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

    imageUtils.image2Epd('temp.png', function(err, epdBuf) {
      if (err) {
        return cb(err);
      }

      self.uploadImage(epdBuf, cb);
    });
  });
}

module.exports = new Epaper();
