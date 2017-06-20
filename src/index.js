'use strict';

// Built-in

// Third-party
// const _ = require('lodash');
const Parser = require('sketch-parser');
const Family = require('./family');

/**
 * Sketch file Marker Class
 *
 * @class Marker
 * @extends {Parser}
 */
class Marker extends Parser {
  /**
   * Creates an instance of Marker.
   *
   * @param {string} sketchFile - SketchApp's absolute file path
   * @param {boolean} needSketchTool - whether need sketchtool or not.
   * @constructor
   * @memberof Marker
   */
  constructor(sketchFile, needSketchTool) {
    super(sketchFile, needSketchTool);

    // layer: expConfig.layer,
    // artboard: artboardType,
    // saveSource: expConfig.saveSource,
    // scale2x: expConfig.scale2x

    this.artboardZIndex = 0;
    this.sketchData = {
      // 是否导出每个子图层
      exportEveryLayer: false,
      // sketch文件名
      sketchName: '',
      // 页面id（为了保证页面显示顺序）
      pageOrder: [],
      // 页面数据
      pageData: {
        /*
        pageId: {
        id: '',
        name: '',
        // ...
        artboardId: []
        },
        // 画板内的所有蒙版
        mask: {
          maskLayerId: [maskChildLayerId]
        }
      }*/
      },
      // 画板数据
      artboard: {},
    };

    this.allArtboards = [];
    this.allLayers = [];
    this.family = null;

    // 保存被合并小图输出的图层父节点id
    this.groupExportLayers = [];

    // 当前蒙版图层id
    this.currentMaskLayerId = null;
    // 当前蒙版父图层id（用于向上遍历判断图层是否在蒙版内部）
    this.currentMaskParentLayerId = null;
    // 当前处理的画板zindex
    this.artboardZIndex = 0;
  }

  export() {}

  _fixFilledColor(fills) {
    const enabledFills = fills.filter(fill => fill.isEnabled);
    const isAllNormal = enabledFills.every(
      fill => !fill.contextSettings.blendMode
    );

    if (!isAllNormal) return false;

    return fills[0].color.value;
  }

  *getSharedStyleById(id, type) {
    let sharedStyleObjects = null;
    const docData = yield this.getDocumentData();

    if (type === 'text') {
      sharedStyleObjects = docData.layerTextStyles.objects;
    }

    if (type === 'shape') {
      sharedStyleObjects = docData.layerStyles.objects;
    }

    for (const sharedStyle of sharedStyleObjects) {
      if (sharedStyle.objectID === id) {
        return sharedStyle;
      }
    }

    return null;
  }

  *getArtboardDataList() {
    const pages = yield this.getPageDataList();

    // 画板下的图层迭代器
    if (!this.allLayers || !this.allLayers.length) {
      this.allLayers = yield this.getFlatLayerList(false);
      this.family = new Family(this.allLayers, {
        idKey: 'objectID',
        childrenKey: 'layers',
      });
    }

    pages.forEach(page => {
      const pageName = page.name;
      const ignoreNameRet = !/^-{1}[^-]*?.*$/.test(pageName);

      page.layers.forEach(layer => {
        // loop artboards
        if (
          layer['<class>'] === 'MSSymbolMaster' ||
          ignoreNameRet &&
            layer['<class>'] === 'MSArtboardGroup' &&
            !/^-{1}[^-]*?.*$/.test(layer.name)
        ) {
          this.allArtboards.push(
            Object.assign({}, layer, {
              parentPageID: page.objectID,
              parentPageName: page.name,
            })
          );
        }
      });
    });

    // 画板不存在
    if (this.allArtboards.length === 0) {
      return false;
    }

    // 处理画板
    yield this.handleArtboardData();

    return this.sketchData;
  }

  *handleArtboardData() {
    // sketch data
    const sketchData = this.sketchData;

    this.allArtboards.forEach(art => {
      const { objectID: artboardId, parentPageID, parentPageName } = art;

      if (!sketchData.pageData[parentPageID]) {
        // 不管用户如何选择都要导出页面数据
        sketchData.pageData[parentPageID] = {
          // 页面唯一id
          pageId: parentPageID,
          // 页面名
          name: parentPageName,
          // 页面下画板id列表（保证显示的顺序）
          artboardId: [],
        };
        // 保存画板顺序
        sketchData.pageOrder.push(parentPageID);
      }

      // 保存画板id
      sketchData.pageData[parentPageID].artboardId.push(artboardId);

      // 处理画板&&图层数据
      sketchData.artboard[artboardId] = this.getArtboardData({
        artboardId,
        artboardPath: './',
      });
    });
  }

