const
    GH_RESERVED_USER_NAMES = [
      'settings', 'orgs', 'organizations',
      'site', 'blog', 'about', 'explore',
      'styleguide', 'showcases', 'trending',
      'stars', 'dashboard', 'notifications',
      'search', 'developer'
    ]
  , GH_RESERVED_REPO_NAMES = ['followers', 'following', 'repositories']
  , GH_BRANCH_SEL       = '*[data-master-branch]'
  , GH_BRANCH_BTN_SEL   = '*[data-master-branch] > .js-select-button'
  , GH_404_SEL          = '#parallax_wrapper'
  , GH_PJAX_SEL         = '#js-repo-pjax-container'
  , GH_CONTAINERS       = 'body > .container, .header > .container, .site > .container, .repohead > .container'

function GitHub() {}

/**
 * Selects a submodule.
 */
GitHub.prototype.selectSubmodule = function(path) {
  window.location.href = path
}

/**
 * Selects a path.
 */
GitHub.prototype.selectPath = function(path, tabSize) {
  var container = $(GH_PJAX_SEL)
    , qs = tabSize ? ('?ts=' + tabSize) : ''

  if (container.length) {
    $.pjax({
      // needs full path for pjax to work with Firefox as per cross-domain-content setting
      url : location.protocol + '//' + location.host + path + qs,
      container : container
    })
  }
  else window.location.href = path + qs // falls back if no container (i.e. GitHub DOM has changed or is not yet available)
}

/**
 * Updates page layout based on visibility status and width of the Octotree sidebar.
 */
GitHub.prototype.updateLayout = function(sidebarVisible, sidebarWidth) {
  var $containers = $(GH_CONTAINERS)
    , spacing = 10
    , autoMarginLeft
    , shouldPushLeft

  if ($containers.length === 4) {
    autoMarginLeft = ($('body').width() - $containers.width()) / 2
    shouldPushLeft = sidebarVisible && (autoMarginLeft <= sidebarWidth + spacing)
    $containers.css('margin-left', shouldPushLeft
      ? sidebarWidth + spacing
      : autoMarginLeft)
  }

  // falls-back if GitHub DOM has been updated
  else $('html').css('margin-left', sidebarVisible ? sidebarWidth - spacing : 0)
}

/**
 * Returns the repository information if user is at a repository URL. Returns `null` otherwise.
 */
GitHub.prototype.getRepoFromPath = function(showInNonCodePage, currentRepo) {
  // 404 page, skip
  if ($(GH_404_SEL).length) return false

  // (username)/(reponame)[/(subpart)]
  var match = window.location.pathname.match(/([^\/]+)\/([^\/]+)(?:\/([^\/]+))?/)
  if (!match) return false

  // not a repository, skip
  if (~GH_RESERVED_USER_NAMES.indexOf(match[1])) return false
  if (~GH_RESERVED_REPO_NAMES.indexOf(match[2])) return false

  // skip non-code page or not
  if (!showInNonCodePage && match[3] && !~['tree', 'blob'].indexOf(match[3])) return false

  // use selected branch, or previously selected branch, or master
  var branch = $(GH_BRANCH_SEL).data('ref') ||
    ((currentRepo.username === match[1] && currentRepo.reponame === match[2] && currentRepo.branch)
      ? currentRepo.branch
      : 'master')

  return {
    username : match[1],
    reponame : match[2],
    branch   : branch
  }
}

/**
 * Fetches data of a particular repository.
 * @param opts: { repo: repository, token (optional): user access token, apiUrl (optional): base API URL }
 * @param cb(err: error, tree: array (of arrays) of items)
 */
