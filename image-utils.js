'use strict';

var Jimp = require("jimp");
var child_process = require('child_process');
var util = require('util');
var fs = require('fs');
var clamp = require("clamp");
var path = require('path');
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

    //var tempRotatedPath = path.join(path.dirname(fs.realpathSync(out)), '../img/frame-rotated.png');
    //this.write(tempRotatedPath);

    console.log('After flip Data width', image.bitmap.width);
    console.log('Data height', image.bitmap.height);

    this.resize(480, 800) // resize
    .greyscale()
    .ditherFloyd();

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

/* Dithering algos */

Jimp.prototype.ditherSimple = function (cb) {

  var rawImage = this.bitmap.data;

  for (var i = 0, bit = 0; i < rawImage.length; i += 4){
    var ideal = (rawImage[i] + rawImage[i+1] + rawImage[i+2]) / 3;
    var clamped = ideal > 128 ? 255 : 0;
    var dither_error = ideal - clamped;

    // alter R,G,B
    rawImage[i] = ideal > 130 ? 255 : 0;
    rawImage[i+1] = ideal > 130 ? 255 : 0;
    rawImage[i+2] = ideal > 130 ? 255 : 0;

    // now cast some error onto the next pixel
    rawImage[i+4] += dither_error*1/3;
    rawImage[i+5] += dither_error*1/3;
    rawImage[i+6] += dither_error*1/3;
  }

  console.log("Dithering (simple error offset)");

  if (isNodePattern(cb)) return cb.call(this, null, this);
  else return this;
}

Jimp.prototype.ditherFloyd = function (cb) {
  var rawImage = this.bitmap.data;

  // rawImage.averageColor = averageColor(this);
  // console.log("Average color",rawImage.averageColor.toFixed(2));

  var count = 0;
  var y = 0;

  for (var i = 0, bit = 0; i < rawImage.length; i += 4){
    var x = (i - (480*y*4))/4;

    var ideal = (rawImage[i] + rawImage[i+1] + rawImage[i+2]) / 3;
    var clamped = ideal > 130 ? 255 : 0;
    var dither_error = ideal - clamped;

    // alter R,G,B
    var pixelColor = ideal > 130 ? Jimp.rgbaToInt(255, 255, 255, 255) : Jimp.rgbaToInt(0, 0, 0, 255);
    this.setPixelColor(pixelColor, x, y);

    // now cast some error onto the next pixel
    this.setPixelColor(adjustPixel(this,x+1,y,dither_error*7/16), x+1, y);
    this.setPixelColor(adjustPixel(this,x-1,y+1,dither_error*3/16), x-1, y+1);
    this.setPixelColor(adjustPixel(this,x,y+1,dither_error*5/16), x, y+1);
    this.setPixelColor(adjustPixel(this,x+1,y+1,dither_error*1/16), x+1, y+1);

    // now iterate the coordinate tracker
    count++;
    if (count>=480) {
      y++;
      count=0;
    }

  }
  console.log("Dithering (Floyd-Steinberg)");

  if (isNodePattern(cb)) return cb.call(this, null, this);
  else return this;

}

Jimp.prototype.ditherAtkinson = function (cb) {
  var rawImage = this.bitmap.data;

  // rawImage.averageColor = averageColor(this);
  // console.log("Average color",rawImage.averageColor.toFixed(2));

  var count = 0;
  var y = 0;

  for (var i = 0, bit = 0; i < rawImage.length; i += 4){
    var x = (i - (480*y*4))/4;

    var ideal = (rawImage[i] + rawImage[i+1] + rawImage[i+2]) / 3;
    var clamped = ideal > 130 ? 255 : 0;
    var dither_error = ideal - clamped;

    // alter R,G,B
    var pixelColor = ideal > 130 ? Jimp.rgbaToInt(255, 255, 255, 255) : Jimp.rgbaToInt(0, 0, 0, 255);
    this.setPixelColor(pixelColor, x, y);

    // now cast some error onto the next pixel
    this.setPixelColor(adjustPixel(this,x+1,y,dither_error*1/8), x+1, y);
    this.setPixelColor(adjustPixel(this,x+2,y,dither_error*1/8), x+2, y);
    this.setPixelColor(adjustPixel(this,x-1,y+1,dither_error*1/8), x-1, y+1);
    this.setPixelColor(adjustPixel(this,x,y+1,dither_error*1/8), x, y+1);
    this.setPixelColor(adjustPixel(this,x+1,y+1,dither_error*1/8), x+1, y+1);
    this.setPixelColor(adjustPixel(this,x,y+2,dither_error*1/8), x, y+2);

    // now iterate the coordinate tracker
    count++;
    if (count>=480) {
      y++;
      count=0;
    }

  }
  console.log("Dithering (Atkinson)");

  if (isNodePattern(cb)) return cb.call(this, null, this);
  else return this;

}

/* end Dithering algos */

/* Dithering utils */

function adjustPixel(img, x, y, error){
  var color = Jimp.intToRGBA(img.getPixelColor(x,y));
  color.r = clamp(color.r+error, 0, 255);
  color.g = clamp(color.g+error, 0, 255);
  color.b = clamp(color.b+error, 0, 255);
  return Jimp.rgbaToInt(color.r,color.g,color.b,color.a);
}

function averageColor(img){
  var sum = 0;
  for (var i = 0; i < img.bitmap.data.length; i += 4){
    // base 10
    sum += parseInt(img.bitmap.data[i],10);
  }
  return sum / (img.bitmap.data.length/4);
}

function isNodePattern(cb) {
    if ("undefined" == typeof cb) return false;
    if ("function" != typeof cb)
        throw new Error("Callback must be a function");
    return true;
}

/* end Dithering utils */

module.exports = {
  capture: capture,
  image2Epd: image2Epd
};
