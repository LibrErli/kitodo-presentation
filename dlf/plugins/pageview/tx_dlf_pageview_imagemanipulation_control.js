/***************************************************************
 *  Copyright notice
 *
 *  (c) 2011 Goobi. Digitalisieren im Verein e.V. <contact@goobi.org>
 *  All rights reserved
 *
 *  This script is part of the TYPO3 project. The TYPO3 project is
 *  free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  The GNU General Public License can be found at
 *  http://www.gnu.org/copyleft/gpl.html.
 *
 *  This script is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  This copyright notice MUST APPEAR in all copies of the script!
 ***************************************************************/

/**
 * Right know the image manipulation uses an own ol.Map object based on a webgl renderer. This is due to the fact
 * that other parts of the viewer application are using vector geometries and ol3 does only support full vector
 * renderering with the canvas and dom renderer yet. In contrast the image manipulation tool is only working
 * with a webgl renderer. Therefore it uses an own ol.Map object which is overlaid and synchronized with the
 * base ol.Map object.
 *
 * @constructor
 * @param {Object=} options Control options.
 * 		{Array.<ol.layer.Layer>} layers
 * 		{Element} target
 * 	  {ol.View} view
 * 	  {ol.Map} map
 */
dlfViewerImageManipulationControl = function(options) {

  /**
   * @type {Object}
   * @private
   */
  this.dic = $('#tx-dlf-tools-imagetools').length > 0 && $('#tx-dlf-tools-imagetools').attr('data-dic') ?
	    	dlfUtils.parseDataDic($('#tx-dlf-tools-imagetools')) :
	    		{'imagemanipulation-on':'Activate image manipulation', 'imagemanipulation-off':'Dectivate image manipulation',
		  		'saturation':'Saturation', 'hue':'Hue', 'brightness': 'Brightness', 'contrast':'Contrast', 'reset': 'Reset'};

  /**
	* @type {Array.<ol.layer.Layer>}
	* @private
	*/
  this.layers = options.layers;

	/**
	 * @type {ol.Map}
	 * @private
	 */
	this.baseMap_ = options.map;

	/**
	 * @type {string}
	 * @private
	 */
	this.manipulationMapId = 'tx-dfgviewer-map-manipulate';

	/**
	 * @type {ol.Map|undefined}
	 * @private
	 */
	this.map_;


	/**
	 * @type {ol.View}
	 * @private
	 */
	this.view_ = options.view;

  /**
   * @type {Element}
   * @private
   */
  this.anchor_ = $('<a/>', {
	  href: '#image-manipulation',
	  text: this.dic['imagemanipulation-on'],
	  title: this.dic['imagemanipulation-on']
  });
  $(options.controlTarget).append(this.anchor_);

  /**
   * @type {Element}
   * @private
   */
  this.toolContainerEl_ = dlfUtils.exists(options.toolContainer) ? options.toolContainer: $('.tx-dlf-toolbox')[0];

  //
  // Append open/close behavior to toolbox
  //
  var openToolbox = $.proxy(function(event) {
	  event.preventDefault();

	  if ($(event.target).hasClass('active')){
		  this.deactivate();
		  return;
	  }

	  this.activate();
  }, this);
  $(this.anchor_).on('click', openToolbox);
  $(this.anchor_).on('touchstart', openToolbox);

  //
  // Initialize the filter
  //
	/**
	 * @type {{brightness: number, contrast: number, hue: number, saturation: number}}
	 * @private
   */
	this.filtersDefault_ = {
		'brightness': 1,
		'contrast': 1,
		'hue': 0,
		'saturation': 0
	};

	/**
	 * @type {Object}
	 * @private
	 */
	this.filters_ = $.extend({}, this.filtersDefault_);

	/**
	 * Is filter updated
	 * @type {boolean}
	 * @private
	 */
	this.filterUpdated_ = false;

	/**
	 * @type {Object}
	 * @private
	 */
	this.handler_ = {
		'postcomposeImageFilter': $.proxy(function (event) {
			console.log('Postcompose triggered!');

			var webglContext = event['glContext'],
				canvas = $('#' + this.map_.getTargetElement().id + ' canvas.ol-unselectable')[0];

			if (webglContext !== undefined && webglContext !== null) {
				var gl = webglContext.getGL();

				if (this.filterUpdated_) {
					glif.reset();

					for (var filter in this.filters_) {
						glif.addFilter(filter, this.filters_[filter]);
					};

					this.filterUpdated_ = false;
				}

				glif.apply(gl, canvas);

				// for showing openlayers that the program changed
				// if missing openlayers will produce errors because it
				// expected other shaders in the webgl program
				webglContext.useProgram(undefined);
			}
		}, this),
		'resetFilter': $.proxy(function(event) {
			var layer = this.layers[0];

			var sliderEls = $('.slider.slider-imagemanipulation');
			for (var i = 0; i < sliderEls.length; i++) {
				var sliderEl = sliderEls[i],
					type = sliderEl.getAttribute('data-type'),
					value = this.filtersDefault_[type];

				$(sliderEl).slider('value', value);
			};
		}, this)
	}
};

