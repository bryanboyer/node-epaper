'use strict';

var Jimp = require("jimp");
var child_process = require('child_process');
var util = require('util');
var fs = require('fs');
var exec = child_process.exec;

//Assumes wkhtmltoimage and xvfb-run is installed
//xvfb-run is needed since wkhtmltoimage binary in the
//debian repository does not support headless execution.
//It will probably be fixed in the next version.
function capture(url, out, cb) {
  var command = util.format('xvfb-run wkhtmltoimage --width 800 --height 480 %s %s', url, out);
  exec(command, function (error, stdout, stderr) {
    if (error) {
      return cb(err);
    }

    cb(null, {stderr: stderr, stdout: stdout});
  });
}

function image2Epd(imagePath, out, cb) {
  var sample1BitPng = new Jimp(imagePath, function (err, image) {
    console.log('Before Data width', image.bitmap.width);
    console.log('Before Data height', image.bitmap.height);

    // EPD expects images in portrait orientation
    if (image.bitmap.width > image.bitmap.height) this.rotate(90);

    this.write('temp-rotated.png')

    console.log('After flip Data width', image.bitmap.width);
    console.log('Data height', image.bitmap.height);


    this.resize(480, 800) // resize
    .greyscale();

    console.log('Data len', image.bitmap.data.length);
    console.log('Data width', image.bitmap.width);
    console.log('Data height', image.bitmap.height);

    var oneBitBuf = greyscaleImageTo1Bit(image);
    console.log('oneBitBuf', oneBitBuf.length);

    var outBuf = convertTo1bit_PixelFormatType4(oneBitBuf);
    console.log('outBuf', outBuf.length);

    fs.writeFile(out, outBuf, function(err) {
      if (err) {
        return cb(err);
      }
      return cb(null, out);
    });
  });
}

//Convert from RGBA to 1 byte
function greyscaleImageTo1Bit(image, luminanceFun){
  function luminance(r, g, b) {
    return ((r * 0.3) + (g * 0.59) + (b * 0.11)) > 128 ? 0 : 1;
  }

  var rawImage = image.bitmap.data;
  luminanceFun = luminanceFun || luminance;

  if (rawImage.length % 32 !== 0) {
    throw Error('Not supported ratio');
  }

  var buf = new Buffer(rawImage.length/4);

  for (var i = 0, bit = 0; i < rawImage.length; i += 4){
     var r = rawImage[i];
     var g = rawImage[i+1];
     var b = rawImage[i+2];
     var a = rawImage[i+3];

     buf[i/4] = luminanceFun(r, g, b);
  }

  return buf;
}


var headerTCP74230 = new Buffer(
  [0x3A, 0x01, 0xE0, 0x03, 0x20, 0x01, 0x04, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
//From TCS Developers Guide
//This format is used in TC-P74-230.
function convertTo1bit_PixelFormatType4(picData) {
  var newPicData = new Buffer(headerTCP74230.length + picData.length / 8);

  headerTCP74230.copy(newPicData);

  var row = 30;
  var s = 1;

  for (var i = 0; i < picData.length; i += 16)
  {
    newPicData[headerTCP74230.length + row-s] =
      ((picData[i + 6 ] << 7) & 0x80) |
      ((picData[i + 14] << 6) & 0x40) |
      ((picData[i + 4 ] << 5) & 0x20) |
      ((picData[i + 12] << 4) & 0x10) |
      ((picData[i + 2 ] << 3) & 0x08) |
      ((picData[i + 10] << 2) & 0x04) |
      ((picData[i + 0 ] << 1) & 0x02) |
      ((picData[i + 8 ] << 0) & 0x01);


    newPicData[headerTCP74230.length + row+30-s] =
      ((picData[i + 1 ] << 7) & 0x80) |
      ((picData[i + 9 ] << 6) & 0x40) |
      ((picData[i + 3 ] << 5) & 0x20) |
      ((picData[i + 11] << 4) & 0x10) |
      ((picData[i + 5 ] << 3) & 0x08) |
      ((picData[i + 13] << 2) & 0x04) |
      ((picData[i + 7 ] << 1) & 0x02) |
      ((picData[i + 15] << 0) & 0x01);

    s++;

    if(s == 31){
      s = 1;
      row += 60;
    }
  }

  return newPicData;
};

module.exports = {
  capture: capture,
  image2Epd: image2Epd
};
