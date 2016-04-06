var Promise = require('bluebird');
var request = require('requestretry');
var cheerio = require('cheerio');
var config = require('./config');
var fs = require('fs');

var scrapCategories = function(params, callback) {
    var req = {
        start: (params.start) ? params.start : 0,
        limit: (params.limit) ? params.limit : Infinity,
        verbose: !!params.verbose,
    };

    request({ url: config.category.url, maxAttempts: 5, retryDelay: 5000 }, function(error, response, html) {
        if (!error) {
            var data = [];
            var $ = cheerio.load(html);

            $(config.category.domString).map(function(i) {
                if (i >= req.limit) return false;
                
                var $self = $(this);
                data[i] = {
                    name: $self.text().replace(/\s+phone(.*)/g, ''),
                    url: config.baseUrl + '/' + $self.attr('href'),
                };

                if (req.verbose) console.log('Found: ' + data[i].name);
            });
            callback(null, data);
        } else {
            callback(error);
        }
    });
};

var scrapItemsFromACategory = function(params, callback) {
    var req = {
        name: params.name,
        url: params.url,
        data: params.data ? params.data : [],
        start: params.start ? params.start : 0,
        limit: params.limit ? params.limit : Infinity,
        verbose: !!params.verbose,
    };

    request({ url: req.url, maxAttempts: 5, retryDelay: 5000 }, function(error, response, html) {
        if (req.verbose) console.log('Processing ' + req.name + ' (' + req.url + ')');
        if (!error) {
            var data = [];
            var $ = cheerio.load(html);

            var $domObj = $(config.item.domString);
            $domObj.map(function(i) {
                if (i >= req.limit) return false;

                var $self = $(this);
                var $img = $self.children('img');
                var $name = $self.children('strong');

                data[i] = {
                    name: $name.text(),
                    description: $img.attr('title'),
                    url: config.baseUrl + '/' + $self.attr('href'),
                    imageUrl: $img.attr('src'),
                };
            });

            var res = {
                brand: req.name,
                brandUrl: req.url,
                quantity: data.length,
                items: data,
            };

            if (req.data.length === 0) {
                callback(null, res);
            } else {
                res.items = res.items.concat(req.data);
                callback(null, res);
            }
        } else {
            callback(error);
        }
    });
};

var promiseFor = Promise.method(function(condition, action, value) {
    if (!condition(value)) return value;
    return action(value).then(promiseFor.bind(null, condition, action));
});

var getNextPage = function(params, callback) {
    var req = {
        url: params.url,
    };

    request(req.url, function(error, response, html) {
        if (!error) {
            var nextUrl = null;
            var $ = cheerio.load(html);

            var $linkNext = $('a.pages-next:not(".disabled")');
            if ($linkNext.length > 0) {
                nextUrl = config.baseUrl + '/' + $linkNext.attr('href');
            }

            callback(null, nextUrl);
        } else {
            callback(error);
        }
    });
};

var getPages = function(params, callback) {
    var req = {
        url: params.url,
        start: params.start ? params.start : 0,
        limit: params.limit ? params.limit - 1 : Infinity,
        verbose: !!params.verbose,
    };

    var getNextPageAsync = Promise.promisify(getNextPage);
    var urls = [req.url];
    promiseFor(
        function(count) {
            return count < req.limit;
        },
        function(count) {
            return getNextPageAsync({ url: urls[urls.length - 1] }).then(function(nextUrl) { 
                if (nextUrl === null) {
                    return count = req.limit;
                }

                urls.push(nextUrl);
                return ++count;
            });
        }, req.start)
    .then(function() {
        callback(null, urls);
    }).catch(function(error) {
        callback(error);
    });
};