GitHub.prototype.fetchData = function(opts, cb) {
  var self = this
    , repo = opts.repo
    , folders = { '': [] }
    , encodedBranch = encodeURIComponent(decodeURIComponent(repo.branch))
    , $dummyDiv = $('<div/>')

  getTree(encodedBranch + '?recursive=true', function(err, tree) {
    if (err) return cb(err)

    fetchSubmodules(function(err, submodules) {
      if (err) return cb(err)
      submodules = submodules || {}

      // split work in chunks to prevent blocking UI on large repos
      nextChunk(0)
      function nextChunk(iteration) {
        var chunkSize = 300
          , baseIndex = iteration * chunkSize
          , i
          , item, path, type, index, name, moduleUrl

        for (i = 0; i < chunkSize; i++) {
          item = tree[baseIndex + i]

          // we're done
          if (item === undefined) return cb(null, folders[''])

          path  = item.path
          type  = item.type
          index = path.lastIndexOf('/')
          name  = $dummyDiv.text(path.substring(index + 1)).html() // sanitizes, closes #9

          item.id   = PREFIX + path
          item.text = name
          item.icon = type // use `type` as class name for tree node

          folders[path.substring(0, index)].push(item)

          if (type === 'tree') {
            folders[item.path] = item.children = []
            item.a_attr = { href: '#' }
          }
          else if (type === 'blob') {
            item.a_attr = { href: '/' + repo.username + '/' + repo.reponame + '/' + type + '/' + repo.branch + '/' + encodeURIComponent(path) /* closes #97 */ }
          }
          else if (type === 'commit') {
            moduleUrl = submodules[item.path]
            if (moduleUrl) { // fix #105
              // special handling for submodules hosted in GitHub
              if (~moduleUrl.indexOf('github.com')) {
                moduleUrl = moduleUrl.replace(/^git:/, window.location.protocol)
                                     .replace(/.git$/, '')
                item.text = '<a href="' + moduleUrl + '" class="jstree-anchor">' + name + '</a>' +
                            '<span>@ </span>' +
                            '<a href="' + moduleUrl + '/tree/' + item.sha + '" class="jstree-anchor">' + item.sha.substr(0, 7) + '</a>'
              }
              item.a_attr = { href: moduleUrl }
            }
          }
        }

        setTimeout(function() {
          nextChunk(iteration + 1)
        }, 0)
      }
    })

    function fetchSubmodules(cb) {
      var item = tree.filter(function(item) { return /^\.gitmodules$/i.test(item.path) })[0]
      if (!item) return cb()

      getBlob(item.sha, function(err, data) {
        if (err || !data) return cb(err)
        parseGitmodules(data, cb)
      })
    }
  })

  function getTree(tree, cb) {
   get('/git/trees/' + tree, function(err, res) {
      if (err) return cb(err)
      cb(null, res.tree)
    })
  }

  function getBlob(sha, cb) {
    get('/git/blobs/' + sha, function(err, res) {
      if (err) return cb(err)
      cb(null, atob(res.content))
    })
  }

  function get(path, cb) {
    var token = opts.token
      , host  = (location.host === 'github.com' ? 'api.github.com' : (location.host + '/api/v3'))
      , base  = location.protocol + '//' + host + '/repos/' + repo.username + '/' + repo.reponame
      , cfg   = { method: 'GET', url: base + path, cache: false }

    if (token) cfg.headers = { Authorization: 'token ' + token }
    $.ajax(cfg)
      .done(function(data) {
        cb(null, data)
      })
      .fail(function(jqXHR) {
        var createTokenUrl = location.protocol + '//' + location.host + '/settings/tokens/new'
          , error
          , message
          , needAuth

        switch (jqXHR.status) {
          case 0:
            error = 'Connection error'
            message = 'Cannot connect to GitHub. If your network connection to GitHub is fine, maybe there is an outage of the GitHub API. Please try again later.'
            needAuth = false
            break
          case 401:
            error = 'Invalid token'
            message = 'The token is invalid. Follow <a href="' + createTokenUrl + '" target="_blank">this link</a> to create a new token and paste it below.'
            needAuth = true
            break
          case 409:
            error = 'Empty repository'
            message = 'This repository is empty.'
            break
          case 404:
            error = 'Private repository'
            message = 'Accessing private repositories requires a GitHub access token. Follow <a href="' + createTokenUrl + '" target="_blank">this link</a> to create one and paste it below.'
            needAuth = true
            break
          case 403:
            if (~jqXHR.getAllResponseHeaders().indexOf('X-RateLimit-Remaining: 0')) {
              error = 'API limit exceeded'
              message = 'You have exceeded the GitHub API hourly limit and need GitHub access token to make extra requests. Follow <a href="' + createTokenUrl + '" target="_blank">this link</a> to create one and paste it below.'
              needAuth = true
              break
            }
            else {
              error = 'Forbidden'
              message = 'You are not allowed to access the API. You might need to provide an access token. Follow <a href="' + createTokenUrl + '" target="_blank">this link</a> to create one and paste it below.'
              needAuth = true
              break
            }
          default:
            error = message = jqXHR.statusText
            needAuth = false
            break
        }
        cb({
          error    : 'Error: ' + error,
          message  : message,
          needAuth : needAuth,
        })
      })
  }
}