  *getArtboardData(data) {
    const artboardId = data.artboardId;
    const artboard = this.family.findOne({ objectID: artboardId });
    const posterityLayers = this.family.findPosteritiesById(artboardId);

    // 获取画板数据
    const artboardData = this.getLayerData(artboard, {
      type: 'artboard',
      zIndex: this.artboardZIndex,
    });
    // 导出选项
    const exportConfig = {
      // 导出文件名（不包含扩展名）
      name: '',
      // 导出路径
      path: data.artboardPath,
    };

    // 画板下的切片
    artboardData.slice = [];
    // 画板下的图层
    artboardData.layer = [];
    // 画板下的蒙版
    artboardData.mask = {};

    // 所有后代图层
    posterityLayers.forEach(layer => {
      const layerId = layer.objectID;
      // 图层父节点id
      const artboardId = artboard.objectID;
      // const layerName = layer.name;
      const layerType = layer['<class>'];

      let layerData = [];
      const layerStates = this.isLayerEnable(layer);

      exportConfig.name = layerId;

      // 图层不可见
      if (!layerStates.isVisible) {
        return false;
      }
      // 图层所在的组已经被作为图片导出过了
      if (layerStates.hasExportByGroup) {
        return false;
      }

      if (layerStates.isMaskChildLayer && this.currentMaskLayerId) {
        artboardData.mask[this.currentMaskLayerId].push(layerId);
      } else {
        // 清空当前mask标记
        this.currentMaskLayerId = null;
        this.currentMaskParentLayerId = null;
      }

      /*
       * children方法会扁平化画板下的所有图层（没有层级关系）
       * 如果某个图层为蒙版图层，则同一个文件夹内，其后出现的图层全部为该蒙版内的子图层
       * 遍历到下一个图层后，需要逐级判断父图层是否与最近一次出现的蒙版图层（如有）有共同的“祖先”
       * 存在共同的祖先，在导出图层为图片时始终只导出当前图层与蒙版图层的交集部分。
       * 不存在共同的祖先时，则认为最近一次出现的蒙版作用范围失效，并清空最近一次出现的蒙版图层对象。
       */
      // 某个图层为蒙版时，记录当前蒙版信息
      if (layer.hasClippingMask) {
        // 保存当前蒙版图层信息
        this.currentMaskLayerId = layerId;
        this.currentMaskParentLayerId = artboardId;
        // 保存画板内蒙版数据
        artboardData.mask[layerId] = [];
      }

      // 小于64*64并且当前图层父节点区域内不包含文字图层时作为图片导出
      if (this.groupExportEnable(layer)) {
        const parentLayer = this.family.findParentById(layerId);
        this.groupExportLayers.push(artboardId);
        // 保存图层数据
        layerData = this.getLayerData(parentLayer, {
          type: 'bitmap',
          zIndex: this.artboardZIndex,
        });
        artboardData.layer.push(layerData);

        // 导出父图层 *************
        exportConfig.name = parentLayer.objectID;
        // this.exportLayerAsImage(parentLayer, exportConfig);
      } else {
        switch (layerType) {
          case 'MSTextLayer':
            // 保存文字图层数据
            layerData = this.getLayerData(layer, {
              type: 'text',
              zIndex: this.artboardZIndex,
            });
            layerData && artboardData.layer.push(layerData);
            break;

          case 'MSSliceLayer':
            // 保存切片图层数据
            layerData = this.getLayerData(layer, {
              type: 'slice',
              zIndex: this.artboardZIndex,
            });
            layerData && artboardData.slice.push(layerData);
            // 导出切片

            // this.exportLayerAsImage(layer, {
            //   name: layerName,
            //   path: data.artboardPath + '/slice',
            // });
            break;

          case 'MSBitmapLayer':
            // 保存位图数据
            layerData = this.getLayerData(layer, {
              type: 'bitmap',
              zIndex: this.artboardZIndex,
            });
            layerData && artboardData.layer.push(layerData);
            // 导出位图
            // this.exportLayerAsImage(layer, exportConfig);
            break;

          case 'MSShapeGroup':
            // 保存形状数据
            layerData = this.getLayerData(layer, {
              type: 'shape',
              zIndex: this.artboardZIndex,
            });
            layerData && artboardData.layer.push(layerData);
            // 导出形状组图片
            // this.exportLayerAsImage(layer, exportConfig);
            break;

          case 'MSSymbolInstance':
            // 保存Symbol图层数据
            layerData = this.getLayerData(layer, {
              type: 'symbol',
              zIndex: this.artboardZIndex,
            });
            layerData && artboardData.layer.push(layerData);
            // 导出切片
            // this.exportLayerAsImage(layer, exportConfig);
            break;
        }
      }

      // 递增zindex
      this.artboardZIndex++;
    });
    return artboardData;
  }

