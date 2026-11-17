/** Linux-only local evaluation. Bridge fixed synthetic ports, never normal ports. */
const net=require('node:net');
const {spawn}=require('node:child_process');
const servers=[];
(async()=>{
  for(const port of [18510,18511]){
    const server=net.createServer(socket=>{
      const upstream=net.connect(port,'host.docker.internal');
      socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
      socket.on('close',()=>upstream.destroy());upstream.on('close',()=>socket.destroy());
      socket.pipe(upstream);upstream.pipe(socket);
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
    servers.push(server);
  }
  const child=spawn(process.execPath,['/repo/frontend/node_modules/@playwright/test/cli.js','test',
    '--config=playwright.container.config.ts',...process.argv.slice(2)],{cwd:'/repo/frontend',stdio:'inherit',env:process.env});
  child.on('error',e=>{console.error(e);for(const server of servers)server.close();process.exitCode=1;});
  child.on('exit',code=>{for(const server of servers)server.close();process.exitCode=code??1;});
})().catch(e=>{console.error(e);for(const server of servers)server.close();process.exitCode=1;});
