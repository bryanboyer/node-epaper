'use strict';

var SPI = require('pi-spi');
var async = require('async');
var u = require('lodash');
var util = require('util');
var fs = require('fs');
var gpio = require('./gpio.js');
var imageUtils = require('./image-utils.js');
var status = require('node-status');
var path = require('path');
var console = status.console();

// SPI Settings
// Bit rate – up to 3 MHz
// Polarity – CPOL = 1; clock transition high-to-low on the leading edge and low-to-high on the
// trailing edge
// Phase – CPHA = 1; setup on the leading edge and sample on the trailing edge
// Bit order – MSB first
// Chip select polarity – active low

var resultCodes = [
  {
    hex: "0x0000",
    msg: "OK",
    plainEnglish: "OK",
    state: "ok"
  },
  {
    hex: "0x9000",
    msg: "EP_SW_NORMAL_PROCESSING",
    plainEnglish: "Command successfully executed",
    state: "ok"
  },
  {
    hex: "0x6700",
    msg: "EP_SW_WRONG_LENGTH",
    plainEnglish: "Incorrect length (invalid Lc value or command too short or too long)",
    state: "error"
  },
  {
    hex: "0x6C00",
    msg: "EP_SW_INVALID_LE",
    plainEnglish: "Invalid Le field",
    state: "error"
  },
  {
    hex: "0x6A00",
    msg: "EP_SW_WRONG_PARAMETERS_P1P2",
    plainEnglish: "Invalid P1 or P2 field",
    state: "error"
  },
  {
    hex: "0x6D00",
    msg: "EP_SW_INSTRUCTION_NOT_SUPPORTED",
    plainEnglish: "Command not supported",
    state: "error"
  }
];


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
      //console.log("DUMMY READ", data);

      return cb(err, data);
    });
  });
}

Epaper.prototype._waitUntilNotBusy = function _waitUntilNotBusy(timeout, callback, verbose=true) {
  var self = this;
  self.isBusy(function(err, res){
    if (verbose) console.log('timeout', timeout);

    if (err || timeout < 0) {
      return callback(err || new Error('Timeout in disable'));
    }

    if (verbose) console.log('Busy', res);
    if (res === false) {
      return callback(null);
    }

    setTimeout(self._waitUntilNotBusy.bind(self, timeout-20, callback, verbose), 20);
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
      },false); // verbose = false
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

function parseResultCode(rxbuf) {
  var code = "0x" + rxbuf.toString('hex');

  var picked = u.filter(resultCodes, x => x.hex === code);
  return picked[0].msg;
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
  var spiDev = options.spiDev || '/dev/spidev0.0';
  var clockSpeed = options.clockSpeed || 1e5; //1e5 = 100 khz... I have no idea what notation this is! oops.

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
  return gpio.get(gpio.pins.PIN_BUSY, function(err, val) {
    if (err) {
      return cb(err);
    }
    return cb(null, val ? false: true);
  });
};

Epaper.prototype.enable = function enable(cb) {
  return gpio.set(gpio.pins.PIN_EN, 0, cb);
};

Epaper.prototype.disable = function disable(cb) {
  return gpio.set(gpio.pins.PIN_EN, 1, cb);
};

var MAX_CHUNK_SIZE = 0xFA; // = 250
Epaper.prototype._sendBuf = function _sendBuf(buf, maxChunkSize, cb) {
  var self = this;
  var chunks = u.chunk(buf, maxChunkSize);
  var chunksWritten = 0;
  var bufferTimer = process.hrtime();

  // set up CLI progress bar
  var progress = status.addItem('progress', {
    label: 'Sending Buffer',
    max: buf.length,
    count: 0,
    precision: 0,
    custom: function (msg) {
      return this.msg;
    }
  });
  status.start({
    pattern: ' Sending Buffer: {progress.cyan.bar} {progress.cyan.percentage} {progress.custom}'
  });

  function drawProgress(l,s="........."){
    progress.msg = s;
    progress.inc(l);
  }

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
          //console.log("After Chunk " + chunksWritten, parseResultCode(rxbuf));
          chunksWritten++;
          drawProgress(chunkToWrite.length,parseResultCode(rxbuf));
          return callback(err);
        });

      },false); //verbose = false

    });
  }, function(err){
    // if any of the file processing produced an error, err would equal that error
    if( err ) {
      console.log('Error Result', err);
      return cb(err);
    } else {
      status.stop();
      console.log("\n");

      var msg = util.format('Buffer transfered in %d seconds',process.hrtime(bufferTimer)[0])
      console.log(msg);

      self.spi.read(2, function(err, rxbuf) {
        //console.log("RESULT", rxbuf);
        return cb();
      });
    }
  });
};

Epaper.prototype.sendEpdFile = function sendEpdFile(filePath, cb) {
  var self = this;
  var imageStream = fs.createReadStream(filePath);

  imageStream.on('data', function(chunk) {
    //console.log('got %d bytes of data', chunk.length);
    self._sendBuf(chunk, 250, cb);
  });

  imageStream.on('end', function() {
    //console.log('EPD file read into memory');
  });
};

Epaper.prototype.uploadEpd = function uploadEpd(filePath, cb) {
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
        cb(null, 'Display update successful!');
      });
    });
  }

  this.executeCommand(upload, 0, cb);
}

Epaper.prototype.uploadPng = function uploadPng(pngFile, cb) {
  var self = this;

    imageUtils.image2Epd(pngFile, path.join(path.dirname(fs.realpathSync(pngFile)), '../epd/frame.epd'), function(err) {
      if (err) {
        return cb(err);
      }

      self.uploadEpd(path.join(path.dirname(fs.realpathSync(pngFile)), '../epd/frame.epd'), cb);
    });
}

Epaper.prototype.uploadFromUrl = function uploadFromUrl(url, cb) {
  var self = this;
  imageUtils.capture(url, 'img/temp.png', function(err) {
    if (err) {
      return cb(err);
    }

    imageUtils.image2Epd('img/temp.png', 'epd/frame.epd', function(err) {
      if (err) {
        return cb(err);
      }

      self.uploadEpd('epd/frame.epd', cb);
    });
  });
}

module.exports = new Epaper();