/**
 * Activates the image manipulation tool
 */
dlfViewerImageManipulationControl.prototype.activate = function(){

	//
	// Toggle Maps and control elements
	//
	$.when($(this.baseMap_.getTargetElement())
		// fadeOut the base map container
		.hide())
		// fadeIn image map container
		.done($.proxy(function(){
			//
			// Initialize map if not exists
			//
			if (!dlfUtils.exists(this.map_)) {
				// create map container and map object
				var mapEl_ = $('<div id="tx-dfgviewer-map-manipulate" class="tx-dlf-map"></div>');
				$(this.baseMap_.getTargetElement().parentElement).append(mapEl_);

				this.map_ = new ol.Map({
					layers: this.layers,
					target: mapEl_[0].id,
					controls: [],
					interactions: [
						new ol.interaction.DragPan(),
						new ol.interaction.MouseWheelZoom(),
						new ol.interaction.KeyboardPan(),
						new ol.interaction.KeyboardZoom
					],
					// necessary for proper working of the keyboard events
					keyboardEventTarget: document,
					view: this.view_,
					renderer: 'webgl'
				});

				// couple map behavior with baseMap
				var adjustViews = function(sourceView, destMap) {
						var rotateDiff = sourceView.getRotation() !== destMap.getView().getRotation();
						var resDiff = sourceView.getResolution() !== destMap.getView().getResolution();
						var centerDiff = sourceView.getCenter() !== destMap.getView().getCenter();

						if (rotateDiff || resDiff || centerDiff)
							destMap.zoomTo(sourceView.getCenter(),
								sourceView.getZoom(), 50);
					},
					adjustViewHandler = function(event) {
						adjustViews(event.target, this);
					};

				// when deactivate / activate adjust both map centers / zoom
				$(this).on("activate-imagemanipulation", $.proxy(function(event, map) {
					// pass change events for resolution and rotation to image manipulation map
					// created through external view controls
					this.baseMap_.getView().on('change:resolution', adjustViewHandler, this.map_);
					this.baseMap_.getView().on('change:rotation', adjustViewHandler, this.map_);

					// adjust the view of both maps
					adjustViews(this.baseMap_.getView(), this.map_);
				}, this));
				$(this).on("deactivate-imagemanipulation", $.proxy(function(event, map) {
					// pass change events for resolution and rotation to image manipulation map
					// created through external view controls
					this.baseMap_.getView().un('change:resolution', adjustViewHandler, this.map_);
					this.baseMap_.getView().un('change:rotation', adjustViewHandler, this.map_);

					// adjust the view of both maps
					adjustViews(this.map_.getView(), this.baseMap_);
				}, this));
			}

			// Show map
			$(this.map_.getTargetElement()).show();

			// trigger open event
			$(this).trigger("activate-imagemanipulation", this.map_);
		}, this));

	// add activate class to control element
	$(this.anchor_).addClass('active')
		.text(this.dic['imagemanipulation-off'])
		.attr('title', this.dic['imagemanipulation-off']);

	if (dlfUtils.exists(this.sliderContainer_)) {
		$(this.sliderContainer_).show().addClass('open');
	} else {

		//
		// Initialize filters
		//

		// create outer container
		var outerContainer = $('<div class="image-manipulation ol-unselectable"></div>');
		$(this.toolContainerEl_).append(outerContainer);

		/**
		 * Inner slider container
		 * @type {Element}
		 * @private
 		 */
		this.sliderContainer_ = $('<div class="slider-container"></div>');
		$(outerContainer).append(this.sliderContainer_);

		//
		// Create slider for filters
		//
		var contrastSlider = this.createSlider_('slider-contrast', 'horizontal', 'contrast',
			[1, 0, 2, 0.01], this.dic['contrast']),
			saturationSlider = this.createSlider_('slider-saturation', 'horizontal', 'saturation',
				[0, -1, 1, 0.01], this.dic['saturation']),
			brightnessSlider = this.createSlider_('slider-brightness', 'horizontal', 'brightness',
				[1, 0, 2, 0.1], this.dic['brightness']),
			hueSlider = this.createSlider_('slider-hue', 'horizontal', 'hue',
				[0, -180, 180, 5], this.dic['hue']);
		$(this.sliderContainer_).append(contrastSlider);
		$(this.sliderContainer_).append(saturationSlider);
		$(this.sliderContainer_).append(brightnessSlider);
		$(this.sliderContainer_).append(hueSlider);

		// button for reset to default state
		var resetBtn = $('<button class="reset-btn" title="' + this.dic['reset'] + '">' + this.dic['reset'] + '</button>');
		$(this.sliderContainer_).append(resetBtn);
		$(resetBtn).on('click', this.handler_.resetFilter);

		// fade in
		$(this.sliderContainer_).show().addClass('open');
	}

	// add postcompose listener to layers
	for (var i = 0; i < this.layers.length; i++) {
		this.layers[i].on('postcompose', this.handler_.postcomposeImageFilter);
	}
};

