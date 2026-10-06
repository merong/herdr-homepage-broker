import http from 'node:http';
http.createServer((_,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<h1>homepage preview fixture</h1>')}).listen(Number(process.argv[2]),'127.0.0.1');
