"use strict";

var path  = require("path")
var sh    = require("shelljs")
var fs    = require("fs")
var mime  = require("mime")

var handlebars = require("handlebars")
var markdown   = require("markdown").markdown
var moment     = require("moment")

handlebars.registerHelper("date", function (date, format) {
  return moment(date).format(format)
})

function normalize(url, p) {
  return url[0] === "/" ? url.slice(1) : path.join(path.dirname(p), url)
}

function read(dir) {
  var site = { src: dir, dev: false }
  var uid  = 0

  site.pages = sh.ls("-R", path.join(dir, "pages"))
  site.pages = site.pages.reduce(function (acc, file) {
    var ap = path.join(dir, "pages", file)

    if (sh.test("-d", ap))
      return acc

    var data = sh.cat(ap)
    var meta = {}

    if (data.trim()[0] === "{") {
      data = data.split("\n\n")
      meta = JSON.parse(data[0])
      data = data.slice(1).join("\n\n")
    }

    meta.id   = uid++
    meta.type = path.extname(file).slice(1)
    meta.path = meta.type === "md" ? file.replace(/\.\S+$/, ".html") : file

    if (meta.altUrl) {
      meta.altPath = normalize(meta.altUrl, meta.path)

      if (path.extname(meta.altPath) === "")
        meta.altPath = path.join(meta.altPath, "index.html")
    }

    if (meta.url)
      meta.path = normalize(meta.url, meta.path)
    else
      meta.url = "/" + meta.path

    if (path.extname(meta.path) === "")
      meta.path = path.join(meta.path, "index.html")

    if (meta.template && path.extname(meta.template) === "")
      meta.template = meta.template + ".html"

    return acc.concat({ meta: meta, data: data })
  }, [])

  site.cache = sh.ls("-R", path.join(dir, "templates"))
  site.cache = site.cache.reduce(function (acc, file) {
    var ap = path.join(dir, "templates", file)

    if (sh.test("-d", ap) || path.extname(ap) !== ".html")
      return acc

    acc[file] = sh.cat(ap)
    return acc
  }, {})

  site.resources = sh.ls("-R", path.join(dir, "res"))
  site.resources = site.resources.reduce(function (acc, file) {
    var ap = path.join(dir, "res", file)

    if (sh.test("-d", ap))
      return acc

    var meta = { path: file, binary: !/^text\//.test(mime.lookup(file)) }
    var data = meta.binary ? fs.readFileSync(ap, { encoding: "binary" }) : sh.cat(ap)

    return acc.concat({ meta: meta, data: data })
  }, [])

  return site
}

function build(site) {
  var src     = path.resolve(site.src)
  var config  = path.join(src, "package.json")
  var plugins = require(config).oddwebPlugins || []

  site = plugins.reduce(function (acc, plugin) {
    if (/^core\//.test(plugin))
      return require(path.join(path.dirname(module.filename), plugin) + ".js")(acc, handlebars)

    if (path.extname(plugin) === ".js")
      return require(path.join(src, plugin))(acc, handlebars)

    return require(path.join(src, "node_modules", plugin))(acc, handlebars)
  }, site)

  site.pages = site.pages.map(function (page) {
    if (page.meta.skip)
      return page

    switch (page.meta.type) {
    case "xml":
    case "html":
      page.data = handlebars.compile(page.data)({ page: page.meta, site: site })
      break
    case "md":
      var html = []
      var tmp  = page.data.split("\n\n").map(function (block) {
        if (block.trim()[0] === "<")
          return "$" + (html.push(block) - 1) + "$"
        return block
      }).join("\n\n")

      page.data = markdown.toHTML(tmp).split("\n\n").map(function (block) {
        if (/^<p>\$\d+\$<\/p>$/.test(block))
          return html[block.slice(4, block.length - 5)]
        return block
      }).join("\n\n")

      if (!page.meta.url)
        page.meta.path = page.meta.path.replace(/\.md$/, ".html")
    }

    if (page.meta.template) {
      page.data = handlebars.compile(site.cache[page.meta.template])({
        content: new handlebars.SafeString(page.data),
        page:    page.meta,
        site:    site
      })
    }

    return page
  })

  return site
}

function write(site) {
  function prep(root, p) {
    var dir = path.join(root, path.dirname(p))

    if (!sh.test("-e", dir))
      sh.mkdir("-p", dir)

    return path.join(root, p)
  }

  function wrt(list, root) {
    list.forEach(function (item) {
      var ap = prep(root, item.meta.path)

      if (item.meta.binary)
        fs.writeFileSync(ap, item.data, { encoding: "binary" })
      else
        item.data.to(ap)

      if (item.meta.altPath)
        ("<html><meta http-equiv=refresh content='0;" + item.meta.url + "'></html>").to(prep(root, item.meta.altPath))
    })
  }

  wrt(site.pages, path.resolve(path.join(site.src, "site")))
  wrt(site.resources, path.resolve(path.join(site.src, "site", "res")))

  return site
}

module.exports = {
  read:  read,
  build: build,
  write: write
}