 /*!
 * This file is part of PAD-Repository
 *
 * Please see the LICENSE file
 */

var 
    // ext modules  
    fs = require('fs')
  , sys = require('sys')
  , events = require('events')
  , async = require('async')
  , path = require('path')
  , chokidar = require('chokidar')
  , _ = require('underscore')
  , wrench = require('wrench')
    // pad modules  
  , Repository = require('./repository')
  , Package = require('./package')
  , io = require('./utils/io')
  , RepoStats = require('./repo-stats')
  ;

/**
 * Initialize a new HttpRepo with the `dir`.
 * and configure Express.js `app`
 *
 * @param {String} dir
 * @param {Object} app
 * @param {Object} serverHeadRoute
 */
var HttpRepo = module.exports = function(dir, app, serverHeadRoute) {
	var self = this;

	if(false === (self instanceof HttpRepo)) {
	  return new HttpRepo(dir);
	}

	Repository.call(self, dir);

	self.cacheFiles = {
		content: {},
		images: {}
	};

	// configure the routes
	if (serverHeadRoute !== undefined && "function" === typeof serverHeadRoute) {
		app.get('/metadata', serverHeadRoute);	
	}
  	
	app.get('/metadata/words', function(req, res) {
		res.charset = 'utf-8';
		res.writeHead(200, {'Content-Type': 'application/json'});
		res.end('{}');
	});

	self.emit('log', 'GET method /metadata/words added to app');

	app.get('/metadata/packages', function(req, res) {
		self.getPackages({}, function(err, data){
			res.charset = 'utf-8';
			res.writeHead(200, {'Content-Type': 'application/json'});
			res.end(JSON.stringify(data));
		});
	});

	self.emit('log', 'GET method /metadata/packages added to app');

	// the package

	//app.param('uid', /^[a-zA-Z0-9]+$/);
	
	app.get('/package/:uid', function(req, res) {
		
		var uid = req.params.uid;

		self.getContent(uid, 'metadata', function(err, data){
			res.charset = 'utf-8';
			res.writeHead(200, {'Content-Type': 'application/json'});
			res.end(JSON.stringify(data));
		});
		
	});

	self.emit('log', 'GET method /package/:uid added to app');

	app.get('/package/:uid/image/:img', function(req, res) {
		
		var uid = req.params.uid;
		var img = {
			name: req.params.img,
			size: req.query.size
		}

		var s = req.query.size !== undefined ? req.query.size : '';
		var hash = uid + req.params.img + s;

		if (self.cacheFiles.images[hash] !== undefined) {
			var data = self.cacheFiles.images[hash];
			send(data);
		} else {
			self.getContent(uid, 'image', img, function(err, data){
				send(data);
				self.cacheFiles.images[hash] = data;
			});
		}
		
		function send(data) {
			if (data.type === 'file') {
				res.sendfile(data.filename);
			}
		}

	});

	self.emit('log', 'GET method /package/:uid/image/:img added to app');

	app.get('/package/:uid/content', function(req, res) {
		
		var uid = req.params.uid;

		if (self.cacheFiles.content[uid] !== undefined) {
			var data = self.cacheFiles.content[uid];
			send(data);
		} else {
			self.getContent(uid, 'content', function(err, data){
				send(data);
				self.cacheFiles.content[uid] = data;
			});
		}
				
		function send(data) {
			if (data.type === 'file') {
				res.set('Content-Disposition', 'filename=' + path.basename(data.filename));
				res.sendfile(data.filename);
			}
		}

	});

	self.emit('log', 'GET method /metadata/package/:uid/content added to app');

	return self;
};

// inherits the Repository
sys.inherits(HttpRepo, Repository);

/**
 * Get packages with ops
 *
 * @param {Function} fn callbacks(data)
 */
Repository.prototype.getPackages = function(ops, fn) {
	var self = this;

	self.refresh(ops, function(err) {
		fn && fn(null, self.metadata.getPackges());
	});

	return self;
};

/**
 * Get packages with ops
 *
 * @param {Function} fn callbacks(data)
 */
Repository.prototype.getPackage = function(uid, fn) {
	var self = this;
	
	self.getContent(uid, 'metadata', function(err, data){
		fn && fn(null, data);
	});

};