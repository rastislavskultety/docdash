/* eslint-disable quotes */
/* global env: true */

// eslint-disable-next-line
'use strict';

var doop = require('jsdoc/util/doop');
var fs = require('jsdoc/fs');
var helper = require('jsdoc/util/templateHelper');
var logger = require('jsdoc/util/logger');
var path = require('jsdoc/path');
var taffy = require('taffydb').taffy;
var template = require('jsdoc/template');
var util = require('util');

var htmlsafe = helper.htmlsafe;
var linkto = helper.linkto;
var resolveAuthorLinks = helper.resolveAuthorLinks;
var hasOwnProp = Object.prototype.hasOwnProperty;

var data, view;

var outdir = path.normalize(env.opts.destination);

/*
 * Safe retrieval of configuration options
 *
 * Example: option('conf.templates.default.useLongnameInNav')
 *
 */
function option(path, defaultValue) {
  var opt = env;
  if (opt) {
    var p = path.split('.');
    var i = 0;
    while (i < p.length) {
      opt = opt[p[i]];
      i += 1;
      if (typeof opt != 'object' || !opt) break;
    }
    if (i == p.length && opt !== undefined) {
      return opt;
    }
  }
  return defaultValue;
}

function copyFile(source, target, cb) {
  var cbCalled = false;

  var rd = fs.createReadStream(source);
  rd.on("error", function(err) {
    done(err);
  });
  var wr = fs.createWriteStream(target);
  wr.on("error", function(err) {
    done(err);
  });
  wr.on("close", function( /* ex */ ) {
    done();
  });
  rd.pipe(wr);

  function done(err) {
    if (!cbCalled) {
      cb(err);
      cbCalled = true;
    }
  }
}

function find(spec) {
  return helper.find(data, spec);
}

function tutoriallink(tutorial) {
  return helper.toTutorial(tutorial, null, { tag: 'em', classname: 'disabled', prefix: 'Tutorial: ' });
}

function getAncestorLinks(doclet) {
  return helper.getAncestorLinks(data, doclet);
}

