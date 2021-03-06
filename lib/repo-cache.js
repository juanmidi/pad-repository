/*!
 * This file is part of PAD-Repository
 *
 * Please see the LICENSE file
 */

var fs = require('fs')
	, sys = require('sys')
	, events = require('events')
	, io = require('../lib/utils/io')
	, path = require('path')
	, stream = require('stream')
	, Package = require('./package')
	, _ = require('underscore')
	, im = require('./imagemagick')
	, XRegExp = require('xregexp').XRegExp
	, exec = require('child_process').exec
	, mkdirp = require('mkdirp')
	, wrench = require('wrench')
	;

/**
 * Initialize a new RepoCache for `repo`.
 *
 * @param {Object} repo
 */
var RepoCache = module.exports = function(repo) {
	var self = this;

	if(false === (self instanceof RepoCache)) {
		return new RepoCache(repo);
	}

	self.repository = repo;

	if (self.repository !== undefined) {
		self.repository.on('add', addHandler);
	}

	return self;

	function addHandler(pkg) {
		cachePackage({
			path: self.repository.path,
			withForce: true,
			silince: true
		}, pkg);
	}

};

/**
 * Initialize a repository with `ops`
 *
 * @param {Object} ops
 * @param {Function} fn callbacks
 */
RepoCache.prototype.create = function(fn) {
	var self = this;

	if (self.repository === undefined) {
		return fn && fn(new Error('The repository can not be undefined'));
	}

	var repoPath = self.repository.path;

	io.mkdir(path.join(repoPath, '/.cache'), fn);

	return self;
};

/**
 * Get package
 *
 * @param {String} uid
 * @param {Function} fn
 */
RepoCache.prototype.getPackage = function(uid, fn) {
	var self = this;

	var repoPath = self.repository.path;

	// find if the package is cached
	var pdir = path.join(repoPath, '/.cache', uid);
	var jfname = path.join(pdir, 'package.json');

	if (fs.existsSync(jfname)) {
		io.readUtf8(jfname, function(err, data){
			fn && fn(null, JSON.parse(data));
		});
		return self;
	}

	// if not exists cached the package
	// refresh the repository
	// to get the filename
	self.repository.refresh(function(err) {
		var mt = self.repository.metadata.getInfo(uid);
		
		if (mt === undefined) {
			fn & fn(new Error('The package ' + uid + ' no found'))
			return self;
		}

		if (!fs.existsSync(pdir)) {
			var filename = path.join(self.repository.config.dataPath, mt.filename);
			var pkg = new Package(filename);

			pkg.load(function(err, p){
				if (err) {
					fn & fn(err)
				};

				cachePackage({path: self.repository.path}, p, function(err, p){
					io.readUtf8(jfname, function(err, data){
						fn && fn(null, JSON.parse(data));
					});
				});

			});

			return self;
		}

		io.readUtf8(jfname, function(err, data){
			if (err) {
				fn & fn(err)
			};

			fn && fn(null, JSON.parse(data));
		});

	});

	return self;
};


/**
 * Get package content
 *
 * Pre-condition: The function asume that the package was cached before
 *
 * @param {String} uid
 * @param {String} type
 * @param {String} name
 * @param {Function} fn
 */
RepoCache.prototype.resolve = function(uid, type, ops, fn) {
	var self = this;
	var cpath = self.repository.config.cachePath
	  , dpath = self.repository.config.dataPath
	  , name = "string" === typeof ops ? ops : ops.name;

	self.getPackage(uid, function(err, metadata) {
		if (err)  {
			fn & fn(err)
		};
		
		// if is only the metadata
		if (type === 'metadata') {
			fn && fn(null, metadata);
			return self;
		}

		var zipfile = path.join(dpath, self.repository.metadata.getFilename(uid));
		var pkg = new Package(zipfile);

		if (type === 'image') {
			return self._resolveImage(metadata, pkg, type, ops, fn);
		}

		if (type === 'content') {
			return self._resolveContent(metadata, pkg, type, ops, fn);
		}

	});

	return self;
};

/**
 * Get package content
 *
 * Pre-condition: The function asume that the package was cached before
 *
 * @param {Object} pkg
 * @param {String} type
 * @param {String} name
 * @param {Function} fn
 */
RepoCache.prototype._resolveImage = function(metadata, pkg, type, ops, fn) {
	var self = this;

	var cpath = self.repository.config.cachePath
	  , dpath = self.repository.config.dataPath
	  , name = "string" === typeof ops ? ops : ops.name
	  , size = ops.size;

	var image = _.first(
		metadata.content.images.filter(function(img){
			return img.type == name;
		})
	);

	if (image === undefined) {
		fn && fn(new Error('No content found'));
		return self;
	}

	var imgPath = path.join(cpath, metadata.uid, image.src);

	if (true === self.isCached(image.src, metadata.uid)) {
		return self._resolveImageResized(imgPath, size, fn);
	}

	// if not exist cache the image
	pkg.extract(image.src, path.join(cpath, metadata.uid), function(err) {
		self._resolveImageResized(imgPath, size, fn);
	});

	return self;
};

/**
 * Get package content
 *
 * Pre-condition: The function asume that the package was cached before
 *
 * @param {String} src
 * @param {String} size
 * @param {Function} fn
 */