  toString(str, config) {
    if (config && config.escapeLine) {
      str = str.replace(/\\-/g, '-');
    }

    if (config && config.encode) {
      str = encodeURIComponent(str);
    }

    return str;
  }

  /**
   * 获取图层数据
   * @param layer 目标图层
   * @param config.type 图层类型
   * @param config.zIndex
   * @return object
   */
  getLayerData(layer, config) {
    // 图层在画板中的位置、尺寸：frameInArtboard
    // Sketch 41 Fix: frameInArtboard() = > frame()
    const layerFrame = layer.frame;
    const layerId = layer.objectID;
    const nameConfig = config.type === 'artboard'
      ? { encode: true, escapeLine: true }
      : { encode: true };

    // 图层基本信息
    const layerData = {
      id: layerId,
      // 图层路径默认与图层id一致
      src: layerId,
      name: this.toString(layer.name, nameConfig),
      type: layer['<class>'],
      x: Math.ceil(layerFrame.x),
      y: Math.ceil(layerFrame.y),
      zIndex: config.zIndex,
      width: Math.ceil(layerFrame.width),
      height: Math.ceil(layerFrame.height),
      sharedStyleType: '',
      sharedStyle: '',
    };

    // 修正边框对图形、位图的位置影响
    if (config.type === 'shape' || config.type === 'bitmap') {
      const border = layer.style.borders[0];
      let borderWidth = null;

      if (border && border.isEnabled) {
        borderWidth = border.thickness;
        layerData.borderWidth = borderWidth;
        // 边框位置为center
        if (border.position === 0) {
          // 补偿坐标
          layerData.x = layerData.x - parseInt(borderWidth / 2, 10);
          layerData.y = layerData.y - parseInt(borderWidth / 2, 10);
          // 补偿尺寸
          layerData.width = layerData.width - borderWidth;
          layerData.height = layerData.height - borderWidth;
        }
        // 边框位置为Inside
        if (border.position === 1) {
          // 补偿尺寸
          layerData.width = layerData.width - borderWidth * 2;
          layerData.height = layerData.height - borderWidth * 2;
        }
        // 边框位置为Outside
        if (border.position === 2) {
          // 补偿坐标
          layerData.x = layerData.x - parseInt(borderWidth, 10);
          layerData.y = layerData.y - parseInt(borderWidth, 10);
        }
      }
    }
    // 对于画板、slice、位图只需要返回基本数据
    if (
      config.type === 'artboard' ||
      config.type === 'slice' ||
      config.type === 'bitmap' ||
      config.type === 'symbol'
    ) {
      if (config.type === 'artboard' && layer['<class>'] === 'MSSymbolMaster') {
        // 画板为Symbol时设置SymbolId
        layerData.symbolId = layer.symbolID;
      }

      if (config.type === 'symbol') {
        layerData.symbolId = layer.symbolID;
      }

      return layerData;
    }

    // Text layer
    if (config.type === 'text') {
      const textAlign = this.getTextAlign(layer);
      const fontStyle = layer.style;
      const sharedObjectId = layer.style.sharedObjectID;

      // 文字内容
      layerData.html = this.toString(layer.attributedString.value.text, {
        encode: true,
      });
      // TODO：要处理 CSSAttributes API 的兼容！！！
      // layerData.style = this.filterSketchCss(layer.CSSAttributes());
      layerData.style = {};

      // 修正文字图层设置填充后颜色不正确的问题
      const fixColorRet = this._fixFilledColor(fontStyle.fills);
      if (fixColorRet) {
        layerData.style.color = fixColorRet;
      }

      /**
       * 修正单行文字图层高度
       * 行高未设置，并且高度与字号相差2px以上时候重新设置高度
       *
       */
      // if (
      //   !/[\r\n]/gi.test(layer.attributedString.value.text) &&
      //   layerData.style['line-height'] === undefined
      // ) {
      //   const fontSize = parseInt(layerData.style['font-size'], 10);
      //   if (layerData.height - fontSize > 2) {
      //     layerData.height = fontSize + 2;
      //   }
      // }

      if (textAlign) {
        layerData.style['text-align'] = textAlign;
      }

      if (sharedObjectId) {
        const sharedStyle = this.getSharedStyleById(sharedObjectId, 'text');
        if (sharedStyle) {
          layerData.sharedStyleType = 'TEXTSHAREDSTYLE';
          layerData.sharedStyle = sharedStyle.name;
        }
      }
      return layerData;
    }

    // Shape group layer
    if (config.type === 'shape' && layer.layers.length) {
      const shapeClassName = layer.layers[0]['<class>'];
      const sharedObjectId = layer.style.sharedObjectID;
      // layerData.style = this.filterSketchCss(layer.CSSAttributes()); // FIXME: Add `filterSketchCss` & `CSSAttributes`
      layerData.style = {};
      layerData.style.width = layerData.width + 'px';
      layerData.style.height = layerData.height + 'px';

      // 从css中复制一份圆角（给设计师看）
      if (layerData.style['border-radius']) {
        layerData.radius = layerData.style['border-radius'];
        if (layerData.radius.split('px').length > 2) {
          layerData.radius = layerData.radius.replace(/px\s?/gi, '/');
        } else {
          layerData.radius = layerData.radius.replace('px', '');
        }
      }

      // 从css中复制一份背景色（给设计师看）
      if (layerData.style['background']) {
        layerData.background = layerData.style['background'];
      }

      // 正圆形（长宽误差2px以内）补充borderRadius属性
      if (
        shapeClassName === 'MSOvalShape' &&
        Math.abs(layerData.width - layerData.height) <= 2
      ) {
        layerData.style['border-radius'] = '100%';
      }

      if (sharedObjectId) {
        const sharedStyle = this.getSharedStyleById(sharedObjectId, 'shape');
        if (sharedStyle) {
          layerData.sharedStyleType = 'SHAPESHAREDSTYLE';
          layerData.sharedStyle = sharedStyle.name;
        }
      }
      return layerData;
    }

    return null;
  }

