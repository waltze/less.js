var contexts = require("./contexts"),
    Parser = require('./parser/parser'),
    LessError = require('./less-error');

module.exports = function(environment) {

    // FileInfo = {
    //  'relativeUrls' - option - whether to adjust URL's to be relative
    //  'filename' - full resolved filename of current file
    //  'rootpath' - path to append to normal URLs for this node
    //  'currentDirectory' - path to the current file, absolute
    //  'rootFilename' - filename of the base file
    //  'entryPath' - absolute path to the entry file
    //  'reference' - whether the file should not be output and only output parts that are referenced

    var ImportManager = function(less, context, rootFileInfo) {
        this.less = less;
        this.rootFilename = rootFileInfo.filename;
        this.paths = context.paths || [];  // Search paths, when importing
        this.contents = {};             // map - filename to contents of all the files
        this.contentsIgnoredChars = {}; // map - filename to lines at the beginning of each file to ignore
        this.mime = context.mime;
        this.error = null;
        this.context = context;
        // Deprecated? Unused outside of here, could be useful.
        this.queue = [];        // Files which haven't been imported yet
        this.files = {};        // Holds the imported parse trees.
    };
    /**
     * Add an import to be imported
     * @param path - the raw path
     * @param tryAppendExtension - whether to try appending a file extension (.less or .js if the path has no extension)
     * @param currentFileInfo - the current file info (used for instance to work out relative paths)
     * @param importOptions - import options
     * @param callback - callback for when it is imported
     */
    ImportManager.prototype.push = function (path, tryAppendExtension, currentFileInfo, importOptions, callback) {
        var importManager = this,
            pluginLoader = this.context.pluginManager.Loader;

        this.queue.push(path);

        var fileParsedFunc = function (e, root, fullPath) {
            importManager.queue.splice(importManager.queue.indexOf(path), 1); // Remove the path from the queue

            var importedEqualsRoot = fullPath === importManager.rootFilename;
            if (importOptions.optional && e) {
                callback(null, {rules:[]}, false, null);
            }
            else {
                importManager.files[fullPath] = root;
                if (e && !importManager.error) { importManager.error = e; }
                callback(e, root, importedEqualsRoot, fullPath);
            }
        };

        var newFileInfo = {
            relativeUrls: this.context.relativeUrls,
            entryPath: currentFileInfo.entryPath,
            rootpath: currentFileInfo.rootpath,
            rootFilename: currentFileInfo.rootFilename
        };

        var fileManager = environment.getFileManager(path, currentFileInfo.currentDirectory, this.context, environment);

        if (!fileManager) {
            fileParsedFunc({ message: "Could not find a file-manager for " + path });
            return;
        }

        if (tryAppendExtension) {
            path = importOptions.isPlugin ? path : fileManager.tryAppendExtension(path, ".less");
        }

        var loadFileCallback = function(loadedFile) {
            var plugin,
                resolvedFilename = loadedFile.filename,
                contents = loadedFile.contents.replace(/^\uFEFF/, '');

            // Pass on an updated rootpath if path of imported file is relative and file
            // is in a (sub|sup) directory
            //
            // Examples:
            // - If path of imported file is 'module/nav/nav.less' and rootpath is 'less/',
            //   then rootpath should become 'less/module/nav/'
            // - If path of imported file is '../mixins.less' and rootpath is 'less/',
            //   then rootpath should become 'less/../'
            newFileInfo.currentDirectory = fileManager.getPath(resolvedFilename);
            if (newFileInfo.relativeUrls) {
                newFileInfo.rootpath = fileManager.join(
                    (importManager.context.rootpath || ""),
                    fileManager.pathDiff(newFileInfo.currentDirectory, newFileInfo.entryPath));

                if (!fileManager.isPathAbsolute(newFileInfo.rootpath) && fileManager.alwaysMakePathsAbsolute()) {
                    newFileInfo.rootpath = fileManager.join(newFileInfo.entryPath, newFileInfo.rootpath);
                }
            }
            newFileInfo.filename = resolvedFilename;

            var newEnv = new contexts.Parse(importManager.context);

            newEnv.processImports = false;
            importManager.contents[resolvedFilename] = contents;

            if (currentFileInfo.reference || importOptions.reference) {
                newFileInfo.reference = true;
            }

            if (importOptions.isPlugin) {
                plugin = pluginLoader.evalPlugin(contents, newEnv, importManager, importOptions.pluginArgs, newFileInfo);
                if (plugin instanceof LessError) {
                    fileParsedFunc(plugin, null, resolvedFilename);
                }
                else {
                    fileParsedFunc(null, plugin, resolvedFilename);
                }
            } else if (importOptions.inline) {
                fileParsedFunc(null, contents, resolvedFilename);
            } else {
                new Parser(newEnv, importManager, newFileInfo).parse(contents, function (e, root) {
                    fileParsedFunc(e, root, resolvedFilename);
                });
            }
        };
        var promise;
        var done = function(err, loadedFile) {
            if (err) {
                fileParsedFunc(err);
            } else {
                loadFileCallback(loadedFile);
            }
        };
        if (importOptions.isPlugin) {
            try {
                pluginLoader.tryLoadPlugin(path, currentFileInfo.currentDirectory, done);
            }
            catch (e) {
                callback(e);
            }
        }
        else {
            promise = fileManager.loadFile(path, currentFileInfo.currentDirectory, this.context, environment, done);
            if (promise) {
                promise.then(loadFileCallback, fileParsedFunc);
            }
        }
        
    };
    return ImportManager;
};
