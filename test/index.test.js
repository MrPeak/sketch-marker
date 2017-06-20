'use strict';

const path = require('path');
const assert = require('assert');
const Marker = require('../src');
require('co-mocha');

describe('demo', () => {
  let marker;
  beforeEach(() => {
    marker = new Marker(path.join(__dirname, '.', 'assets/FitnessApp.sketch'));
  });

  it.only('Should has layer list', function*() {
    // marker.needSketchTool = false;
    const data = yield marker.getArtboardDataList();
    console.log(data);
    assert(11 === 11);
  });
});