  /**
   * 图层是否可用，以下类型的图层不可用:
   * 1. 非可见图层、基本图形的子图形（比如：MSRectangleShape、MSShapePathLayer）
   * 2. 图片所在的图层组已经作为图片导出过了（64*64以内的图层组会被按组导出）
   */
  isLayerEnable(layer) {
    // 图层是否可见
    let isVisible = true;
    // 图层是否已经被按组导出了
    let hasExportByGroup = false;
    // 是否是蒙版子节点
    let isMaskChildLayer = false;

    // 图层类名
    const layerClass = layer['<class>'].toLowerCase();

    // 图形类名包括shape，但是不包括group关键字时表示这是一个基本图形，应该导出的是父图层
    if (
      layerClass.indexOf('shape') > -1 && layerClass.indexOf('group') === -1
    ) {
      // 假装不可见，以便忽略
      isVisible = false;
      // return false;
    }

    // 图层为文件夹或者画板时不用导出
    if (layerClass === 'mslayergroup' || layerClass === 'msartboardgroup') {
      // 假装不可见，以便忽略
      isVisible = false;
      // return false;
    }

    // 向上遍历
    while (
      layer['<class>'] !== 'MSArtboardGroup' &&
      layer['<class>'] !== 'MSSymbolMaster'
    ) {
      const theLayerId = layer.objectID;
      // parenggroup不可见
      if (!layer.isVisible) {
        isVisible = false;
      }
      // 图层所在的父节点已经被导出为图片了
      if (this.groupExportLayers.indexOf(theLayerId) !== -1) {
        hasExportByGroup = true;
      }
      // 判断图层蒙版
      if (theLayerId === this.currentMaskParentLayerId) {
        isMaskChildLayer = true;
      }

      layer = this.family.findParentById(theLayerId);
    }

    return {
      isVisible: isVisible,
      hasExportByGroup: hasExportByGroup,
      isMaskChildLayer: isMaskChildLayer,
    };
  }

