const http = require('node:http');
const crypto = require('node:crypto');
const blob = Buffer.from('fixture-layer-data');
const digest = 'sha256:' + crypto.createHash('sha256').update(blob).digest('hex');
http.createServer((req,res) => {
 const u=new URL(req.url,'http://simulation');
 const kind=process.env.MOCK_KIND || req.headers['x-test-origin'];
 function send(status,body,headers={}) {res.writeHead(status,headers);res.end(req.method==='HEAD'?undefined:body);}
 const challenge='Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/busybox:pull"';
 if (kind==='auth') {
  if(u.pathname!='/token')return send(501,'undefined auth endpoint');
  if(req.headers.authorization||req.headers.cookie||req.headers['x-api-key'])return send(400,'credentials leaked');
  if([...u.searchParams.keys()].some(k=>!['service','scope'].includes(k)))return send(400,'extra query leaked');
  if(u.searchParams.get('service')!=='registry.docker.io')return send(400,'invalid service');
  return send(200,JSON.stringify({token:'anonymous-token',access_token:'anonymous-token',expires_in:300}),{'content-type':'application/json','set-cookie':'must-not-leave-mock=1'});
 }
 if(kind==='cdn'){
  if(req.headers.authorization||req.headers.cookie||req.headers['x-api-key'])return send(400,'credentials leaked');
  if(u.pathname==='/layer') {
   const partial=req.headers.range==='bytes=0-3';
   return send(partial?206:200,partial?blob.subarray(0,4):blob,{'content-type':'application/octet-stream','content-length':String(partial?4:blob.length),'docker-content-digest':digest,...(partial?{'content-range':'bytes 0-3/'+blob.length}:{}),'set-cookie':'must-not-leave-mock=1'});
  }
  return send(501,'undefined CDN endpoint');
 }
 if(kind==='registry'){
  if(u.pathname==='/v2/'||!req.headers.authorization)return send(401,'needs token',{'www-authenticate':challenge,'content-type':'application/json'});
  if(u.pathname.includes('/referrers/')) {
   const id=u.pathname.split('sha256:')[1];
   if(id==='3'.repeat(64))return send(404,'referrers not found');
   if(id==='4'.repeat(64))return send(429,'referrers limited',{'retry-after':'60'});
   const headers={'content-type':'application/vnd.oci.image.index.v1+json','oci-filters-applied':'artifactType'};
   if(id==='5'.repeat(64))headers.link='<'+u.pathname+'?cursor=fixture-next&artifactType=application%2Fexample>; rel="next"';
   if(id==='6'.repeat(64))headers.link='<https://registry-1.docker.io'+u.pathname+'?cursor=fixture-next>; rel="next"';
   if(id==='7'.repeat(64))headers.link='<https://example.com'+u.pathname+'?cursor=fixture-next>; rel="next"';
   if(id==='8'.repeat(64))headers.link='<https://registry-1.docker.io/v2/other/repository/referrers/sha256:'+id+'?cursor=fixture-next>; rel="next"';
   if(id==='9'.repeat(64))headers.link='<http://registry-1.docker.io'+u.pathname+'?cursor=fixture-next>; rel="next"';
   return send(200,JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:[]}),headers);
  }
  if(/\/manifests\/sha256-/.test(u.pathname))return send(429,'rate limited',{'retry-after':'60'});
  if(/\/manifests\/cache-(?:failure|unsafe)-/.test(u.pathname))return send(429,'rate limited',{'retry-after':'60'});
  if(u.pathname.endsWith('/manifests/rate-limit'))return send(429,'rate limited',{'retry-after':'60'});
  if(u.pathname.endsWith('/manifests/forbidden'))return send(403,'forbidden');
  if(u.pathname.endsWith('/manifests/latest'))return send(200,JSON.stringify({schemaVersion:2,layers:[{digest,size:blob.length}]}),{'content-type':'application/vnd.oci.image.manifest.v1+json','docker-content-digest':'sha256:abcd'});
  if(u.pathname.endsWith('/blobs/sha256:deadbeef'))return send(307,'',{'location':'https://example.com/leak'});
  if(u.pathname.endsWith('/blobs/sha256:bad'))return send(307,'',{'location':'http://production.cloudfront.docker.com/layer'});
  if(u.pathname.endsWith('/blobs/sha256:cafe'))return send(307,'',{'location':'https://docker-images-prod.attacker.r2.cloudflarestorage.com/layer'});
  if(u.pathname.endsWith('/blobs/sha256:feed'))return send(307,'',{'location':'https://production.cloudfront.docker.com:444/layer'});
  if(u.pathname.endsWith('/blobs/sha256:face'))return send(307,'',{'location':'https://registry-1.docker.io'+u.pathname});
  if(u.pathname.endsWith('/blobs/sha256:beef'))return send(307,'',{'location':'https://docker-images-prod.6aa30f8b08e16409b46e0173d6de2f56.r2.cloudflarestorage.com/layer?signature=fixture'});
  if(u.pathname.includes('/blobs/'))return send(307,'',{'location':'https://production.cloudfront.docker.com/layer?signature=fixture'});
  return send(501,'undefined registry endpoint');
 }
 send(501,'unknown fixture origin');
}).listen(process.env.PORT);