var nScrapContent = 0;
var scrapContent = function(params, callback) {
    var req = {
        index: params.index,
        brand: params.brand,
        url: params.url,
        verbose: !!params.verbose,
    };

    request({ url: req.url, maxAttempts: 1000, retryDelay: 2000 }, function(error, response, html) {
        if (!error) {
            if (req.verbose) console.log(++nScrapContent + '. ' + req.brand + ' - ' + req.url);
            var data = {};
            var $ = cheerio.load(html);

            //tables (spec category)
            $(config.content.domString).map(function(i) {
                var $self = $(this);
                var spec = data;

                var specCategory = $self.find('th').text();
                spec[specCategory] = {};

                var $ttls = $self.find('td.ttl');
                $ttls.map(function(i) {
                    var $ttl = $(this);
                    var $nfo = $ttl.siblings('td.nfo');
                    var ttl = $ttl.text();
                    var nfo = $nfo.text();

                    if (ttl === ' ' || ttl === '') {
                        ttl = 'Others';
                    }

                    nfo = nfo.replace(/^(\r\n)+/, '').trim();
                    if (nfo !== '') {
                        var multiNfo = nfo.split(/\r\n/);
                        if (multiNfo.length < 2) {
                            spec[specCategory][ttl] = nfo;
                        } else {
                            if (typeof spec[specCategory][ttl] !== 'object') {
                                if (typeof spec[specCategory][ttl] === 'undefined') {
                                    spec[specCategory][ttl] = [];
                                } else {
                                    spec[specCategory][ttl] = [spec[specCategory][ttl]];
                                }
                            }
                            multiNfo.map(function(info) {
                                if (info !== '') {
                                    spec[specCategory][ttl].push(info.replace(/^\-\ +/, '').trim());
                                }
                            });
                        }

                        if (typeof spec[specCategory][ttl] === 'object' && spec[specCategory][ttl].length < 2) {
                            spec[specCategory][ttl] = spec[specCategory][ttl][0];
                        }
                    }
                });
            });
            callback(null, data);
        } else {
            callback(error);
        }
    });
};

var scrapContentToFile = function(params, callback) {
    var req = {
        brand: params.brand,
        data: params.data,
        verbose: !!params.verbose,
    };

    request({ url: req.data.url, maxAttempts: 1000, retryDelay: 2000 }, function(error, response, html) {
        if (!error) {
            if (req.verbose) console.log(++nScrapContent + '. ' + req.brand + ' - ' + req.data.url);
            var data = req.data;
            data.name = req.brand + ' ' + data.name;

            var $ = cheerio.load(html);

            var additional = $('div#specs-list > p');
            data.additional = additional.text();

            //tables (spec category)
            $(config.content.domString).map(function(i) {
                var $self = $(this);
                var spec = data;

                var specCategory = $self.find('th').text();
                spec[specCategory] = {};

                var $ttls = $self.find('td.ttl');
                $ttls.map(function(i) {
                    var $ttl = $(this);
                    var $nfo = $ttl.siblings('td.nfo');
                    var ttl = $ttl.text();
                    var nfo = $nfo.text();

                    if (ttl === ' ' || ttl === '') {
                        ttl = 'Others';
                    }

                    nfo = nfo.replace(/^(\r\n)+/, '').trim();
                    if (nfo !== '') {
                        var multiNfo = nfo.split(/\r\n/);
                        if (multiNfo.length < 2) {
                            spec[specCategory][ttl] = nfo;
                        } else {
                            if (typeof spec[specCategory][ttl] !== 'object') {
                                if (typeof spec[specCategory][ttl] === 'undefined') {
                                    spec[specCategory][ttl] = [];
                                } else {
                                    spec[specCategory][ttl] = [spec[specCategory][ttl]];
                                }
                            }
                            multiNfo.map(function(info) {
                                if (info !== '') {
                                    spec[specCategory][ttl].push(info.replace(/^\-\ +/, '').trim());
                                }
                            });
                        }

                        if (typeof spec[specCategory][ttl] === 'object' && spec[specCategory][ttl].length < 2) {
                            spec[specCategory][ttl] = spec[specCategory][ttl][0];
                        }
                    }
                });
            });
            fs.writeFile(config.saveDirectory + '/' + data.name.replace(/[\/\\\?\*\|:"<>]/, '_') + '.json', JSON.stringify(data, null, 2));
            callback(null, []);
        } else {
            callback(error);
        }
    });
};

module.exports = {
    scrapCategories: scrapCategories,
    scrapItemsFromACategory: scrapItemsFromACategory,
    scrapContent: scrapContent,
    scrapContentToFile: scrapContentToFile,
    nScrapContent: nScrapContent,
    getPages: getPages,
};