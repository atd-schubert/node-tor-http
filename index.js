'use strict';

var spawn = require('child_process').spawn,
    Stream = require("stream").Stream,
    utillib = require("util"),
    url = require("url"),
    _ = require("underscore");
    //EventEmitter = require('events').EventEmitter;
    
var parseHeaders = function(str){ // inspirated by: https://github.com/andris9/torfetch
  var lines = str.trim().split(/\r?\n/), parts, key, value,
      statusLine, status, httpVersion,
      headers = {};
  
  statusLine = lines[0] || "";
  statusLine = statusLine.split(" ");
  
  status = parseInt(statusLine[1]);
  
  httpVersion = statusLine[0].split("/")[1];
  
  lines.shift(); // status line
  for(var i=0, len = lines.length; i<len; i++){
    if((lines[i] = lines[i].trim())){
      parts = lines[i].split(":");
      key = parts.shift().trim().toLowerCase();
      value = parts.join(":").trim();
      if(Array.isArray(headers[key])){
        headers[key].push(value);
      }else if(!headers[key]){
        headers[key] = value;
      }else{
        headers[key] = [headers[key], value];
      }
    }
  }
  
  return {
    headers: headers,
    statusCode: status,
    httpVersion: httpVersion,
    httpVersionMajor: httpVersion.split(".")[0] || 0,
    httpVersionMinor: httpVersion.split(".")[1] || 0,
  };
};

var pipeEvent = function(event, origin, destination) {
  origin.on(event, function(){
    var arg = Array.apply(null, arguments);
    arg.unshift(event);
    destination.emit.apply(destination, arg);
  });
}



exports.request = function(opts, cb){
  /*
    host: A domain name or IP address of the server to issue the request to. Defaults to 'localhost'.
hostname: To support url.parse() hostname is preferred over host
port: Port of remote server. Defaults to 80.
localAddress: Local interface to bind for network connections.
socketPath: Unix Domain Socket (use one of host:port or socketPath)
method: A string specifying the HTTP request method. Defaults to 'GET'.
path: Request path. Defaults to '/'. Should include query string if any. E.G. '/index.html?page=12'
headers: An object containing request headers.
auth: Basic authentication i.e. 'user:password' to compute an Authorization header.
  */
  
  // TODO: auth isn't supported!
  
  var hash, i;
  if (typeof opts === "string") opts = url.parse(opts);
  
  // get std. settings for options
  opts = _.extend(
    {
      hostname: "localhost",
      method: "GET",
      protocol: 'http:',
      pathname: '/',
      path: '/',
      "socks5-hostname": "localhost",
      "socks5-port": "9050",
      params: [
        "--insecure",
        "--location"
      ]
    },
    opts
  );
  cb = cb || function(){};
  if(!opts.headers) opts.headers = {};
  opts.headers = _.extend(
    {
      
    },
    opts.headers
  );
  
  // Create request object for returning
  var mkReq = function(){
    Stream.call(this);
  };
  utillib.inherits(mkReq, Stream);
  
  var mkRes = function(){
    Stream.call(this);
  };
  utillib.inherits(mkRes, Stream);
  
  // Make params Array
  var params = [];
  
  // Setting up socks5
  params.push("--socks5-hostname");
  params.push(opts["socks5-hostname"]+":"+opts["socks5-port"]);
  
  // read headers from options
  for(hash in opts.headers) {
    params.push("-H");
    params.push(hash+": "+opts.headers[hash]);
  }
  
  // setting up agent TODO:!
  
  // include header to curl output
  params.push("--include");
  
  // set method
  params.push("-X");
  params.push(opts.method.toUpperCase());
  
  // apply params from options
  for(i=0; i<opts.params.length; i++) {
    params.push(opts.params[i]);
  }
  
  // disable progress output to prevent errormessages
  params.push("--silent");
  
  // write uri
  params.push(url.format(opts));
  
  // Enable stdin for curl
  params.push("-d");
  params.push("@-");
  
  // call curl to evaluate request
  var curl = spawn("curl", params);

  var req = new mkReq();
  
  // Pipe curl and req
  req.write = function(){
    curl.stdin.write.apply(curl.stdin, arguments);
  };
  req.end = function(){
    curl.stdin.end.apply(curl.stdin, arguments);
  };
  curl.stderr.on("data", function(err){
    req.emit("error", err);
  });
  
  // Create response
  var res = new mkRes();
  var resEncoding;
  res.req = req;
  res.setEncoding = function(encoding){
    resEncoding = encoding;
    //curl.stdout.setEncoding(encoding);
  };
  res.connection = curl.stdout;
  
  // Copy methods from stdout to res
  
  res._connecting = curl.stdout._connecting;
  res._handle = curl.stdout._handle;
  res._readableState = curl.stdout._readableState;
  res.readable = curl.stdout.readable;
  res._maxListeners = curl.stdout._maxListeners;
  res._writableState = curl.stdout._writableState;
  res.allowHalfOpen = curl.stdout.allowHalfOpen;
  res.onend = curl.stdout.onend;
  res.destroyed = curl.stdout.destroyed;
  res.errorEmitted = curl.stdout.errorEmitted;
  res.bytesRead = curl.stdout.bytesRead;
  res._bytesDispatched = curl.stdout._bytesDispatched;
  res._pendingData = curl.stdout._pendingData;
  res._pendingEncoding = curl.stdout._pendingEncoding;
  res.pause = curl.stdout.pause;
  res.resume = curl.stdout.resume;
  res.read = curl.stdout.read;
  res._consuming = curl.stdout._consuming;
  
  // Pipe curl and res
  var stateHeader = true;
  var headers = "";
  curl.stdout.on("data", function(chunk){ // inspirated by: https://github.com/andris9/torfetch
    var str, match, lastpos, parsedHeaders;
    
    if(stateHeader){
      str = chunk.toString("binary");
      if((match = str.match(/\r?\n\r?\n/))){
        lastpos = match.index + match[0].length;
        headers += str.substr(0, lastpos);
        
        parsedHeaders = parseHeaders(headers)
        res.headers = parsedHeaders.headers;
        res.statusCode = parsedHeaders.statusCode;
        res.httpVersion = parsedHeaders.httpVersion;
        res.httpVersionMajor = parsedHeaders.httpVersionMajor;
        res.httpVersionMinor = parsedHeaders.httpVersionMinor;
        
        stateHeader = false;
        
        cb(res);
        if(resEncoding) res.emit("data", chunk.slice(lastpos).toString(resEncoding));
        else res.emit("data", chunk.slice(lastpos));
      } else {
        headers += str;
      }
    } else {
      if(resEncoding) res.emit("data", chunk.toString(resEncoding));
      else res.emit("data", chunk);
    } 
  });
  pipeEvent("end", curl.stdout, res);
  pipeEvent("finish", curl.stdout, res);
  pipeEvent("_socketEnd", curl.stdout, res);
  pipeEvent("close", curl.stdout, res);
  pipeEvent("readable", curl.stdout, res);
  
  return req; //{req:req, curl:curl};
};

exports.get = function(opts, cb){
  exports.request(opts, cb).end();
};