RepoCache.prototype._resolveImageResized = function(src, size, fn) {
	var self = this
	  , ext = path.extname( src )
	  , imgDir = path.dirname(src)
	  , rSize = new XRegExp('(?<width>[0-9]+)x(?<height>[0-9]+)', 'x');

    if (size == undefined) {
    	fn && fn(null, { type: 'file', filename: src });
    	return self;
    }

	var imgBase = path.basename( src, ext );
	var fname = path.join(imgDir, imgBase + '-' + size + ext);

	if (true === self.isCached(fname)) {
		fn && fn(null, { type: 'file', filename: src });
		return self;
	}
	
	var match = XRegExp.exec(size, rSize);

	var w = parseInt(match.width)
	  , h = parseInt(match.height);

	im.resize({
	  srcPath: path.resolve(src),
	  dstPath: path.resolve(fname),
	  width: w,
	  height: h
	}, function(err, stdout, stderr){

	  if (err) {
	  	// no resize
			fn && fn(null, { type: 'file', filename: src });	  	
	  }

		fn && fn(null, { type: 'file', filename: fname });
	});

	return self;
};

/**
 * Get package content
 *
 * Pre-condition: The function asume that the package was cached before
 *
 * @param {Object} pkg
 * @param {String} type
 * @param {String} name
 * @param {Function} fn
 */
RepoCache.prototype._resolveContent = function(metadata, pkg, type, ops, fn) {
	var self = this;
	
	var cpath = self.repository.config.cachePath
	  , dpath = self.repository.config.dataPath
	  ;

	var files = metadata.content.files
	  , pkgCacheFolder = path.join(cpath, metadata.uid)
	  , contentCache = path.join(cpath, 'content');

	if (files && files.length == 1) {
		
		var file = _.first(files);

		var fullname = path.join(pkgCacheFolder, file.filename);

		if (true === self.isCached(fullname)) {
			fn && fn(null, { type: 'file', filename: fullname });
			return self;
		}

		// if not exist cache the file
		pkg.extract(file.filename, pkgCacheFolder, function(err){
			if (err) { fn && fn(err); }
			
			fn && fn(null, { type: 'file', filename: fullname });
		});

		return self;
	}

	// for multiple files
	// prepare
	var pkgContentCache = path.join(contentCache, metadata.uid);
	wrench.mkdirSyncRecursive(contentCache);

	var fileFolder = path.join(pkgCacheFolder, 'files');

	var entries = files.map(function(f){ 
									return f.filename; 
								});

	var nEntries = files.map(function(f){ 
									return path.normalize(f.filename); 
								});

	var basePath = extractBasepath(nEntries);

	var allCached = _.every(nEntries, function(entry) {
									return self.isCached(entry, metadata.uid);
								});

	if (allCached) {

		fn && fn(null, { type: 'folder', name: pkgContentCache });

		return self;
	}

	pkg.extract(entries, pkgCacheFolder, function(err){
		if (err) { fn && fn(err); }

		var from = fileFolder;

		if (basePath.length === 1) {
			from = path.join(fileFolder, basePath[0]);
		}

		wrench.copyDirRecursive(from, path.normalize(pkgContentCache + '/'), {forceDelete: true, preserveFiles:true}, function(err){
			if (err) { fn && fn(err); }

			fn && fn(null, { type: 'folder', name: pkgContentCache });
		});

	});

	return self;
};

/**
 * Define if the file exists in the cache
 *
 * @param {String} uid
 * @param {String} file
 */
RepoCache.prototype.isCached = function(file, uid) {
	var self = this;

	if (uid == undefined) {
		return fs.existsSync(file);
	}

	var cpath = self.repository.config.cachePath;
	var fname = path.resolve(path.join(cpath, uid, file));
	
	return fs.existsSync(fname);
};

/**
 * Define if the file exists in the cache
 *
 * @param {String} uid
 * @param {String} file
 */
RepoCache.prototype.removeContent = function(uid) {
	var self = this;

	// if exists
	var cpath = self.repository.config.cachePath;
	var fname = path.resolve(path.join(cpath, uid));

	deleteFolderRecursive(fname);

	return self;
};

//
// private functions

function deleteFolderRecursive(dir) {
    var files = [];
    if( fs.existsSync(dir) ) {
        files = fs.readdirSync(dir);
        files.forEach(function(file,index){
            var curPath = dir + "/" + file;
            if(fs.lstatSync(curPath).isDirectory()) { // recurse
                deleteFolderRecursive(curPath);
            } else { // delete file
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(dir);
    }
};

/**
 * Create a package cache
 *
 * @param {Object} ops
 * @param {Package} pkg
 * @param {Function} fn
 */
function cachePackage(ops, pkg, fn) {
	var repoPath = ops.path
	, force = ops.withForce === undefined ? true : false
	, silince = ops.silince === undefined ? true : ops.silince
	;
	
	if (false === (pkg instanceof Array)) {
		pkg = [ pkg ];
	}

	pkg.forEach(function(p) {

		var pathTo = path.join(repoPath, '.cache', p.uid);

		io.mkdir(pathTo, function(err){
			io.write(
			path.join(pathTo, 'package.json'), 
			JSON.stringify(p.info),
			fn
			);
		});

	});
	
}

function extractBasepath(entries) {
	var res = [];

	var firstPathRex = /^files\/([^\/])+\//i;

	entries.forEach(function(et){
		try {
			var r = et.replace(/\\/g, '/');
			var m = r.match(firstPathRex);
			var being = m[0];

			var fPath = being.replace(/^files\//ig ,'')
											 .replace(/\//g ,'');

			 if (res.indexOf(fPath) === -1) {
			 	res.push(fPath);
			 }

		} catch(e) {
		}
	});

	return res;
}