  getTextAlign(layer) {
    // "alignment" : 0 left
    // "alignment" : 1 right
    // "alignment" : 2 center
    // "alignment" : 3 justify
    // "alignment" : 4 default
    const align = ['left', 'right', 'center', 'justify'];
    const alignment = layer.style.textStyle.NSParagraphStyle.alignment; // TODO: Add try-catch
    return align[alignment] || null;
  }

  // filterSketchCss(cssAttrs) {
  //   const style = {};
  //   for (let i = 0, len = cssAttrs.count(); i < len; i++) {
  //     const cssAttr = cssAttrs[0];
  //     if (!cssAttr.match(/\/\*[^\*]*?\*\/$/g)) {
  //       cssAttr = cssAttr.split(':');
  //       var attrKey = util.trim(cssAttr[0]);
  //       var attrValue = util.trim(cssAttr[1].replace(';', ''));
  //       // 过滤掉无效的边框参数
  //       if (attrKey === 'border' && /^0px/i.test(attrValue)) {
  //         continue;
  //       }
  //       // 除了字体外，都转换为小写
  //       if (attrKey != 'font-family') {
  //         attrValue = attrValue.toLowerCase();
  //       }
  //       style[attrKey] = attrValue;
  //     }
  //   }
  //   return style;
  // }

  /*
   * 判断图层是否可按组导出
   * 64*64以内，并且不包含文字图层的图层可以按组导出
   */
  groupExportEnable(layer) {
    const frame = layer.frame;
    const parentLayer = this.family.findParentById(layer.objectID);
    const posterities = this.family.findPosteritiesById(parentLayer.objectID);

    // 当前图层组
    const textLayers = posterities.filter(
      posterity => posterity['<class>'] === 'MSTextLayer'
    );

    // 图层尺寸小于64*64 并且不包含文字图层，
    if (
      frame.width <= 64 &&
      frame.height <= 64 &&
      !textLayers.length &&
      parentLayer['<class>'] !== 'MSArtboardGroup'
    ) {
      return true;
    }

    return false;
  }

  /*
   * 导出图层为图片
   * layer 需要导出的图层
   * options.name 导出文件名
   * options.path 导出路径
   */
  // exportLayerAsImage() {
  //   var slice;
  //   var sliceRect = null;

  //   /**
  //    * absoluteInfluenceRect 虽然返回值数据类型为CGRect
  //    * 但是某些情况下得到的坐标尺寸与实际有1px的误差
  //    */
  //   var absoluteRect = layer.absoluteRect();
  //   //导出名
  //   var exportName = options.path +'/'+ options.name;

  //   sliceRect = NSMakeRect(absoluteRect.x(), absoluteRect.y(), absoluteRect.width(), absoluteRect.height());
  //   slice = [[MSExportRequest exportRequestsFromExportableLayer:layer] firstObject];
  //   //忘记为什么要copyLightweight
  //   slice.page = doc.currentPage();//.copyLightweight();
  //   slice.format = 'png';

  //   if(options.name == 'artboard'){
  //     //画板按2x导出
  //     slice.scale = this.expConfig.scale2x ? 2 : 1;
  //     [doc ske:slice toFile:exportName +'.png'];
  //   }else{
  //     // 0.5x
  //     slice.scale = 0.5;
  //     [doc saveArtboardOrSlice:slice toFile:exportName +'@0.5x.png'];

  //     // 1x
  //     slice.scale = 1;
  //     [doc saveArtboardOrSlice:slice toFile:exportName +'@1x.png'];

  //     // 2x
  //     slice.scale = 2;
  //     [doc saveArtboardOrSlice:slice toFile:exportName +'@2x.png'];

  //     // 3x
  //     slice.scale = 3;
  //     [doc saveArtboardOrSlice:slice toFile:exportName +'@3x.png'];

  //     if(/^svg/i.test(layer.name())){
  //         slice = [[MSExportRequest exportRequestsFromExportableLayer:layer] firstObject];
  //         slice.format = 'svg';
  //         // 图层名以“svg”开头时，作为svg导出
  //         [doc saveArtboardOrSlice:slice toFile:exportName +'.svg'];
  //     }
  //   }
  // }
}

module.exports = Marker;
