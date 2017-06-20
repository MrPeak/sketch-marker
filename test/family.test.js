'use strict';

const assert = require('assert');
// const fs = require('fs-extra');
const Family = require('../src/family');
require('co-mocha');

describe('Test tree family.', () => {
  let family;
  const collection = [
    { id: 1, name: 'item1', children: [2, 3] },
    { id: 2, name: 'item2', children: [4, 6], parent: 1 },
    { id: 3, name: 'item3', parent: 1 },
    { id: 4, name: 'item4', parent: 2, children: [5] },
    { id: 5, name: 'item5', parent: 4 },
    { id: 6, name: 'item6', parent: 2 },
  ];

  before(function() {
    family = new Family(collection, {});
  });

  it('Should return no posterity', function() {
    const posterities = family.findPosteritiesById(5);
    assert.deepEqual(posterities, []);
  });

  it('Should return 3 posterities', function() {
    const posterities = family.findPosteritiesById(2);
    console.log(posterities);
    assert.deepEqual(posterities, [
      { id: 4, name: 'item4', parent: 2, children: [5] },
      { id: 5, name: 'item5', parent: 4 },
      { id: 6, name: 'item6', parent: 2 },
    ]);
  });

  it('Should return the parent', () => {
    const parent = family.findParentById(6);
    assert.deepEqual(parent, {
      id: 2,
      name: 'item2',
      children: [4, 6],
      parent: 1,
    });
  });

  it('Should return ancestors', () => {
    const ancestors = family.findAncestorsById(6);
    console.log(ancestors);
    assert.deepEqual(ancestors, [
      { id: 2, name: 'item2', children: [4, 6], parent: 1 },
      { id: 1, name: 'item1', children: [2, 3] },
    ]);
  });

  it('Should return grandpa by specifying ancestor level', () => {
    const grandpa = family.findAncestorByIdAndLevel(6, 2);
    assert.deepEqual(grandpa, { id: 1, name: 'item1', children: [2, 3] });
  });

  it('Should return children', () => {
    const children = family.findChildrenById(1);
    assert.deepEqual(children, [
      { id: 2, name: 'item2', children: [4, 6], parent: 1 },
      { id: 3, name: 'item3', parent: 1 },
    ]);
  });

  it('Should return no sibling', () => {
    const siblings = family.findSiblingsById(5);
    assert.deepEqual(siblings, []);
  });

  it('Should return siblings', () => {
    const siblings = family.findSiblingsById(2);
    assert.deepEqual(siblings, [
      { id: 3, name: 'item3', parent: 1 },
    ]);
  });


});