/**
 * @param {string} className
 * @param {string} orientation
 * @param {string} key
 * @param {Array.<number>|undefined} opt_baseValue
 * @param {string=} opt_title
 * @return {Element}
 * @private
 */
dlfViewerImageManipulationControl.prototype.createSlider_ = function(className, orientation, key, opt_baseValues, opt_title){
	var title = dlfUtils.exists('opt_title') ? opt_title : '',
		sliderEl = $('<div class="slider slider-imagemanipulation ' + className + '" title="' + title + '" data-type="' +
			key +'"></div>'),
		baseMin = dlfUtils.exists(opt_baseValues) ? opt_baseValues[1] : 0,
		baseMax = dlfUtils.exists(opt_baseValues) ? opt_baseValues[2] : 100,
		steps = dlfUtils.exists(opt_baseValues) ? opt_baseValues[3] : 1,
		minValueEl,
		maxValueEl,
		startValue = dlfUtils.exists(opt_baseValues) ? opt_baseValues[0] : 100;

	/**
	 * @param {Object} event
	 * @param {Object} ui
	 */
	var update = $.proxy(function(event, ui){
		var value = ui['value'],
				layer = this.layers[0],
				element = valueEl[0];

		if (orientation == 'vertical') {
			var style_top = 100 - ((value - baseMin) / (baseMax - baseMin) * 100);
			element.style.top = style_top + '%';
			element.innerHTML = value + '%';
			return;
		}

		var style_left = (value - baseMin) / (baseMax - baseMin) * 100;
		element.style.left = style_left + '%';
		element.innerHTML = value + '%';

		// update filters.
		this.filters_[key] = value;
		this.filterUpdated_ = true;
		layer.changed();
	}, this);

	$(sliderEl).slider({
        'min': baseMin,
        'max': baseMax,
        'value': startValue,
        'animate': 'slow',
        'orientation': orientation,
        'step': steps,
        'slide': update,
        'change': update
    });

	// append tooltips
	var innerHtml = dlfUtils.exists(opt_baseValues) ? opt_baseValues[0] + '%' : '100%',
			valueEl = $('<div class="tooltip value ' + className + '">' + innerHtml + '</div>');
	$(sliderEl).append(valueEl);

	return sliderEl;
};

/**
 * Deactivates the image manipulation control
 */
