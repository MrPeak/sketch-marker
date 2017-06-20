'use strict';

/**
 * @class Family
 */
class Family {
  /**
   * Creates an instance of Family.
   * @param {Object[]} members - node members
   * @param {Object} config - custom config
   *
   * @memberof Family
   */
  constructor(members, config) {
    this.members = members;
    this.idKey = config.idKey || 'id';
    this.childrenKey = config.childrenKey || 'children';
  }

  toString() {
    return JSON.stringify(this.members);
  }

  _find(predicate) {
    const candidate = this._predicate(predicate); // not greedy
    return candidate[0];
  }

  _predicate(predicate, isGreedy) {
    isGreedy = isGreedy === true || false;
    const arr = [];
    for (const member of this.members) {
      const ret = Object.keys(predicate).every(
        key => member[key] === predicate[key]
      );

      if (ret) {
        arr.push(member);
        if (!isGreedy) break;
      }
    }

    return arr;
  }

  /**
   * Walk node
   *
   * @param {Object} member - the member
   * @param {Array} stack - stack data
   * @param {String} [type=down] - walk type
   * @return {Object[]} members
   *
   * @memberof Family
   * @private
   */
  _walk(member, stack, type) {
    type = type || 'down';

    if (type === 'down') {
      // 向下
      const childIdList = member[this.childrenKey];

      // Loop
      childIdList &&
        childIdList.forEach(childId => {
          const child = this._find({
            [this.idKey]: childId,
          });

          child && stack.push(child);
          // Recursive
          child && this._walk(child, stack, type);
        });
    } else if (type === 'up') {
      // 向上
      const parent = this.findParentById(member[this.idKey]);

      parent && stack.push(parent);
      parent && this._walk(parent, stack, type);
    }

    return stack;
  }

  /**
   * Get posterities by id
   *
   * @param {String} posterityId - Node id
   *
   * @return {Object[]} Posterity list
   * @memberof Family
   * @public
   */
  findPosteritiesById(posterityId) {
    const posterityList = [];

    const posterity = this._find({
      [this.idKey]: posterityId,
    });

    this._walk(posterity, posterityList);

    return posterityList;
  }

  /**
   * Get children by id
   *
   * @param {String} parentId - Node id
   *
   * @return {Object[]} Child list
   * @memberof Family
   * @public
   */
  findChildrenById(parentId) {
    const parent = this._find({
      [this.idKey]: parentId,
    });

    const childIdList = parent[this.childrenKey];

    const children = childIdList.reduce((res, childId) => {
      res.push(this._find({ [this.idKey]: childId }));
      return res;
    }, []);

    return children;
  }

  /**
   * Get parent by id
   *
   * @param {String} childId - Node id
   *
   * @return {Object} Parent
   * @memberof Family
   * @public
   */
  findParentById(childId) {
    const child = this._find({
      [this.idKey]: childId,
    });

    const parent = this._find({
      [this.idKey]: child.parent,
    });

    return parent;
  }

  /**
   * Get ancestors by id
   *
   * @param {String} posterityId - Node id
   *
   * @return {Object[]} Ancestor list. The older the list index, the farther the ancestor's hierarchy is.
   * @memberof Family
   * @public
   */
  findAncestorsById(posterityId) {
    const ancestorList = [];
    const posterity = this._find({
      [this.idKey]: posterityId,
    });

    this._walk(posterity, ancestorList, 'up');

    return ancestorList;
  }

  /**
   * Get ancestor by level
   * The older the level number, the farther the ancestor's hierarchy is.
   *
   * @param {String} id - Node id
   * @param {Number} [level=1] - Ancestor level
   *
   * @return {Object} Ancestor
   * @memberof Family
   * @public
   */
  findAncestorByIdAndLevel(id, level) {
    const ancestorList = this.findAncestorsById(id);
    return ancestorList[level - 1];
  }

  /**
   * Get siblings by id
   *
   * @param {String} id - Node id
   *
   * @return {Object[]} Ancestor list. The older the list index, the farther the ancestor's hierarchy is.
   * @memberof Family
   * @public
   */
  findSiblingsById(id) {
    const parent = this.findParentById(id);
    let siblings = parent[this.childrenKey];

    siblings = siblings.filter(sbl => sbl !== id).map(sbl =>
      this._find({
        [this.idKey]: sbl,
      })
    );

    return siblings;
  }

  findOne(predicate) {
    return this._find(predicate)[0];
  }

  // add(member) {
  //   // TODO: Analyse member relationship
  //   this.members.push(member);
  // }

  // update(predicate) {
  //   this._predicate(predicate, true); // is greedy
  // }

  // remove(predicate) {
  //   this._predicate(predicate, true); // is greedy
  // }
}

module.exports = Family;