function hashToLink(doclet, hash) {
  if (!/^(#.+)/.test(hash)) { return hash; }

  var url = helper.createLink(doclet);

  url = url.replace(/(#.+|$)/, hash);
  return '<a href="' + url + '">' + hash + '</a>';
}

function needsSignature(doclet) {
  var needsSig = false;

  // function and class definitions always get a signature
  if (doclet.kind === 'function' || doclet.kind === 'class' && !doclet.hideconstructor) {
    needsSig = true;
  } else if (doclet.kind === 'typedef' && doclet.type && doclet.type.names &&
    // typedefs that contain functions get a signature, too
    doclet.type.names.length) {
    for (var i = 0, l = doclet.type.names.length; i < l; i++) {
      if (doclet.type.names[i].toLowerCase() === 'function') {
        needsSig = true;
        break;
      }
    }
  }

  return needsSig;
}

function getSignatureAttributes(item) {
  var attributes = [];

  if (item.optional) {
    attributes.push('opt');
  }

  if (item.nullable === true) {
    attributes.push('nullable');
  } else if (item.nullable === false) {
    attributes.push('non-null');
  }

  return attributes;
}

function updateItemName(item) {
  var attributes = getSignatureAttributes(item);
  var itemName = item.name || '';

  if (item.variable) {
    itemName = '&hellip;' + itemName;
  }

  if (attributes && attributes.length) {
    itemName = util.format('%s<span class="signature-attributes">%s</span>', itemName,
      attributes.join(', '));
  }

  return itemName;
}

function addParamAttributes(params) {
  return params.filter(function(param) {
    return param.name && param.name.indexOf('.') === -1;
  }).map(updateItemName);
}

/*
 * Compact types from long to short name 
 */
function getTypeShortName(name) {
  var match = name.match(/.*[.~#]([\w\d]+)/);
  if (match) return match[1];
  match = name.match(/\s*external:([\w\d]+)/);
  if (match) return match[1];
  return name;
}

/*
 *  Find long name for short type name
 */
function getTypeLongName(name) {
  var find = data({
    kind: ['typedef', 'class', 'external'],
    name: name
  }).get();
  if (find.length == 1) {
    return find[0].longname;
  }
  return name;
}

function formattype(type) {
  if (option('conf.docdash.compactLongTypes')) {
    return htmlsafe(getTypeShortName(type));
  }
  return htmlsafe(type);
}

function typeExists(longname) {
  var find = data({
    kind: ['typedef', 'class', 'external'],
    longname: longname
  }).get();
  return find.length == 1;
}

function parseCompoundType(type) {
  var r = new RegExp(/(\bmodule:[/\w\d]+[\w\d][~#\.][\w\d]+\b)|(\b[\w\d]+\b)/g);
  var match;
  var repl = [];

  while ((match = r.exec(type)) !== null) {
    var name = match[0];
    var longname = option('conf.docdash.expandShortTypes') ? getTypeLongName(name) : name;
    var replace = typeExists(longname) ? linkto(longname, formattype(longname)) : null;
    repl.push({ from: match.index, to: r.lastIndex, replace: replace });
  }

  var result = '';
  var last = 0;
  repl.forEach(function(r) {
    if (r.replace) {
      result += htmlsafe(type.substring(last, r.from, r.to));
      result += r.replace;
      last = r.to;
    }
  });
  result += htmlsafe(type.substring(last));
  // return htmlsafe(type);
  // return JSON.stringify(repl);
  return result;
}

function linkToType(name) {
  return parseCompoundType(name);
}

function buildItemTypeStrings(item) {
  var types = [];

  if (item && item.type && item.type.names) {
    item.type.names.forEach(function(name) {
      types.push(linkToType(name));
    });
  }
  return types;
}

function buildAttribsString(attribs) {
  var attribsString = '';

  if (attribs && attribs.length) {
    attribsString = htmlsafe(util.format('(%s) ', attribs.join(', ')));
  }

  return attribsString;
}

function addNonParamAttributes(items) {
  var types = [];

  items.forEach(function(item) {
    types = types.concat(buildItemTypeStrings(item));
  });

  return types;
}

function addSignatureParams(f) {
  var params = f.params ? addParamAttributes(f.params) : [];
  f.signature = util.format('%s(%s) ', (f.signature || ''), params.join(', '));
}

function addSignatureReturns(f) {
  var attribs = [];
  var attribsString = '';
  var returnTypes = [];
  var returnTypesString = '';

  // jam all the return-type attributes into an array. this could create odd results (for example,
  // if there are both nullable and non-nullable return types), but let's assume that most people
  // who use multiple @return tags aren't using Closure Compiler type annotations, and vice-versa.
  if (f.returns) {
    f.returns.forEach(function(item) {
      helper.getAttribs(item).forEach(function(attrib) {
        if (attribs.indexOf(attrib) === -1) {
          attribs.push(attrib);
        }
      });
    });

    attribsString = buildAttribsString(attribs);
  }

  if (f.returns) {
    returnTypes = addNonParamAttributes(f.returns);
  }
  if (returnTypes.length) {
    returnTypesString = util.format(' &rarr; %s{%s}', attribsString, returnTypes.join('|'));
  }

  f.signature = '<span class="signature">' + (f.signature || '') + '</span>' +
    '<span class="type-signature">' + returnTypesString + '</span>';
}

function addSignatureTypes(f) {
  var types = f.type ? buildItemTypeStrings(f) : [];
  f.signature = (f.signature || '') + '<span class="type-signature">' +
    (types.length ? ' :' + types.join('|') : '') + '</span>';
}

function addAttribs(f) {
  var attribs = helper.getAttribs(f);
  var attribsString = buildAttribsString(attribs);

  f.attribs = util.format('<span class="type-signature">%s</span>', attribsString);
}

function shortenPaths(files, commonPrefix) {
  Object.keys(files).forEach(function(file) {
    files[file].shortened = files[file].resolved.replace(commonPrefix, '')
      // always use forward slashes
      .replace(/\\/g, '/');
  });

  return files;
}

function getPathFromDoclet(doclet) {
  if (!doclet.meta) {
    return null;
  }

  return doclet.meta.path && doclet.meta.path !== 'null' ?
    path.join(doclet.meta.path, doclet.meta.filename) :
    doclet.meta.filename;
}

function generate(type, title, docs, filename, resolveLinks) {
  resolveLinks = resolveLinks === false ? false : true;

  var docData = {
    type: type,
    title: title,
    docs: docs
  };

  var outpath = path.join(outdir, filename);
  var html = view.render('container.tmpl', docData);

  if (resolveLinks) {
    html = helper.resolveLinks(html); // turn {@link foo} into <a href="foodoc.html">foo</a>
  }

  fs.writeFileSync(outpath, html, 'utf8');
}

function generateSourceFiles(sourceFiles, encoding) {
  encoding = encoding || 'utf8';
  Object.keys(sourceFiles).forEach(function(file) {
    var source;
    // links are keyed to the shortened path in each doclet's `meta.shortpath` property
    var sourceOutfile = helper.getUniqueFilename(sourceFiles[file].shortened);
    helper.registerLink(sourceFiles[file].shortened, sourceOutfile);

    try {
      source = {
        kind: 'source',
        code: helper.htmlsafe(fs.readFileSync(sourceFiles[file].resolved, encoding))
      };
    } catch (e) {
      logger.error('Error while generating source file %s: %s', file, e.message);
    }

    generate('Source', sourceFiles[file].shortened, [source], sourceOutfile, false);
  });
}

/**
 * Look for classes or functions with the same name as modules (which indicates that the module
 * exports only that class or function), then attach the classes or functions to the `module`
 * property of the appropriate module doclets. The name of each class or function is also updated
 * for display purposes. This function mutates the original arrays.
 *
 * @private
 * @param {Array.<module:jsdoc/doclet.Doclet>} doclets - The array of classes and functions to
 * check.
 * @param {Array.<module:jsdoc/doclet.Doclet>} modules - The array of module doclets to search.
 */
function attachModuleSymbols(doclets, modules) {
  var symbols = {};

  // build a lookup table
  doclets.forEach(function(symbol) {
    symbols[symbol.longname] = symbols[symbol.longname] || [];
    symbols[symbol.longname].push(symbol);
  });

  return modules.map(function(module) {
    if (symbols[module.longname]) {
      module.modules = symbols[module.longname]
        // Only show symbols that have a description. Make an exception for classes, because
        // we want to show the constructor-signature heading no matter what.
        .filter(function(symbol) {
          return symbol.description || symbol.kind === 'class';
        })
        .map(function(symbol) {
          symbol = doop(symbol);

          if (symbol.kind === 'class' || symbol.kind === 'function') {
            symbol.name = symbol.name.replace('module:', '(require("') + '"))';
          }

          return symbol;
        });
    }
  });
}

function createMenuItems(items, itemHeading, itemsSeen, linktoFn) {
  var paths = { heading: itemHeading, children: {}, items: [] };

  function insertPath(path, item) {
    if (path && option('conf.docdash.navGroupByPath')) {
      var p = path.split('/');
      var current = paths;
      var slug = '';
      p.forEach(function(n) {
        slug += n + '/';
        current = current.children[n] = current.children[n] || { heading: slug, children: {}, items: [] };
      });
      current.items.push(item);
    } else {
      paths.items.push(item);
    }
  }

  if (items && items.length) {
    items.forEach(function(item) {
      if (!hasOwnProp.call(item, 'longname')) {
        insertPath(null, {
          link: linktoFn('', item.name)
        });
      } else if (!hasOwnProp.call(itemsSeen, item.longname)) {
        var displayName;

        if (option('conf.templates.default.useLongnameInNav')) {
          displayName = item.longname.replace(/\b(module|event):/g, '');
        } else {
          displayName = item.name;
        }

        var path, name;
        var match = displayName.match(/(.*)\/([^/]+)/);
        if (match) {
          path = match[1];
          name = match[2];
        }

        var parent = {
          link: linktoFn(item.longname, name || displayName),
          docItem: Object.assign({}, item),
          items: []
        };

        insertPath(path, parent);

        if (option('conf.docdash.navDetails', true)) {
          var selection = data({
                kind: ['member', 'function'],
                memberof: item.longname
              },
              option('conf.docdash.navDetailsFilter'))
            .order(option('conf.docdash.navDetailsOrder', 'kind, scope desc, name'))
            .get();

          function add(list, cls) {
            if (list.length) {
              var child = {
                class: cls,
                items: []
              };
              parent.items.push(child);

              list.forEach(function(item) {
                child.items.push({
                  link: linkto(item.longname, item.name),
                  docItem: Object.assign({}, item)
                });
              });
            }
          };

          add(selection.filter(function(s) { return s.kind == 'member'; }), 'members');
          add(selection.filter(function(s) { return s.kind == 'function'; }), 'methods');
        }
        itemsSeen[item.longname] = true;
      }
    });
  }

  return paths;
}

function buildMenuHtml(menuData, level) {
  function itemData(docItem, name) {
    return docItem[name] ? ' data-' + name + '="' + docItem[name] + '"' : '';
  }

  function indent(offset) {
    offset = offset || 0;
    return '  '.repeat(level + offset + 1);
  }

  function addItem(item) {
    var result = '';
    if (item.docItem) {
      var data = itemData(item.docItem, 'kind') +
        itemData(item.docItem, 'access') +
        itemData(item.docItem, 'async');
      // var collapse = level > 1 && option('conf.docdash.collapse') ? ' style="display: none;"' : '';

      // result += indent() + '<li' + data + collapse + '>\n';
      result += indent() + '<li' + data + '>\n';
      if (item.link) {
        result += indent(1) + item.link + '\n';
      }
      result += buildMenuHtml(item, level + 1);
      result += indent() + '</li>\n';
    } else if (item.link) {
      result += indent() + '<li>\n';
      result += indent(1) + item.link + '\n';
      result += buildMenuHtml(item, level + 1);
      result += indent() + '</li>\n';
    } else {
      result += buildMenuHtml(item, level + 1);
    }

    return result;
  }

  level = level || 0;
  var result = '';

  if (menuData) {
    var directChildrenCount = 0;
    var items = menuData.items || [];
    if (items) {
      items.forEach(function(item) {
        result += addItem(item);
        directChildrenCount += 1;
      });
    }
    for (var child in menuData.children) {
      result += buildMenuHtml(menuData.children[child], level + 1);
    }

    if (result) {
      // if there are no direct children then do not insert any group
      if (directChildrenCount == 0 && option('conf.docdash.navSkipEmptyGroups', true)) {
        return result;
      }

      var html = '';

      // crate menu group heading
      if (menuData.heading) {
        // main heading and top level
        if (level == 0) {
          var hlevel = '3';
          html += indent(-1) + '<h' + hlevel + '>\n' +
            indent(0) + menuData.heading + '\n' +
            indent(-1) + '</h' + hlevel + '>\n';
        } else {
          html += indent(-1) + '<li>\n' +
            indent() + menuData.heading + '\n' +
            indent(-1) + '</li>\n';
        }
      }

      var cls = menuData.class ? ' class="' + menuData.class + '"' : '';
      html += indent(-1) + '<ul' + cls + '>\n' +
        result +
        indent(-1) + '</ul>\n';
      return html;
    }
  }
  return '';
}

function buildMemberNav(items, itemHeading, itemsSeen, linktoFn) {
  var r = createMenuItems(items, itemHeading, itemsSeen, linktoFn);
  var h = buildMenuHtml(r);
  return h;
  //
  // var nav = '';
  //
  // if (items && items.length) {
  //   var itemsNav = '';
  //   var displayName;
  //
  //   items.forEach(function(item) {
  //     if (!hasOwnProp.call(item, 'longname')) {
  //       itemsNav += '<li>' + linktoFn('', item.name);
  //       itemsNav += '</li>';
  //     } else if (!hasOwnProp.call(itemsSeen, item.longname)) {
  //       if (option('conf.templates.default.useLongnameInNav')) {
  //         displayName = item.longname.replace(/\b(module|event):/g, '');
  //       } else {
  //         displayName = item.name;
  //       }
  //       itemsNav += '<li>' + linktoFn(item.longname, displayName);
  //
  //       if (option('conf.docdash.navDetails', true)) {
  //         var selection = data({
  //               kind: ['member', 'function'],
  //               memberof: item.longname
  //             },
  //             option('conf.docdash.navDetailsFilter'))
  //           .order(option('conf.docdash.navDetailsOrder', 'kind, scope desc, name'))
  //           .get();
  //
  //         function add(list, type, cls) {
  //           if (list.length) {
  //             itemsNav += "<ul class='" + cls + "'>";
  //             list.forEach(function(item) {
  //               itemsNav += "<li data-scope='" + item.scope +
  //                 "' data-type='" + type + "'" +
  //                 " data-access='" + item.access + "'" +
  //                 " data-async='" + item.async + "'";
  //
  //               if (option('conf.docdash.collapse'))
  //                 itemsNav += " style='display: none;'";
  //               itemsNav += ">";
  //               itemsNav += linkto(item.longname, item.name);
  //               itemsNav += "</li>";
  //             });
  //             itemsNav += "</ul>";
  //           }
  //         };
  //
  //         add(selection.filter(function(s) { return s.kind == 'member'; }), 'member', 'members');
  //         add(selection.filter(function(s) { return s.kind == 'function'; }), 'method', 'methods');
  //       }
  //
  //       itemsNav += '</li>';
  //       itemsSeen[item.longname] = true;
  //     }
  //   });
  //
  //   if (itemsNav !== '') {
  //     nav += '<h3>' + itemHeading + '</h3><ul>' + itemsNav + '</ul>';
  //   }
  // }
  //
  // return nav;
}

function linktoTutorial(longName, name) {
  return tutoriallink(name);
}

function linktoExternal(longName, name) {
  return linkto(longName, name.replace(/(^"|"$)/g, ''));
}

/**
 * Create the navigation sidebar.
 * @param {object} members The members that will be used to create the sidebar.
 * @param {array<object>} members.classes
 * @param {array<object>} members.externals
 * @param {array<object>} members.globals
 * @param {array<object>} members.mixins
 * @param {array<object>} members.modules
 * @param {array<object>} members.namespaces
 * @param {array<object>} members.tutorials
 * @param {array<object>} members.events
 * @param {array<object>} members.interfaces
 * @return {string} The HTML for the navigation sidebar.
 */

function buildNav(members) {
  var nav = '<h2><a href="index.html">Home</a></h2>';
  var seen = {};
  var seenTutorials = {};
  var optMenu = option('conf.docdash.menu');
  if (optMenu) {
    for (var menu in optMenu) {
      nav += '<h2><a ';
      // add attributes
      for (var attr in optMenu[menu]) {
        nav += attr + '="' + optMenu[menu][attr] + '" ';
      }
      nav += '>' + menu + '</a></h2>';
    }
  }
  var defaultOrder = [
    'Classes', 'Modules', 'Externals', 'Events', 'Namespaces', 'Mixins', 'Tutorials', 'Interfaces'
  ];
  var order = option('conf.docdash.navSectionOrder', defaultOrder);
  var sections = {
    Classes: buildMemberNav(members.classes, 'Classes', seen, linkto),
    Modules: buildMemberNav(members.modules, 'Modules', {}, linkto),
    Externals: buildMemberNav(members.externals, 'Externals', seen, linktoExternal),
    Events: buildMemberNav(members.events, 'Events', seen, linkto),
    Namespaces: buildMemberNav(members.namespaces, 'Namespaces', seen, linkto),
    Mixins: buildMemberNav(members.mixins, 'Mixins', seen, linkto),
    Tutorials: buildMemberNav(members.tutorials, 'Tutorials', seenTutorials, linktoTutorial),
    Interfaces: buildMemberNav(members.interfaces, 'Interfaces', seen, linkto),
  };
  order.forEach(member => nav += sections[member]);

  if (members.globals.length) {
    var globalNav = '';

    members.globals.forEach(function(g) {
      if ((option('conf.docdash.typedefs') || g.kind !== 'typedef') && !hasOwnProp.call(seen, g.longname)) {
        globalNav += '<li>' + linkto(g.longname, g.name) + '</li>';
      }
      seen[g.longname] = true;
    });

    if (!globalNav) {
      // turn the heading into a link so you can actually get to the global page
      nav += '<h3>' + linkto('global', 'Global') + '</h3>';
    } else {
      nav += '<h3>Global</h3><ul>' + globalNav + '</ul>';
    }
  }

  return nav;
}

/**
   @param {TAFFY} taffyData See <http://taffydb.com/>.
   @param {object} opts
   @param {Tutorial} tutorials
*/
exports.publish = function(taffyData, opts, tutorials) {
  data = taffyData;

  // var conf = option('conf.templates', {});
  // conf.default = conf.default || {};

  var templatePath = path.normalize(opts.template);
  view = new template.Template(path.join(templatePath, 'tmpl'));

  // claim some special filenames in advance, so the All-Powerful Overseer of Filename Uniqueness
  // doesn't try to hand them out later
  var indexUrl = helper.getUniqueFilename('index');
  // don't call registerLink() on this one! 'index' is also a valid longname

  var globalUrl = helper.getUniqueFilename('global');
  helper.registerLink('global', globalUrl);

  // set up templating
  var optLayoutFile = option('conf.templates.default.layoutFile');
  view.layout = optLayoutFile ?
    path.getResourcePath(path.dirname(optLayoutFile), path.basename(optLayoutFile)) :
    'layout.tmpl';

  // set up tutorials for helper
  helper.setTutorials(tutorials);

  data = helper.prune(data);

  // if (docdash.sort !== false) data.sort('longname, version, since');
  var defaultSort = option('conf.templates.default.useLongnameInNav') ? 'longname, version, since' : 'name, version, since';
  if (option('conf.docdash.sort', true)) {
    data.sort(option('conf.docdash.sortFields', defaultSort));
  }
  helper.addEventListeners(data);

  var sourceFiles = {};
  var sourceFilePaths = [];
  data().each(function(doclet) {
    var optRemoveQuotes = option('conf.docdash.removeQuotes');
    if (optRemoveQuotes) {
      if (optRemoveQuotes === "all") {
        if (doclet.name) {
          doclet.name = doclet.name.replace(/"/g, '');
          doclet.name = doclet.name.replace(/'/g, '');
        }
        if (doclet.longname) {
          doclet.longname = doclet.longname.replace(/"/g, '');
          doclet.longname = doclet.longname.replace(/'/g, '');
        }
      } else if (optRemoveQuotes === "trim") {
        if (doclet.name) {
          doclet.name = doclet.name.replace(/^"(.*)"$/, '$1');
          doclet.name = doclet.name.replace(/^'(.*)'$/, '$1');
        }
        if (doclet.longname) {
          doclet.longname = doclet.longname.replace(/^"(.*)"$/, '$1');
          doclet.longname = doclet.longname.replace(/^'(.*)'$/, '$1');
        }
      }
    }
    doclet.attribs = '';

    if (doclet.examples) {
      doclet.examples = doclet.examples.map(function(example) {
        var caption, code;

        if (example && example.match(/^\s*<caption>([\s\S]+?)<\/caption>(\s*[\n\r])([\s\S]+)$/i)) {
          caption = RegExp.$1;
          code = RegExp.$3;
        }

        return {
          caption: caption || '',
          code: code || example || ''
        };
      });
    }
    if (doclet.see) {
      doclet.see.forEach(function(seeItem, i) {
        doclet.see[i] = hashToLink(doclet, seeItem);
      });
    }

    // build a list of source files
    var sourcePath;
    if (doclet.meta) {
      sourcePath = getPathFromDoclet(doclet);
      sourceFiles[sourcePath] = {
        resolved: sourcePath,
        shortened: null
      };
      if (sourceFilePaths.indexOf(sourcePath) === -1) {
        sourceFilePaths.push(sourcePath);
      }
    }
  });

  // update outdir if necessary, then create outdir
  var packageInfo = (find({ kind: 'package' }) || [])[0];
  if (packageInfo && packageInfo.name) {
    outdir = path.join(outdir, packageInfo.name, (packageInfo.version || ''));
  }
  fs.mkPath(outdir);

  // copy the template's static files to outdir
  var fromDir = path.join(templatePath, 'static');
  var staticFiles = fs.ls(fromDir, 3);

  staticFiles.forEach(function(fileName) {
    var toDir = fs.toDir(fileName.replace(fromDir, outdir));
    fs.mkPath(toDir);
    copyFile(fileName, path.join(toDir, path.basename(fileName)), function(err) { if (err) console.err(err); });
  });

  // copy user-specified static files to outdir
  var staticFilePaths, staticFileFilter, staticFileScanner;

  if (option('conf.templates.default.staticFiles')) {
    // The canonical property name is `include`. We accept `paths` for backwards compatibility
    // with a bug in JSDoc 3.2.x.
    staticFilePaths = option('conf.templates.default.staticFiles.include',
      option('conf.templates.default.staticFiles.paths'), []);
    staticFileFilter = new(require('jsdoc/src/filter')).Filter(option('conf.templates.default.staticFiles'));
    staticFileScanner = new(require('jsdoc/src/scanner')).Scanner();

    staticFilePaths.forEach(function(filePath) {
      var extraStaticFiles = staticFileScanner.scan([filePath], 10, staticFileFilter);

      extraStaticFiles.forEach(function(fileName) {
        var sourcePath = fs.toDir(filePath);
        var toDir = fs.toDir(fileName.replace(sourcePath, outdir));
        fs.mkPath(toDir);
        copyFile(fileName, path.join(toDir, path.basename(fileName)), function(err) { if (err) console.err(err); });
      });
    });
  }

  if (sourceFilePaths.length) {
    sourceFiles = shortenPaths(sourceFiles, path.commonPrefix(sourceFilePaths));
  }
  data().each(function(doclet) {
    var url = helper.createLink(doclet);
    helper.registerLink(doclet.longname, url);

    // add a shortened version of the full path
    var docletPath;
    if (doclet.meta) {
      docletPath = getPathFromDoclet(doclet);
      docletPath = sourceFiles[docletPath].shortened;
      if (docletPath) {
        doclet.meta.shortpath = docletPath;
      }
    }
  });

  data().each(function(doclet) {
    var url = helper.longnameToUrl[doclet.longname];

    if (url.indexOf('#') > -1) {
      doclet.id = helper.longnameToUrl[doclet.longname].split(/#/).pop();
    } else {
      doclet.id = doclet.name;
    }

    if (needsSignature(doclet)) {
      addSignatureParams(doclet);
      addSignatureReturns(doclet);
      addAttribs(doclet);
    }
  });

  // do this after the urls have all been generated
  data().each(function(doclet) {
    doclet.ancestors = getAncestorLinks(doclet);

    if (doclet.kind === 'member') {
      addSignatureTypes(doclet);
      addAttribs(doclet);
    }

    if (doclet.kind === 'constant') {
      addSignatureTypes(doclet);
      addAttribs(doclet);
      doclet.kind = 'member';
    }
  });

  var members = helper.getMembers(data);
  members.tutorials = tutorials.children;

  // output pretty-printed source files by default
  var outputSourceFiles = option('conf.templates.default.outputSourceFiles', true);

  // add template helpers
  view.find = find;
  view.linkto = linkto;
  view.resolveAuthorLinks = resolveAuthorLinks;
  view.tutoriallink = tutoriallink;
  view.htmlsafe = htmlsafe;
  view.outputSourceFiles = outputSourceFiles;
  view.formattype = formattype;
  view.linkToType = linkToType;
  view.option = option;
  view.debug = option('conf.docdash.debug');

  // once for all
  view.nav = buildNav(members);
  // view.nav = '<pre>';
  // data().each(function(doclet) {
  //   view.nav += doclet.kind + ': "' + doclet.longname + '"  ' + (doclet.meta && doclet.meta.filename) + '\n';
  //
  //   // view.nav += JSON.stringify(doclet.meta) + '\n\n';
  // });
  // view.nav += '</pre>';

  attachModuleSymbols(find({ longname: { left: 'module:' } }), members.modules);

  // generate the pretty-printed source files first so other pages can link to them
  if (outputSourceFiles) {
    generateSourceFiles(sourceFiles, opts.encoding);
  }

  if (members.globals.length) {
    generate('', 'Global', [{ kind: 'globalobj' }], globalUrl);
  }

  // index page displays information from package.json and lists files
  var files = find({ kind: 'file' });
  var packages = find({ kind: 'package' });

  generate('', 'Home',
    packages.concat(
      [{ kind: 'mainpage', readme: opts.readme, longname: (opts.mainpagetitle) ? opts.mainpagetitle : 'Main Page' }]
    ).concat(files),
    indexUrl);

  // set up the lists that we'll use to generate pages
  var classes = taffy(members.classes);
  var modules = taffy(members.modules);
  var namespaces = taffy(members.namespaces);
  var mixins = taffy(members.mixins);
  var externals = taffy(members.externals);
  var interfaces = taffy(members.interfaces);

  Object.keys(helper.longnameToUrl).forEach(function(longname) {
    var myModules = helper.find(modules, { longname: longname });
    if (myModules.length) {
      generate('Module', myModules[0].name, myModules, helper.longnameToUrl[longname]);
    }

    var myClasses = helper.find(classes, { longname: longname });
    if (myClasses.length) {
      generate('Class', myClasses[0].name, myClasses, helper.longnameToUrl[longname]);
    }

    var myNamespaces = helper.find(namespaces, { longname: longname });
    if (myNamespaces.length) {
      generate('Namespace', myNamespaces[0].name, myNamespaces, helper.longnameToUrl[longname]);
    }

    var myMixins = helper.find(mixins, { longname: longname });
    if (myMixins.length) {
      generate('Mixin', myMixins[0].name, myMixins, helper.longnameToUrl[longname]);
    }

    var myExternals = helper.find(externals, { longname: longname });
    if (myExternals.length) {
      generate('External', myExternals[0].name, myExternals, helper.longnameToUrl[longname]);
    }

    var myInterfaces = helper.find(interfaces, { longname: longname });
    if (myInterfaces.length) {
      generate('Interface', myInterfaces[0].name, myInterfaces, helper.longnameToUrl[longname]);
    }
  });

  // TODO: move the tutorial functions to templateHelper.js
  function generateTutorial(title, tutorial, filename) {
    var tutorialData = {
      title: title,
      header: tutorial.title,
      content: tutorial.parse(),
      children: tutorial.children
    };

    var tutorialPath = path.join(outdir, filename);
    var html = view.render('tutorial.tmpl', tutorialData);

    // yes, you can use {@link} in tutorials too!
    html = helper.resolveLinks(html); // turn {@link foo} into <a href="foodoc.html">foo</a>
    fs.writeFileSync(tutorialPath, html, 'utf8');
  }

  // tutorials can have only one parent so there is no risk for loops
  function saveChildren(node) {
    node.children.forEach(function(child) {
      generateTutorial('Tutorial: ' + child.title, child, helper.tutorialToUrl(child.name));
      saveChildren(child);
    });
  }

  saveChildren(tutorials);
};