dlfViewerImageManipulationControl.prototype.deactivate = function(){

	// toggle maps
	if (dlfUtils.exists(this.map_))
		$(this.map_.getTargetElement()).hide();
	$(this.baseMap_.getTargetElement()).show();

	// toggle view of image manipulation control element
	$(this.anchor_).removeClass('active')
		.text(this.dic['imagemanipulation-on'])
		.attr('title', this.dic['imagemanipulation-on']);

	$(this.sliderContainer_).hide().removeClass('open');

	// remove postcompose listener to map
	for (var i = 0; i < this.layers.length; i++) {
		this.layers[i].un('postcompose', this.handler_.postcomposeImageFilter);
	};

	// trigger close event for trigger map adjust behavior
	$(this).trigger("deactivate-imagemanipulation");
};

/**
 * @param {Element} parentEl
 * @private
 */
dlfViewerImageManipulationControl.prototype.initializeSliderContainer_ = function(parentEl){

	// create outer container
	var outerContainer = $('<div class="image-manipulation ol-unselectable"></div>');
	$(parentEl).append(outerContainer);

	// create inner slider container
	var sliderContainer = $('<div class="slider-container" style="display:none;"></div>');
	$(outerContainer).append(sliderContainer);



	// add contrast slider
	var contrastSlider = this.createSlider_('slider-contrast', 'horizontal', $.proxy(function(value){
		for (var i = 0; i < this.layers.length; i++) {
			this.layers[i].setContrast(value/100);
		}
	}, this), undefined, this.dic['contrast']);
	$(sliderContainer).append(contrastSlider);

	// add satuartion slider
	var satSlider = this.createSlider_('slider-saturation', 'horizontal', $.proxy(function(value){
		for (var i = 0; i < this.layers.length; i++) {
			this.layers[i].setSaturation(value/100);
		}
	}, this), undefined, this.dic['saturation']);
	$(sliderContainer).append(satSlider);

	// add brightness slider
	var brightSlider = this.createSlider_('slider-brightness', 'horizontal', $.proxy(function(value){
		var linarMapping = 2 * value / 100 -1;
		for (var i = 0; i < this.layers.length; i++) {
			this.layers[i].setBrightness(linarMapping);
		}
	}, this), 50, this.dic['brightness']);
	$(sliderContainer).append(brightSlider);

	// add hue slider
	var hueSlider = this.createSlider_('slider-hue', 'horizontal', $.proxy(function(value){
		var mapping = (value - 50) * 0.25,
			hueValue = mapping == 0 ? 0 : mapping + this.layers[0].getHue();
		for (var i = 0; i < this.layers.length; i++) {
			this.layers[i].setHue(hueValue);
		}
	}, this), 50, this.dic['hue']);
	$(sliderContainer).append(hueSlider);

	// button for reset to default state
	var resetBtn = $('<button class="reset-btn" title="' + this.dic['reset'] + '">' + this.dic['reset'] + '</button>');
	$(sliderContainer).append(resetBtn);

	var defaultValues = {
		hue: 0,
		brightness:0,
		contrast: 1,
		saturation: 1
	};

	//$(resetBtn).on('click', $.proxy(function(e){
	//	var layer = this.layers[0];
    //
	//	// remove postcomposeHandler
	//	layer.un('postcompose', postcomposeHandler);
	//	postcomposeRegistered = false;
    //
	//	// reset the sliders
	//	var sliderEls = goog.dom.getElementsByClass('slider', sliderContainer);
	//	for (var i = 0; i < sliderEls.length; i++) {
	//		var sliderEl = sliderEls[i],
	//			type = sliderEl.getAttribute('data-type'),
	//			value = vk2.control.ImageManipulation.Filters[type];
    //
	//		$(sliderEl).slider('value', value);
	//	};
	//
	//	// reset the layer
	//	for (var i = 0; i < this.layers.length; i++) {
	//		this.layers[i].setContrast(defaultValues.contrast);
	//		this.layers[i].setHue(defaultValues.hue);
	//		this.layers[i].setBrightness(defaultValues.brightness);
	//		this.layers[i].setSaturation(defaultValues.saturation);
	//	}
    //
	//	// reset the sliders
	//	var sliderEls = $('.slider-imagemanipulation');
	//	for (var i = 0; i < sliderEls.length; i++){
	//		var sliderEl = sliderEls[i];
	//		var resetValue = $(sliderEl).hasClass('slider-hue') || $(sliderEl).hasClass('slider-brightness') ? 50 : 100;
	//		$(sliderEl).slider('value', resetValue);
	//	}
	//}, this));

	return sliderContainer;
};
